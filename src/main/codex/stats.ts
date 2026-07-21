/** Statistics aggregation over quota and credit history. */
import type {
  DailyBucket,
  HistorySnapshot,
  Statistics,
  StatisticsSummary,
  WeekdayBucket,
} from '../../shared/types.js';

export type { DailyBucket, Statistics, StatisticsSummary, WeekdayBucket };

export const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function usedPct(pctLeft: number | null | undefined): number | null {
  if (pctLeft == null || !Number.isFinite(pctLeft)) return null;
  return Math.max(0, Math.min(100, 100 - pctLeft));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeStatistics(history: HistorySnapshot[]): Statistics {
  const sorted = [...history]
    .filter((snap) => Number.isFinite(Date.parse(snap.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (sorted.length === 0) {
    return {
      summary: emptySummary(),
      daily: [],
      weekday: emptyWeekdays(),
      computed_at: new Date().toISOString(),
    };
  }

  interface MutableBucket extends DailyBucket {
    weeklySum: number;
    weeklyCount: number;
    sessionSum: number;
    sessionCount: number;
  }

  const dailyMap = new Map<string, MutableBucket>();
  const weekdays = emptyWeekdays();
  let previous: HistorySnapshot | null = null;
  let weeklyUsedSum = 0;
  let weeklyUsedCount = 0;
  let sessionUsedSum = 0;
  let sessionUsedCount = 0;
  let peakWeekly: number | null = null;
  let peakSession: number | null = null;
  let creditsSpent = 0;
  let creditsGained = 0;
  let sessionsOpened = 0;

  for (const snap of sorted) {
    const timestamp = Date.parse(snap.timestamp);
    const date = new Date(timestamp);
    const key = localDateKey(date);
    let bucket = dailyMap.get(key);
    if (!bucket) {
      bucket = {
        date: key,
        weekly_pct_used_min: null,
        weekly_pct_used_avg: null,
        session_pct_used_min: null,
        session_pct_used_avg: null,
        credits_spent: 0,
        snapshots: 0,
        weeklySum: 0,
        weeklyCount: 0,
        sessionSum: 0,
        sessionCount: 0,
      };
      dailyMap.set(key, bucket);
    }
    bucket.snapshots += 1;

    const weeklyUsed = usedPct(snap.weekly_pct_left);
    if (weeklyUsed != null) {
      bucket.weekly_pct_used_min = Math.max(bucket.weekly_pct_used_min ?? 0, weeklyUsed);
      bucket.weeklySum += weeklyUsed;
      bucket.weeklyCount += 1;
      bucket.weekly_pct_used_avg = bucket.weeklySum / bucket.weeklyCount;
      weeklyUsedSum += weeklyUsed;
      weeklyUsedCount += 1;
      peakWeekly = Math.max(peakWeekly ?? 0, weeklyUsed);
    }

    const sessionUsed = usedPct(snap.session_pct_left);
    if (sessionUsed != null) {
      bucket.session_pct_used_min = Math.max(bucket.session_pct_used_min ?? 0, sessionUsed);
      bucket.sessionSum += sessionUsed;
      bucket.sessionCount += 1;
      bucket.session_pct_used_avg = bucket.sessionSum / bucket.sessionCount;
      sessionUsedSum += sessionUsed;
      sessionUsedCount += 1;
      peakSession = Math.max(peakSession ?? 0, sessionUsed);
    }

    if (previous?.credits_balance != null && snap.credits_balance != null) {
      const delta = previous.credits_balance - snap.credits_balance;
      if (delta > 0) {
        creditsSpent += delta;
        bucket.credits_spent += delta;
      } else if (delta < 0) {
        creditsGained += -delta;
      }
    }

    if (
      previous &&
      previous.session_pct_left < 50 &&
      snap.session_pct_left > 90 &&
      timestamp - Date.parse(previous.timestamp) <= 2 * 60 * 60 * 1000
    ) {
      sessionsOpened += 1;
      weekdays[date.getDay()].sessions += 1;
    }
    previous = snap;
  }

  const daily: DailyBucket[] = [...dailyMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ weeklySum: _w1, weeklyCount: _w2, sessionSum: _s1, sessionCount: _s2, ...bucket }) => ({
      ...bucket,
      weekly_pct_used_min: bucket.weekly_pct_used_min == null ? null : round2(bucket.weekly_pct_used_min),
      weekly_pct_used_avg: bucket.weekly_pct_used_avg == null ? null : round2(bucket.weekly_pct_used_avg),
      session_pct_used_min: bucket.session_pct_used_min == null ? null : round2(bucket.session_pct_used_min),
      session_pct_used_avg: bucket.session_pct_used_avg == null ? null : round2(bucket.session_pct_used_avg),
      credits_spent: Math.round(bucket.credits_spent),
    }));

  let mostActiveWeekday: number | null = null;
  let mostActiveCount = 0;
  for (const day of weekdays) {
    if (day.sessions > mostActiveCount) {
      mostActiveWeekday = day.weekday;
      mostActiveCount = day.sessions;
    }
  }

  return {
    summary: {
      days_covered: daily.length,
      range_start: sorted[0].timestamp,
      range_end: sorted[sorted.length - 1].timestamp,
      avg_weekly_pct_left: weeklyUsedCount ? round2(100 - weeklyUsedSum / weeklyUsedCount) : null,
      peak_weekly_pct_used: peakWeekly == null ? null : round2(peakWeekly),
      avg_session_pct_left: sessionUsedCount ? round2(100 - sessionUsedSum / sessionUsedCount) : null,
      peak_session_pct_used: peakSession == null ? null : round2(peakSession),
      credits_spent: Math.round(creditsSpent),
      credits_gained: Math.round(creditsGained),
      sessions_opened: sessionsOpened,
      most_active_weekday: mostActiveWeekday,
      most_active_weekday_sessions: mostActiveCount,
    },
    daily,
    weekday: weekdays,
    computed_at: new Date().toISOString(),
  };
}

function emptySummary(): StatisticsSummary {
  return {
    days_covered: 0,
    range_start: '',
    range_end: '',
    avg_weekly_pct_left: null,
    peak_weekly_pct_used: null,
    avg_session_pct_left: null,
    peak_session_pct_used: null,
    credits_spent: 0,
    credits_gained: 0,
    sessions_opened: 0,
    most_active_weekday: null,
    most_active_weekday_sessions: 0,
  };
}

function emptyWeekdays(): WeekdayBucket[] {
  return Array.from({ length: 7 }, (_, weekday) => ({ weekday, sessions: 0 }));
}
