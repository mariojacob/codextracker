import type { ResetCreditEntry } from './types.js';

export const DAY_MS = 86_400_000;
export const WEEK_SECONDS = 604_800;

export interface WeeklyBudget {
  day: number;
  dayEnd: number;
  elapsedPct: number;
  targetPct: number;
  available: number;
  over: number;
}

/** Seven elapsed 24h periods, anchored to the authoritative reset instant. */
export function weeklyBudget(
  pctLeft: number | null | undefined,
  resetAt: number | null | undefined,
  windowSeconds: number | null | undefined,
  now = Date.now(),
): WeeklyBudget | null {
  if (pctLeft == null || !Number.isFinite(pctLeft) || pctLeft < 0 || pctLeft > 100 ||
      resetAt == null || !Number.isFinite(resetAt) || windowSeconds !== WEEK_SECONDS || !Number.isFinite(now)) return null;
  const start = resetAt - windowSeconds * 1000;
  if (now < start || now >= resetAt) return null;
  const day = Math.floor((now - start) / DAY_MS) + 1;
  const targetPct = day * 100 / 7;
  const difference = targetPct - (100 - pctLeft);
  return {
    day, dayEnd: start + day * DAY_MS,
    elapsedPct: (now - start) / (windowSeconds * 1000) * 100,
    targetPct, available: Math.max(0, difference), over: Math.max(0, -difference),
  };
}

export function creditExpiry(credit: ResetCreditEntry): number | null {
  const timestamp = credit.expires_at ? Date.parse(credit.expires_at) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function availableResetCredits(credits: ResetCreditEntry[], now = Date.now()): ResetCreditEntry[] {
  return credits.filter((credit) => credit.status === 'available' && (creditExpiry(credit) ?? Infinity) > now)
    .sort((a, b) => (creditExpiry(a) ?? Infinity) - (creditExpiry(b) ?? Infinity));
}

export function expiryUrgency(expiresAt: number | null, now = Date.now()): 'normal' | 'warn' | 'err' | 'expired' {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return 'normal';
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'expired';
  if (remaining <= DAY_MS) return 'err';
  if (remaining <= 3 * DAY_MS) return 'warn';
  return 'normal';
}
