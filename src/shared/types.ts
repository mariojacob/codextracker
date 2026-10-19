// Shared types used by both main and renderer processes.
import type { ProviderSettings } from './providers.js';

/** Notification rule. Mirrors settings.ts:NotificationRule (kept in sync). */
export interface NotificationRule {
  id: string;
  card: 'session' | 'weekly' | 'credits' | 'resets';
  field: 'pct_left';
  threshold: number;
  enabled: boolean;
}

/** User settings. Mirrors settings.ts:Settings. */
export type Language = 'en' | 'de';

export interface Settings {
  /** Existing installations keep Codex enabled until explicitly disabled. */
  codex_enabled: boolean;
  providers: ProviderSettings[];
  refresh_seconds: number;
  notifications: {
    enabled: boolean;
    rules: NotificationRule[];
  };
  history_days: number;
  /** UI language. Defaults to 'en'. */
  language: Language;
}

/** One history snapshot. Mirrors history.ts:HistorySnapshot. */
export interface HistorySnapshot {
  version?: 2;
  session_reset_at?: number | null;
  weekly_reset_at?: number | null;
  session_window_seconds?: number | null;
  weekly_window_seconds?: number | null;
  refresh_seconds?: number;
  timestamp: string;
  session_pct_left: number | null;
  weekly_pct_left: number | null;
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
  weekly_window_seconds: number | null;
}

/** Observed changes during a reset-anchored budget day. */
export interface DailyBucket {
  start_at: number;
  end_at: number;
  weekly_consumed: number | null;
  credits_spent: number | null;
  credits_gained: number | null;
  incomplete: boolean;
  credits_incomplete: boolean;
  estimated: boolean;
  observed_ms: number;
}

export interface UsageTotal {
  value: number | null;
  incomplete: boolean;
}

export interface StatisticsSummary {
  current_day: UsageTotal;
  previous_day: UsageTotal;
  last_7_days: UsageTotal;
  last_30_days: UsageTotal;
  credits_spent: UsageTotal;
  credits_gained: UsageTotal;
}

export interface Statistics {
  summary: StatisticsSummary;
  daily: DailyBucket[];
  anchor_available: boolean;
  has_legacy_history: boolean;
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
  PROVIDERS_GET: 'providers:get',
  PROVIDERS_REFRESH: 'providers:refresh',
  PROVIDERS_CONNECTIONS: 'providers:connections',
  PROVIDER_SAVE_CREDENTIAL: 'providers:save-credential',
  PROVIDER_REMOVE_CREDENTIAL: 'providers:remove-credential',
  PROVIDER_IMPORT_CREDENTIAL: 'providers:import-credential',
  PROVIDER_OPEN_DASHBOARD: 'providers:open-dashboard',
} as const;
