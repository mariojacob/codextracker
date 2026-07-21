// Shared types used by both main and renderer processes.

/** Notification rule. Mirrors settings.ts:NotificationRule (kept in sync). */
export interface NotificationRule {
  id: string;
  card: 'session' | 'weekly' | 'credits' | 'resets' | 'forecast';
  field: 'pct_left';
  threshold: number;
  enabled: boolean;
}

/** User settings. Mirrors settings.ts:Settings. */
export type Language = 'en' | 'de';

export interface Settings {
  refresh_seconds: number;
  /**
   * Refresh interval for the willcodexquotareset.com forecast feed.
   * Independent of `refresh_seconds` (which drives the Codex API).
   * Server refreshes every ~30 min, so values below 10 are clamped.
   */
  forecast_minutes: number;
  notifications: {
    enabled: boolean;
    rules: NotificationRule[];
  };
  history_days: number;
  /** UI language. Defaults to 'en'. */
  language: Language;
}

/** Compact forecast snapshot pulled from willcodexquotareset.com. */
export interface ForecastSnapshot {
  /** ISO timestamp of when the server last refreshed its sources. */
  fetched_at: string;
  /** Likelihood of a Codex quota reset in the next 48h, 0..100. */
  score: number;
  /** Server detected an explicit upcoming reset announcement. */
  reset_announced: boolean;
  /** When the most recent reset was observed. null if unknown. */
  latest_reset_at: string | null;
  /** Days elapsed since the most recent reset. */
  days_since_reset: number;
  /** Up to 3 most informative recent score changes (sorted by |delta|). */
  recent_changes: Array<{
    at: string;
    delta: number;
    label: string;
  }>;
}

/** One history snapshot. Mirrors history.ts:HistorySnapshot. */
export interface HistorySnapshot {
  timestamp: string;
  session_pct_left: number;
  weekly_pct_left: number;
  credits_balance: number | null;
  reset_credits_available: number;
}

/** Cached data from the last successful refresh. Mirrors refresh-service.ts:CachedSnapshot. */
export interface CachedSnapshot {
  fetched_at: string;
  error: string | null;
  plan: string;
  email: string;
  /** Remaining session quota (0..100). null = API didn't supply a window this tick. */
  session_pct_left: number | null;
  /** Remaining weekly quota (0..100). null = API didn't supply a window this tick. */
  weekly_pct_left: number | null;
  credits_balance: number | null;
  reset_credits_available: number;
  session_reset_in: string;
  weekly_reset_in: string;
  /** Absolute reset moment (ms epoch). Populated when the API gives us a reset_at. */
  session_reset_at: number | null;
  weekly_reset_at: number | null;
  reset_credit_details: ResetCreditEntry[];
  /**
   * Whether the API is currently supplying a usable 5h/session window.
   * When OpenAI disables the 5h rolling limit, `rate_limit.primary_window`
   * is null/absent for many ticks in a row — the UI hides the Session
   * section once this flips to false and shows it again as soon as a
   * valid primary_window comes back.
   */
  session_window_available: boolean;
  /** Latest forecast snapshot. null until first successful fetch. */
  forecast: ForecastSnapshot | null;
  /** Last forecast fetch error message. Cleared on next success. */
  forecast_error: string | null;
}

/** One day in the statistics window (YYYY-MM-DD in local time). */
export interface DailyBucket {
  date: string;
  weekly_pct_used_min: number | null;
  weekly_pct_used_avg: number | null;
  session_pct_used_min: number | null;
  session_pct_used_avg: number | null;
  credits_spent: number;
  snapshots: number;
}

/** Aggregated usage grouped by day of week (0 = Sunday .. 6 = Saturday). */
export interface WeekdayBucket {
  weekday: number;
  sessions: number;
}

/** Overall summary numbers for the statistics window. */
export interface StatisticsSummary {
  days_covered: number;
  range_start: string;
  range_end: string;
  avg_weekly_pct_left: number | null;
  peak_weekly_pct_used: number | null;
  avg_session_pct_left: number | null;
  peak_session_pct_used: number | null;
  credits_spent: number;
  credits_gained: number;
  sessions_opened: number;
  most_active_weekday: number | null;
  most_active_weekday_sessions: number;
}

/** Full statistics payload returned by main via STATS_GET IPC. */
export interface Statistics {
  summary: StatisticsSummary;
  daily: DailyBucket[];
  weekday: WeekdayBucket[];
  computed_at: string;
}

/** OAuth data read once from Codex CLI during an explicit import. */
export interface ImportedAuthTokens {
  access_token: string;
  refresh_token: string;
  account_id?: string;
}

/** Transient OAuth refresh response. Never persisted as JSON. */
export interface TokenRefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Source of the tokens currently in use. */
export type AuthSource = 'codex-cli' | 'manual' | 'none';

/** Snapshot returned by main to renderer. */
export interface AuthStatus {
  authenticated: boolean;
  source: AuthSource;
  email: string;
  plan: string;
  account_id: string;
  expires_at?: string;
  /** How long until the access token expires (seconds). -1 = unknown. */
  expires_in_seconds: number;
}

/** API errors from the Codex backend (matches the /wham/usage JSON shape). */
export interface UsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: RateWindow | null;
    secondary_window?: RateWindow | null;
  };
  credits?: {
    balance?: number | null;
    has_credits?: boolean;
    unlimited?: boolean;
  };
  user?: { email?: string };
}

export interface RateWindow {
  used_percent?: number;
  reset_at?: string | number;
  limit_window_seconds?: number;
}

/** Reset-credit entries from /wham/rate-limit-reset-credits. */
export interface ResetCreditsResponse {
  credits: ResetCreditEntry[];
  available_count: number;
}

export interface ResetCreditEntry {
  id: string;
  reset_type?: string;
  status: string;
  granted_at?: string;
  expires_at?: string;
  title?: string;
  description?: string;
}

/** Channel names for IPC. Keep in sync between main and preload. */
export const IPC = {
  AUTH_STATUS: 'auth:status',
  AUTH_IMPORT_CODEX: 'auth:import-codex',
  AUTH_LOGOUT: 'auth:logout',
  USAGE_FETCH: 'usage:fetch',
  RESET_CREDITS_FETCH: 'reset-credits:fetch',
  RESET_REDEEM: 'reset:redeem',
  HISTORY_GET: 'history:get',
  HISTORY_RECORD: 'history:record',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  STATS_GET: 'stats:get',
  WINDOW_OPEN_STATS: 'window:open-stats',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_QUIT: 'window:quit',
  APP_PING: 'app:ping',
} as const;
