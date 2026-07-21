/**
 * Client for willcodexquotareset.com, an unofficial "quota meteorology"
 * service that scores the likelihood of a Codex usage-limit reset in
 * the next 48 hours based on OpenAI status incidents and Tibo's tweets.
 *
 * The endpoint is a public JSON API (no auth required). The server
 * refreshes its sources every ~30 minutes and tells us when it's safe
 * to ask again via `nextRefreshAt`.
 */
import type { ForecastSnapshot } from '../../shared/types.js';

const FORECAST_API_URL = 'https://www.willcodexquotareset.com/api/forecast';

interface RawForecastHistoryItem {
  at?: string;
  changes?: Array<{
    delta?: number;
    label?: string;
    from?: number;
    to?: number;
  }>;
}

interface RawResponse {
  fetchedAt?: string;
  nextRefreshAt?: string;
  forecast?: {
    score?: number;
    resetAnnounced?: boolean;
    latestResetAt?: string | null;
    daysSinceReset?: number;
  };
  history?: RawForecastHistoryItem[];
}

interface ForecastFetchResult {
  snapshot: ForecastSnapshot;
  nextRefreshAt: string | null;
}

export class ForecastError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Pulls and shapes the forecast JSON into our internal ForecastSnapshot. */
export async function fetchForecast(): Promise<ForecastFetchResult> {
  const resp = await fetch(FORECAST_API_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new ForecastError(resp.status, `Forecast API returned HTTP ${resp.status}`);
  }
  const raw = (await resp.json()) as RawResponse;
  const score = clampNumber(raw.forecast?.score, 0, 100) ?? 0;
  const resetAnnounced = Boolean(raw.forecast?.resetAnnounced);

  const recentChanges = (raw.history ?? [])
    .slice(0, 5)
    .flatMap((entry) => {
      if (!entry?.at) return [];
      const at = entry.at;
      return (entry.changes ?? []).map((change) => ({
        at,
        delta: typeof change?.delta === 'number' ? change.delta : 0,
        label: typeof change?.label === 'string' ? change.label : '',
      }));
    })
    .filter((c) => c.label !== '' && c.label !== 'baseline');

  // Cap to the 3 most informative changes (biggest absolute delta).
  recentChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topChanges = recentChanges.slice(0, 3);

  return {
    snapshot: {
      fetched_at: raw.fetchedAt ?? new Date().toISOString(),
      score,
      reset_announced: resetAnnounced,
      latest_reset_at: raw.forecast?.latestResetAt ?? null,
      days_since_reset: typeof raw.forecast?.daysSinceReset === 'number'
        ? raw.forecast.daysSinceReset
        : 0,
      recent_changes: topChanges,
    },
    nextRefreshAt: typeof raw.nextRefreshAt === 'string' ? raw.nextRefreshAt : null,
  };
}

function clampNumber(n: unknown, min: number, max: number): number | null {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : null;
}
