import { Entry } from '@napi-rs/keyring';
import { readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderId, ProviderRegion } from '../../shared/providers.js';
import { ProviderFetchError } from './errors.js';

export interface ProviderCredential {
  secret: string;
  expires_at: number | null;
}

export interface ProviderCredentialStore {
  get(id: ProviderId, region: ProviderRegion): Promise<ProviderCredential | null>;
  set(id: ProviderId, region: ProviderRegion, value: ProviderCredential): Promise<void>;
  remove(id: ProviderId, region: ProviderRegion): Promise<void>;
}

export function validateProviderSecret(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ProviderFetchError('needs_auth');
  }
  const secret = value.trim().replace(/^Bearer\s+/i, '').trim();
  if (!secret) throw new ProviderFetchError('needs_auth');
  return secret;
}

export class WindowsProviderCredentialStore implements ProviderCredentialStore {
  private entry(id: ProviderId, region: ProviderRegion) {
    return new Entry('CodexTracker', `provider-${id}-${region}`);
  }

  async get(id: ProviderId, region: ProviderRegion): Promise<ProviderCredential | null> {
    // The native module throws for a missing entry as well as a failed read.
    let raw: string | null;
    try { raw = this.entry(id, region).getPassword(); }
    catch { return null; }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ProviderCredential;
      return { secret: validateProviderSecret(parsed.secret), expires_at: typeof parsed.expires_at === 'number' && Number.isFinite(parsed.expires_at) ? parsed.expires_at : null };
    } catch { throw new ProviderFetchError('keyring'); }
  }

  async set(id: ProviderId, region: ProviderRegion, value: ProviderCredential): Promise<void> {
    const secret = validateProviderSecret(value.secret);
    try { this.entry(id, region).setPassword(JSON.stringify({ secret, expires_at: value.expires_at })); }
    catch { throw new ProviderFetchError('keyring'); }
  }

  async remove(id: ProviderId, region: ProviderRegion): Promise<void> {
    const existing = await this.get(id, region);
    if (!existing) return;
    try { this.entry(id, region).deletePassword(); }
    catch { throw new ProviderFetchError('keyring'); }
  }
}

export function importedCredential(id: ProviderId, raw: unknown, now = Date.now()): ProviderCredential {
  if (!raw || typeof raw !== 'object') throw new ProviderFetchError('needs_auth');
  const data = raw as Record<string, unknown>;
  let secret: unknown;
  let expires: unknown;
  if (id === 'claude') {
    const oauth = data.claudeAiOauth as Record<string, unknown> | undefined;
    secret = oauth?.accessToken;
    expires = oauth?.expiresAt;
  } else if (id === 'grok') {
    const entries = Object.entries(data).sort(([a], [b]) => Number(b.startsWith('https://auth.x.ai')) - Number(a.startsWith('https://auth.x.ai')));
    const account = entries.find(([key, value]) => /^https:\/\/(auth|accounts)\.x\.ai/.test(key) && value && typeof value === 'object')?.[1] as Record<string, unknown> | undefined;
    secret = account?.key;
    expires = account?.expires_at;
  } else { throw new ProviderFetchError('unsupported_response'); }
  let expiresAt: number | null = null;
  if (typeof expires === 'number' && Number.isFinite(expires)) expiresAt = expires < 1e12 ? expires * 1000 : expires;
  else if (typeof expires === 'string') {
    const n = /^\d+(?:\.\d+)?$/.test(expires) ? Number(expires) : NaN;
    const parsed = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(expires);
    if (Number.isFinite(parsed)) expiresAt = parsed;
  }
  if (expiresAt != null && expiresAt <= now + 30_000) throw new ProviderFetchError('expired');
  return { secret: validateProviderSecret(secret), expires_at: expiresAt };
}

/** Explicit user action only. Reads the documented file; never refreshes another CLI's login. */
export async function importLocalCredential(id: ProviderId): Promise<ProviderCredential> {
  const file = id === 'claude' ? path.join(os.homedir(), '.claude', '.credentials.json')
    : id === 'grok' ? path.join(os.homedir(), '.grok', 'auth.json') : null;
  if (!file) throw new ProviderFetchError('unsupported_response');
  try {
    if ((await stat(file)).size > 131072) throw new ProviderFetchError('needs_auth');
    return importedCredential(id, JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error instanceof ProviderFetchError) throw error;
    throw new ProviderFetchError('needs_auth');
  }
}
