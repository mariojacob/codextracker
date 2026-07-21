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
import { fetchForecast } from './codex/forecast.js';
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
  // Forecast refresh runs independently from the Codex API and works
  // without auth, but it starts empty until the first fetch lands.
  forecast: null,
  forecast_error: null,
};

/** Minimum forecast polling interval. Server refreshes its sources
 * every ~30 minutes, so polling faster than this just wastes requests. */
const FORECAST_MIN_MINUTES = 5;
/** Hard upper bound to keep settings mistakes from paralyzing the loop. */
const FORECAST_MAX_MINUTES = 120;
/** Extra margin we add on top of the server-supplied `nextRefreshAt` to
 * avoid hitting the API one second too early because of clock skew. */
const FORECAST_NEXT_REFRESH_SAFETY_MS = 60_000;

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
  if (!w || typeof w.used_percent !== 'number') return 'unknown';

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

/** True iff the API gave us a primary_window that looks like the 5h
 * session limit. Kept for the existing session_window_available flag
 * which only needs to know about the session lane specifically. */
function isSessionWindowUsable(primary: RateWindow | null | undefined): boolean {
  return classifyWindow(primary) === 'session';
}

function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export class RefreshService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private snapshot: CachedSnapshot = { ...EMPTY };
  private settings: Settings | null = null;
  private lastSnapshotValues: Map<string, number> = new Map();
  /** Tracks consecutive ticks where the 5h window was unusable. */
  private sessionMissingStreak = 0;
  /** Independent timer for the willcodexquotareset.com forecast poll. */
  private forecastTimer: NodeJS.Timeout | null = null;
  private forecastInFlight = false;
  /** Server-supplied next-safe-fetch timestamp (ms epoch). */
  private forecastNextAllowedAt = 0;

  constructor(private readonly tokens: TokenManager) {
    super();
  }

  async start(): Promise<void> {
    this.settings = await loadSettings();
    // Initial fetch (if authenticated)
    if (this.tokens.isAuthenticated()) {
      void this.refreshNow();
    }
    this.scheduleNext();
    // Forecast has no auth requirement, so we always start its timer.
    void this.refreshForecast();
    this.scheduleForecast();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.forecastTimer) {
      clearTimeout(this.forecastTimer);
      this.forecastTimer = null;
    }
  }

  async refreshNow(): Promise<CachedSnapshot> {
    if (this.inFlight) return this.snapshot;
    this.inFlight = true;
    try {
      const accessToken = await this.tokens.getAccessToken();
      const accountId = (await this.tokens.getAccountId()) ?? undefined;
      const [usage, resets] = await Promise.all([
        fetchUsage(accessToken, accountId),
        fetchResetCredits(accessToken, accountId),
      ]);
      const snap = this.buildSnapshot(usage, resets);
      this.snapshot = snap;
      // Save email if newly known
      if (snap.email) await this.tokens.updateEmail(snap.email);
      // Append to history
      await this.recordHistory(snap);
      // Check notification rules
      this.checkNotifications(snap);
      this.emit('updated', snap);
    } catch (err) {
      this.snapshot = { ...this.snapshot, error: (err as Error).message };
      this.emit('updated', this.snapshot);
    } finally {
      this.inFlight = false;
    }
    return this.snapshot;
  }

  getSnapshot(): CachedSnapshot {
    return this.snapshot;
  }

  updateSettings(s: Settings): void {
    this.settings = s;
    this.scheduleNext();
    this.scheduleForecast();
  }

  /** Trigger a redeem on a specific reset-credit. Returns success/failure. */
  async redeemCredit(creditId: string): Promise<{ ok: boolean; message: string }> {
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

  /** Pulls the latest forecast from willcodexquotareset.com and merges it
   * into the current snapshot. Forecast is auth-free so this runs even
   * when the user isn't signed in. */
  private async refreshForecast(): Promise<void> {
    if (this.forecastInFlight) return;
    this.forecastInFlight = true;
    try {
      const { snapshot, nextRefreshAt } = await fetchForecast();
      this.snapshot = {
        ...this.snapshot,
        forecast: snapshot,
        forecast_error: null,
      };
      if (nextRefreshAt) {
        const parsed = Date.parse(nextRefreshAt);
        if (!Number.isNaN(parsed)) {
          this.forecastNextAllowedAt = parsed + FORECAST_NEXT_REFRESH_SAFETY_MS;
        }
      }
      this.checkNotifications(this.snapshot);
      this.emit('updated', this.snapshot);
    } catch (err) {
      this.snapshot = {
        ...this.snapshot,
        forecast_error: (err as Error).message,
      };
      this.emit('updated', this.snapshot);
    } finally {
      this.forecastInFlight = false;
    }
  }

  /** Compute the delay until the next forecast fetch, respecting both the
   * user-configured interval and the server-supplied `nextRefreshAt`. */
  private nextForecastDelayMs(): number {
    const minutes = clampNumber(
      this.settings?.forecast_minutes ?? 20,
      FORECAST_MIN_MINUTES,
      FORECAST_MAX_MINUTES,
    );
    const userDelay = minutes * 60_000;
    const now = Date.now();
    const serverDelay = Math.max(0, this.forecastNextAllowedAt - now);
    return Math.max(userDelay, serverDelay);
  }

  private scheduleForecast(): void {
    if (this.forecastTimer) {
      clearTimeout(this.forecastTimer);
      this.forecastTimer = null;
    }
    const delay = this.nextForecastDelayMs();
    this.forecastTimer = setTimeout(() => {
      void this.refreshForecast().finally(() => this.scheduleForecast());
    }, delay);
  }

  /** Manual hook so other code (e.g. tray "Refresh now") can force a
   * forecast fetch and reschedule the timer. */
  async refreshForecastNow(): Promise<void> {
    this.forecastNextAllowedAt = 0;
    await this.refreshForecast();
    this.scheduleForecast();
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
      // Forecast lives on its own refresh loop — preserve whatever was
      // last fetched (or null) when the Codex snapshot rebuilds.
      forecast: this.snapshot.forecast,
      forecast_error: this.snapshot.forecast_error,
    };
  }

  private async recordHistory(snap: CachedSnapshot): Promise<void> {
    // History drives the sparkline. If both windows are missing this tick,
    // writing a (null, null) row would break the chart — skip the entry.
    if (snap.session_pct_left == null && snap.weekly_pct_left == null) return;
    const entry: HistorySnapshot = {
      timestamp: snap.fetched_at,
      session_pct_left: snap.session_pct_left ?? 0,
      weekly_pct_left: snap.weekly_pct_left ?? 0,
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
      forecast: snap.forecast?.score ?? null,
    };

    for (const rule of this.settings.notifications.rules) {
      if (!rule.enabled) continue;
      // Session rule goes silent while OpenAI has the 5h limit disabled —
      // the underlying value isn't a real usage number in that state.
      if (rule.card === 'session' && !snap.session_window_available) continue;
      const value = valuesByCard[rule.card];
      if (value == null) continue;
      const key = `${rule.id}:${rule.threshold}`;

      // Forecast is inverted: high score = high chance of a reset = user
      // wants the heads-up. Everything else stays "low = bad".
      const triggered = rule.card === 'forecast'
        ? value >= rule.threshold
        : value < rule.threshold;

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
      this.lastSnapshotValues.set(rule.id, value);
    }
  }

  private ruleBody(rule: { card: string; threshold: number }, value: number): string {
    if (rule.card === 'credits') {
      return `Credits balance: ${value}. Threshold: ${rule.threshold}.`;
    }
    if (rule.card === 'resets') {
      return `${value} reset credit(s) available.`;
    }
    if (rule.card === 'forecast') {
      return `Reset forecast: ${value.toFixed(0)}% in next 48h (threshold ${rule.threshold}%).`;
    }
    return `${rule.card} at ${value.toFixed(0)}% (threshold ${rule.threshold}%).`;
  }
}
