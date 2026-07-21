/**
 * OAuth 2.0 refresh-token grant against OpenAI's auth.openai.com.
 *
 * The body MUST be JSON (not form-encoded) per codex-rs/login/src/auth/manager.rs.
 * The endpoint and the exact `client_id` are public — they're the same
 * parameters codex-cli itself uses.
 */
import type { TokenRefreshResult } from '../../shared/types.js';

const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ORIGINATOR = 'codex_cli_rs';
const SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';

export class RefreshError extends Error {}

export async function refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
  const body = JSON.stringify({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  let resp: Response;
  try {
    resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        originator: ORIGINATOR,
      },
      body,
    });
  } catch (err) {
    throw new RefreshError(`Network error during token refresh: ${(err as Error).message}`);
  }

  if (!resp.ok) {
    throw new RefreshError(`Token refresh failed (HTTP ${resp.status}).`);
  }

  const data = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new RefreshError('Refresh response missing access_token');
  }

  // Return as a plain refresh-result; TokenManager merges with stored tokens.
  // expires_in is a hint about token lifetime (seconds from now).
  return {
    access_token: data.access_token,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    expires_in: data.expires_in,
  };
}
