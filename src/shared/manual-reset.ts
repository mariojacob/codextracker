import { availableResetCredits, creditExpiry, DAY_MS, WEEK_SECONDS, type WeeklyBudget } from './quota.js';
import type { ResetCreditEntry } from './types.js';

/** One saved planning deadline per module, scoped to a single quota pool. */
export interface ManualReset {
  window_id: string;
  reset_at: number;
  enabled: boolean;
  start_at: number;
  start_used_percent: number;
}

export interface ResetWindow {
  id: string;
  label: string;
  used_percent: number | null;
  reset_at: number | null;
  window_seconds: number | null;
}

/** The module's main quota is chosen automatically; no recurrence choice is needed. */
export function manualResetWindow(windows: ResetWindow[], previous?: ManualReset, now = Date.now()): ResetWindow | undefined {
  const saved = windows.find((window) => window.id === previous?.window_id);
  if (saved) return saved;
  return windows.reduce<ResetWindow | undefined>((chosen, window) => {
    const duration = (row: ResetWindow) => row.window_seconds ?? Math.max(0, ((row.reset_at ?? now) - now) / 1000);
    return !chosen || duration(window) > duration(chosen) ? window : chosen;
  }, undefined);
}

export function createManualReset(window: ResetWindow, resetAt: number, previous?: ManualReset, now = Date.now()): ManualReset {
  const cycleStart = window.reset_at != null && window.window_seconds != null && window.window_seconds > 0
    ? window.reset_at - window.window_seconds * 1000 : NaN;
  const keepStart = previous?.window_id === window.id && previous.reset_at > now;
  const knownStart = Number.isFinite(cycleStart) && cycleStart <= now && window.reset_at! > now;
  return {
    window_id: window.id, reset_at: resetAt, enabled: previous?.enabled ?? false,
    start_at: keepStart ? previous.start_at : knownStart ? cycleStart : now,
    start_used_percent: keepStart ? previous.start_used_percent : knownStart ? 0 : window.used_percent ?? 0,
  };
}

/** Follow available banked resets while keeping the current weekly cycle as the budget origin. */
export function bankedResetPlan(window: ResetWindow, credits: ResetCreditEntry[], now = Date.now()): ManualReset | undefined {
  if (!Number.isFinite(now) || window.window_seconds !== WEEK_SECONDS || window.reset_at == null ||
      !Number.isFinite(window.reset_at) || now >= window.reset_at || now < window.reset_at - WEEK_SECONDS * 1000) return undefined;
  const expiresAt = availableResetCredits(credits, now).map(creditExpiry).find((at) => at != null);
  return expiresAt == null ? undefined : { ...createManualReset(window, expiresAt, undefined, now), enabled: true };
}

export function activeManualReset(manual: ManualReset | undefined, windowId: string, now = Date.now()): manual is ManualReset {
  return !!manual && manual.window_id === windowId && manual.reset_at > now;
}

/** Keep the plan's origin fixed when editing the deadline or receiving new API data. */
export function manualResetBudget(pctLeft: number | null | undefined, manual: ManualReset, now = Date.now()): (WeeklyBudget & { segmentEnds: number[] }) | null {
  if (pctLeft == null || !Number.isFinite(pctLeft) || pctLeft < 0 || pctLeft > 100 ||
      !Number.isFinite(now) || now < manual.start_at || now >= manual.reset_at ||
      manual.reset_at <= manual.start_at) return null;
  const duration = manual.reset_at - manual.start_at;
  const day = Math.floor((now - manual.start_at) / DAY_MS) + 1;
  const dayEnd = Math.min(manual.start_at + day * DAY_MS, manual.reset_at);
  const target = (at: number) => manual.start_used_percent + (100 - manual.start_used_percent) * (at - manual.start_at) / duration;
  const targetPct = target(dayEnd);
  const difference = targetPct - (100 - pctLeft);
  // Very long plans retain the pace marker without adding hundreds of tiny segments.
  const days = Math.ceil(duration / DAY_MS);
  const segmentEnds = days <= 31 ? Array.from({ length: days }, (_, i) => target(Math.min(manual.start_at + (i + 1) * DAY_MS, manual.reset_at))) : [];
  return { day, dayEnd, elapsedPct: target(now), targetPct,
    available: Math.max(0, difference), over: Math.max(0, -difference), segmentEnds };
}

/** Position a pending manual deadline on the provider's original time scale. */
export function manualResetMarker(manual: ManualReset | undefined, window: ResetWindow, now = Date.now()): number | undefined {
  if (!activeManualReset(manual, window.id, now)) return undefined;
  if (manual.enabled) return 100;
  if (window.reset_at == null || window.window_seconds == null || window.window_seconds <= 0) return undefined;
  const start = window.reset_at - window.window_seconds * 1000;
  if (now < start || now >= window.reset_at || manual.reset_at < start || manual.reset_at > window.reset_at) return undefined;
  return (manual.reset_at - start) / (window.window_seconds * 1000) * 100;
}
