/**
 * RefreshService: owns the auto-refresh loop. Periodically:
 *   1. ensures a valid access_token (refreshes if needed)
 *   2. fetches /wham/usage and /wham/rate-limit-reset-credits
 *   3. appends a history snapshot
 *   4. checks notification rules and fires toasts
 *
 * Returns a CachedSnapshot that the renderer can fetch on demand.
 */
import { EventEmitter } from 'node:events';
import { fetchResetCredits, fetchUsage, fmtTimedelta, parseResetAt, pctLeft, redeemResetCredit } from './codex/api.js';
import { appendSnapshot, HistorySnapshot } from './codex/history.js';
import { notifDeduper, showNotification } from './notifications.js';
import { loadSettings, Settings } from './settings.js';
import { TokenManager } from './codex/tokens.js';
import { CachedSnapshot, RateWindow, ResetCreditsResponse, UsageResponse } from '../shared/types.js';

export type { CachedSnapshot };

const EMPTY: CachedSnapshot = {
  fetched_at: '',
  error: null,
  plan: '',
  email: '',
  // null = no data yet. The renderer omits the bar in this state, so we
  // never display a misleading "100%" before the first successful fetch.
  session_pct_left: null,
  weekly_pct_left: null,
  credits_balance: null,
  reset_credits_available: 0,
  session_reset_in: '—',
  weekly_reset_in: '—',
  session_reset_at: null,
  weekly_reset_at: null,
  reset_credit_details: [],
  // Start as false so the UI doesn't flash the Session section before the
  // first fetch lands. Flips true once we see a usable primary_window.
  session_window_available: false,
  weekly_window_seconds: null,
};

/** 5h rolling limit = 18000 seconds. The session limit OpenAI exposes
 *  in /wham/usage rate_limit.primary_window for Plus/Pro/Business plans. */
const SESSION_WINDOW_SECONDS = 18_000;
/** 7-day rolling limit = 604800 seconds. OpenAI currently exposes the
 *  weekly window in rate_limit.secondary_window for plans that still
 *  have a 5h session, and moves it into primary_window when the 5h
 *  limit is disabled — we have to handle both shapes. */
const WEEKLY_WINDOW_SECONDS = 604_800;
/**
 * Consecutive ticks with an unusable session window before we treat the
 * 5h limit as disabled. At the default 60s refresh that's ~3 minutes,
 * which is long enough to ride out the post-reset transition / brief
 * API hiccups but short enough to react quickly to a real OpenAI change.
 */
const SESSION_MISSING_THRESHOLD = 3;

/** Classify a window by the limit length the API reports. Returns
 * 'unknown' for windows the API didn't populate with used_percent. */
function classifyWindow(
  w: RateWindow | null | undefined,
): 'session' | 'weekly' | 'unknown' {
  if (!w || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) return 'unknown';

  const win = w.limit_window_seconds;
  if (win === SESSION_WINDOW_SECONDS) return 'session';
  if (win === WEEKLY_WINDOW_SECONDS) return 'weekly';

  // limit_window_seconds missing — fall back to the reset horizon,
  // which is what older Codex responses shipped.
  if (win == null) {
    const resetMs = parseResetAt(w.reset_at);
    if (resetMs == null) return 'unknown';
    const msUntilReset = resetMs - Date.now();
    if (msUntilReset > 0 && msUntilReset <= 5 * 60 * 60 * 1000 + 60 * 60 * 1000) {
      return 'session';
    }
    return 'weekly';
  }

  return 'unknown';
}

export class RefreshService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private activeRequest: AbortController | null = null;
  private revision = 0;
  private stopped = false;
  private snapshot: CachedSnapshot = { ...EMPTY };
  private settings: Settings | null = null;
  /** Tracks consecutive ticks where the 5h window was unusable. */
  private sessionMissingStreak = 0;
  constructor(private readonly tokens: TokenManager) {
    super();
  }

  async start(): Promise<void> {
    this.stopped = false;
    const settings = await loadSettings();
    if (!this.settings) this.settings = settings;
    // Initial fetch (if authenticated)
    if (this.isEnabled() && this.tokens.isAuthenticated()) {
      void this.refreshNow();
    }
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    this.cancelRequest();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async refreshNow(): Promise<CachedSnapshot> {
    if (!this.settings) {
      const settings = await loadSettings();
      if (!this.settings) this.settings = settings;
    }
    if (!this.isEnabled() || this.stopped) return this.snapshot;
    if (this.inFlight) return this.snapshot;
    this.inFlight = true;
    const controller = new AbortController();
    this.activeRequest = controller;
    const revision = this.revision;
    const current = () => revision === this.revision && this.isEnabled() && !this.stopped;
    try {
      const accessToken = await this.tokens.getAccessToken();
      if (!current()) return this.snapshot;
      const accountId = (await this.tokens.getAccountId()) ?? undefined;
      if (!current()) return this.snapshot;
      const [usage, resets] = await Promise.all([
        fetchUsage(accessToken, accountId, controller.signal),
        fetchResetCredits(accessToken, accountId, controller.signal),
      ]);
      if (!current()) return this.snapshot;
      const snap = this.buildSnapshot(usage, resets);
      this.snapshot = snap;
      // Save email if newly known
      if (snap.email) await this.tokens.updateEmail(snap.email);
      if (!current()) return this.snapshot;
      // Append to history
      await this.recordHistory(snap, usage);
      if (!current()) return this.snapshot;
      // Check notification rules
      this.checkNotifications(snap);
      this.emit('updated', snap);
    } catch (err) {
      if (current()) {
        this.snapshot = { ...this.snapshot, error: (err as Error).message };
        this.emit('updated', this.snapshot);
      }
    } finally {
      if (this.activeRequest === controller) {
        this.inFlight = false;
        this.activeRequest = null;
      }
    }
    return this.snapshot;
  }

  getSnapshot(): CachedSnapshot {
    return this.snapshot;
  }

  updateSettings(s: Settings): void {
    const wasEnabled = this.isEnabled();
    this.settings = s;
    if (wasEnabled !== s.codex_enabled) this.clearSnapshot();
    this.scheduleNext();
    if (s.codex_enabled && !wasEnabled && this.tokens.isAuthenticated()) void this.refreshNow();
  }

  isEnabled(): boolean {
    return this.settings?.codex_enabled ?? false;
  }

  /** Invalidate late results without removing the saved login or history. */
  clearSnapshot(): void {
    this.cancelRequest();
    this.snapshot = { ...EMPTY };
    this.sessionMissingStreak = 0;
    this.emit('updated', this.snapshot);
  }

  private cancelRequest(): void {
    this.revision++;
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.inFlight = false;
  }

  /** Trigger a redeem on a specific reset-credit. Returns success/failure. */
  async redeemCredit(creditId: string): Promise<{ ok: boolean; message: string }> {
    if (!this.isEnabled()) return { ok: false, message: 'Codex monitoring is disabled.' };
    try {
      if (
        typeof creditId !== 'string' ||
        creditId.length < 1 ||
        creditId.length > 256 ||
        !this.snapshot.reset_credit_details.some((credit) => credit.id === creditId)
      ) {
        return { ok: false, message: 'Unknown reset credit.' };
      }
      const accessToken = await this.tokens.getAccessToken();
      const accountId = (await this.tokens.getAccountId()) ?? undefined;
      const result = await redeemResetCredit(accessToken, creditId, accountId);
      if (result.ok) {
        // Refresh data so the user immediately sees the new state
        notifDeduper.resetAll();
        await this.refreshNow();
      }
      return result;
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.isEnabled() || this.stopped) return;
    const secs = this.settings?.refresh_seconds ?? 60;
    this.timer = setTimeout(() => {
      void this.tick();
    }, Math.max(10, secs) * 1000);
  }

  private async tick(): Promise<void> {
    if (this.tokens.isAuthenticated()) {
      await this.refreshNow();
    }
    this.scheduleNext();
  }

  private buildSnapshot(usage: UsageResponse, resets: ResetCreditsResponse): CachedSnapshot {
    const primary = usage.rate_limit?.primary_window;
    const secondary = usage.rate_limit?.secondary_window;
    const plan = usage.plan_type ?? '';
    const email = usage.user?.email ?? '';

    // Classify each window by length so we route the right data to the
    // right slot. OpenAI has shipped several response shapes:
    //   - 5h session in primary + 7d weekly in secondary (classic)
    //   - 7d weekly in primary + null in secondary (when 5h is disabled)
    //   - both windows present, lengths swapped (defensive)
    const sessionWin =
      classifyWindow(primary) === 'session'
        ? primary
        : classifyWindow(secondary) === 'session'
          ? secondary
          : null;
    const weeklyWin =
      classifyWindow(secondary) === 'weekly'
        ? secondary
        : classifyWindow(primary) === 'weekly'
          ? primary
          : null;

    // Merge strategy: take the new value when the API gave us one, otherwise
    // keep the previous one. This prevents the "100% for a minute" jump that
    // happens when /wham/usage returns one of the windows as null (which
    // occurs during quota transitions / right after a reset).
    const session_pct = pctLeft(sessionWin) ?? this.snapshot.session_pct_left;
    const weekly_pct = pctLeft(weeklyWin) ?? this.snapshot.weekly_pct_left;
    const balance = usage.credits?.balance ?? null;

    // Track whether the 5h/session window is currently usable. We require
    // a streak of consecutive missing ticks before flipping the UI flag,
    // so single transient nulls (post-reset, brief API hiccup) don't make
    // the Session section flash on/off.
    const sessionUsable = sessionWin != null;
    if (sessionUsable) {
      this.sessionMissingStreak = 0;
    } else {
      this.sessionMissingStreak++;
    }
    const session_window_available =
      this.snapshot.session_window_available
        ? this.sessionMissingStreak < SESSION_MISSING_THRESHOLD
        : this.sessionMissingStreak === 0;

    return {
      fetched_at: new Date().toISOString(),
      error: null,
      plan,
      email,
      session_pct_left: session_pct,
      weekly_pct_left: weekly_pct,
      credits_balance: balance,
      reset_credits_available: resets.available_count ?? 0,
      session_reset_in: fmtTimedelta(sessionWin?.reset_at),
      weekly_reset_in: fmtTimedelta(weeklyWin?.reset_at),
      session_reset_at: parseResetAt(sessionWin?.reset_at),
      weekly_reset_at: parseResetAt(weeklyWin?.reset_at),
      reset_credit_details: resets.credits ?? [],
      session_window_available,
      weekly_window_seconds: weeklyWin ? (weeklyWin.limit_window_seconds ?? WEEKLY_WINDOW_SECONDS) : null,
    };
  }

  private async recordHistory(snap: CachedSnapshot, usage: UsageResponse): Promise<void> {
    const windows = [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window];
    const session = windows.find((window) => classifyWindow(window) === 'session');
    const weekly = windows.find((window) => classifyWindow(window) === 'weekly');
    const entry: HistorySnapshot = {
      version: 2,
      timestamp: snap.fetched_at,
      session_pct_left: pctLeft(session),
      weekly_pct_left: pctLeft(weekly),
      session_reset_at: parseResetAt(session?.reset_at),
      weekly_reset_at: parseResetAt(weekly?.reset_at),
      session_window_seconds: session ? (session.limit_window_seconds ?? SESSION_WINDOW_SECONDS) : null,
      weekly_window_seconds: weekly ? (weekly.limit_window_seconds ?? WEEKLY_WINDOW_SECONDS) : null,
      refresh_seconds: this.settings?.refresh_seconds ?? 60,
      credits_balance: snap.credits_balance,
      reset_credits_available: snap.reset_credits_available,
    };
    try {
      await appendSnapshot(entry);
    } catch (err) {
      console.error('Failed to write history snapshot:', err);
    }
  }

  private checkNotifications(snap: CachedSnapshot): void {
    if (!this.settings?.notifications.enabled) return;

    // Null means "API didn't supply a value this tick" — treat as "above
    // threshold" so we don't fire a spurious "running low" toast while
    // we're still showing the previous value to the user.
    const valuesByCard: Record<string, number | null> = {
      session: snap.session_pct_left ?? 100,
      weekly: snap.weekly_pct_left ?? 100,
      credits: snap.credits_balance ?? 0,
      resets: snap.reset_credits_available,
    };

    for (const rule of this.settings.notifications.rules) {
      if (!rule.enabled) continue;
      // Session rule goes silent while OpenAI has the 5h limit disabled —
      // the underlying value isn't a real usage number in that state.
      if (rule.card === 'session' && !snap.session_window_available) continue;
      const value = valuesByCard[rule.card];
      if (value == null) continue;
      const key = `${rule.id}:${rule.threshold}`;

      const triggered = value < rule.threshold;

      if (triggered) {
        if (notifDeduper.shouldSend(key)) {
          const cardName = rule.card.charAt(0).toUpperCase() + rule.card.slice(1);
          showNotification({
            title: `CodexTracker: ${cardName}`,
            body: this.ruleBody(rule, value),
          });
        }
      } else {
        // Value moved away from the trigger zone; allow re-fire next time
        notifDeduper.reset(key);
      }
    }
  }

  private ruleBody(rule: { card: string; threshold: number }, value: number): string {
    if (rule.card === 'credits') {
      return `Credits balance: ${value}. Threshold: ${rule.threshold}.`;
    }
    if (rule.card === 'resets') {
      return `${value} reset credit(s) available.`;
    }

    return `${rule.card} at ${value.toFixed(0)}% (threshold ${rule.threshold}%).`;
  }
}
