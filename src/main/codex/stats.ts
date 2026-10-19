/** Observed quota changes; never infer usage across resets or missing measurements. */
import type { DailyBucket, HistorySnapshot, Statistics, UsageTotal } from '../../shared/types.js';
import { DAY_MS, WEEK_SECONDS, weeklyBudget } from '../../shared/quota.js';

export interface StatisticsOptions {
  now?: number;
  resetAt?: number | null;
  windowSeconds?: number | null;
  refreshSeconds?: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function quota(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function total(days: DailyBucket[], field: 'weekly_consumed' | 'credits_spent' | 'credits_gained'): UsageTotal {
  const known = days.filter((day) => day[field] != null);
  return {
    value: known.length ? round(known.reduce((sum, day) => sum + day[field]!, 0)) : null,
    incomplete: !days.length || days.some((day) => field === 'weekly_consumed' ? day.incomplete : day.credits_incomplete),
  };
}

export function computeStatistics(history: HistorySnapshot[], options: StatisticsOptions = {}): Statistics {
  const now = options.now ?? Date.now();
  // Last measurement wins at a duplicate instant; duplicates must not add coverage twice.
  const unique = new Map<number, HistorySnapshot>();
  for (const snap of history) {
    const timestamp = Date.parse(snap.timestamp);
    if (Number.isFinite(timestamp) && timestamp <= now) unique.set(timestamp, snap);
  }
  const sorted = [...unique.entries()].sort((a, b) => a[0] - b[0]);
  const latest = [...sorted].reverse().find(([, snap]) => snap.version === 2 && snap.weekly_reset_at != null)?.[1];
  const resetAt = options.resetAt === undefined ? latest?.weekly_reset_at : options.resetAt;
  const windowSeconds = options.windowSeconds === undefined ? latest?.weekly_window_seconds : options.windowSeconds;
  const budget = weeklyBudget(100, resetAt, windowSeconds, now);
  const maxGap = Math.max(300_000, (options.refreshSeconds ?? 60) * 2000);
  const daily: DailyBucket[] = budget ? Array.from({ length: 30 }, (_, index) => ({
    start_at: budget.dayEnd - (30 - index) * DAY_MS,
    end_at: budget.dayEnd - (29 - index) * DAY_MS,
    weekly_consumed: null, credits_spent: null, credits_gained: null,
    incomplete: false, credits_incomplete: false, estimated: false, observed_ms: 0,
  })) : [];
  const creditCoverage = daily.map(() => 0);

  for (let index = 1; index < sorted.length; index++) {
    const [start, previous] = sorted[index - 1];
    const [end, current] = sorted[index];
    const duration = end - start;
    const refreshSeconds = Math.max(previous.refresh_seconds ?? options.refreshSeconds ?? 60, current.refresh_seconds ?? options.refreshSeconds ?? 60);
    const timely = duration <= Math.max(300_000, refreshSeconds * 2000);
    const versioned = previous.version === 2 && current.version === 2;
    const sameWindow = finite(current.weekly_reset_at) && previous.weekly_reset_at === current.weekly_reset_at &&
      previous.weekly_window_seconds === WEEK_SECONDS && current.weekly_window_seconds === WEEK_SECONDS &&
      start >= current.weekly_reset_at - WEEK_SECONDS * 1000 && end <= current.weekly_reset_at;
    const comparable = timely && versioned && sameWindow && quota(previous.weekly_pct_left) && quota(current.weekly_pct_left) &&
      current.weekly_pct_left <= previous.weekly_pct_left;
    const creditsComparable = timely && versioned && finite(previous.credits_balance) && finite(current.credits_balance);
    const consumed = comparable ? previous.weekly_pct_left! - current.weekly_pct_left! : 0;
    const creditChange = creditsComparable ? previous.credits_balance! - current.credits_balance! : 0;
    const affected = daily.map((day, dayIndex) => ({
      day, dayIndex, overlap: Math.max(0, Math.min(end, day.end_at, now) - Math.max(start, day.start_at)),
    })).filter(({ overlap }) => overlap > 0);
    for (const { day, dayIndex, overlap } of affected) {
      if (comparable) {
        day.weekly_consumed = (day.weekly_consumed ?? 0) + consumed * overlap / duration;
        day.observed_ms += overlap;
      } else {
        day.incomplete = true;
      }
      if (creditsComparable) {
        day.credits_spent = (day.credits_spent ?? 0) + Math.max(0, creditChange) * overlap / duration;
        day.credits_gained = (day.credits_gained ?? 0) + Math.max(0, -creditChange) * overlap / duration;
        creditCoverage[dayIndex] += overlap;
      } else {
        day.credits_incomplete = true;
      }
      if (affected.length > 1 && (comparable || creditsComparable)) day.estimated = true;
    }
  }

  daily.forEach((day, index) => {
    const expected = Math.max(0, Math.min(now, day.end_at) - day.start_at);
    day.incomplete ||= day.weekly_consumed == null || expected - day.observed_ms > maxGap;
    day.credits_incomplete ||= day.credits_spent == null || expected - creditCoverage[index] > maxGap;
  });
  return {
    summary: {
      current_day: total(daily.slice(-1), 'weekly_consumed'),
      previous_day: total(daily.slice(-2, -1), 'weekly_consumed'),
      last_7_days: total(daily.slice(-7), 'weekly_consumed'),
      last_30_days: total(daily, 'weekly_consumed'),
      credits_spent: total(daily, 'credits_spent'),
      credits_gained: total(daily, 'credits_gained'),
    },
    daily, anchor_available: budget != null,
    has_legacy_history: sorted.some(([, snap]) => snap.version !== 2),
    computed_at: new Date(now).toISOString(),
  };
}
