/**
 * Thin client for the Codex backend endpoints used by the tracker.
 *
 * The endpoints are reverse-engineered from CodexBar's open-source code
 * (steipete/CodexBar). They are NOT in the OIDC discovery — they use
 * /wham/* paths and require specific headers (originator: codex_cli_rs,
 * OpenAI-Beta: codex-1).
 */
import { RateWindow, ResetCreditsResponse, UsageResponse } from '../../shared/types.js';

const API_BASE = 'https://chatgpt.com/backend-api';
const ORIGINATOR = 'codex_cli_rs';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface FetchOpts {
  accountId?: string;
}

async function call<T>(path: string, accessToken: string, opts: FetchOpts = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: ORIGINATOR,
    'Content-Type': 'application/json',
  };
  if (opts.accountId) headers['ChatGPT-Account-ID'] = opts.accountId;

  const resp = await fetch(url, { method: 'GET', headers });
  if (resp.status !== 200) {
    if (resp.status === 401) {
      throw new ApiError(401, '401 Unauthorized — token invalid. Please re-import from Codex CLI.');
    }
    throw new ApiError(resp.status, `Codex backend request failed (HTTP ${resp.status}).`);
  }
  return (await resp.json()) as T;
}

export async function fetchUsage(
  accessToken: string,
  accountId?: string,
): Promise<UsageResponse> {
  return call<UsageResponse>('/wham/usage', accessToken, { accountId });
}

export async function fetchResetCredits(
  accessToken: string,
  accountId?: string,
): Promise<ResetCreditsResponse> {
  return call<ResetCreditsResponse>('/wham/rate-limit-reset-credits', accessToken, { accountId });
}

/**
 * Redeem a reset-credit. Endpoint reverse-engineered from CodexBar; the
 * exact body shape and response format are based on best-effort match
 * of the Codex CLI flow. If OpenAI changes this, we'll get a graceful
 * error and the user can fall back to using Codex CLI directly.
 */
export async function redeemResetCredit(
  accessToken: string,
  creditId: string,
  accountId?: string,
): Promise<{ ok: boolean; message: string }> {
  const url = `${API_BASE}/wham/rate-limit-reset-credits/redeem`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: ORIGINATOR,
    'Content-Type': 'application/json',
  };
  if (accountId) headers['ChatGPT-Account-ID'] = accountId;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ credit_id: creditId }),
  });
  if (!resp.ok) {
    return { ok: false, message: `Redeem failed (HTTP ${resp.status}).` };
  }
  return { ok: true, message: 'Reset credit redeemed.' };
}

/**
 * Compute remaining percentage (0..100) from a rate window.
 * Returns null when the API didn't supply a usable `used_percent` —
 * callers must preserve the previous value instead of showing a
 * misleading "100%" placeholder.
 */
export function pctLeft(window: RateWindow | null | undefined): number | null {
  if (!window || typeof window.used_percent !== 'number') return null;
  return Math.max(0, Math.min(100, 100 - window.used_percent));
}

/** Format a duration to "in 4d 12h" / "in 2h 30m" / "expired" / "—".
 * Accepts ISO strings, Date objects, Unix timestamps in seconds, or millis.
 */

/** Parse a reset_at value into ms-epoch. Returns null if unparseable. */
export function parseResetAt(target: Date | string | number | null | undefined): number | null {
  if (target === null || target === undefined || target === '') return null;
  let d: Date;
  if (target instanceof Date) {
    d = target;
  } else if (typeof target === 'number') {
    // < 1e12 → seconds, otherwise milliseconds
    d = new Date(target < 1e12 ? target * 1000 : target);
  } else {
    d = new Date(target);
  }
  const ms = d.getTime();
  return isNaN(ms) ? null : ms;
}

export function fmtTimedelta(target: Date | string | number | null | undefined): string {
  if (target === null || target === undefined || target === '') return '—';
  const t = parseResetAt(target);
  if (t == null) return '—';
  const ms = t - Date.now();
  if (ms <= 0) return 'expired';
  const secs = Math.floor(ms / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) return 'in <1m';
  return `in ${parts.join(' ')}`;
}
