/**
 * OAuth token lifecycle.
 *
 * Only the refresh token is persisted, via Windows Credential Manager.
 * Access tokens and their expiration timestamps live in this process only.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AuthSource,
  AuthStatus,
  ImportedAuthTokens,
  TokenRefreshResult,
} from '../../shared/types.js';
import type { CredentialStore } from './credential-store.js';
import { WindowsCredentialStore } from './credential-store.js';
import { refreshAccessToken, RefreshError } from './token-refresh.js';

const REFRESH_MARGIN_SECS = 5 * 60;

export interface PersistedAuthMetadata {
  source: Exclude<AuthSource, 'none'>;
  account_id?: string;
  email?: string;
  saved_at: string;
}

interface LegacyConfig {
  source?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    email?: string;
    expires_at?: string;
  };
}

interface MemoryAuthState {
  accessToken: string | null;
  expiresAt: number | null;
  metadata: PersistedAuthMetadata;
}

export interface TokenManagerOptions {
  credentialStore?: CredentialStore;
  configFile?: string;
  refresh?: (refreshToken: string) => Promise<TokenRefreshResult>;
  now?: () => number;
}

export function defaultConfigPath(): string {
  return path.join(os.homedir(), '.codex-tracker', 'config.json');
}

export class TokenManager {
  private readonly credentialStore: CredentialStore;
  private readonly configFile: string;
  private readonly refresh: (refreshToken: string) => Promise<TokenRefreshResult>;
  private readonly now: () => number;
  private state: MemoryAuthState | null = null;
  private hasCredential = false;
  private refreshPromise: Promise<void> | null = null;
  private readonly readyPromise: Promise<void>;

  constructor(options: TokenManagerOptions = {}) {
    this.credentialStore = options.credentialStore ?? new WindowsCredentialStore();
    this.configFile = options.configFile ?? defaultConfigPath();
    this.refresh = options.refresh ?? refreshAccessToken;
    this.now = options.now ?? Date.now;
    this.readyPromise = this.load();
  }

  private async load(): Promise<void> {
    let parsed: PersistedAuthMetadata | LegacyConfig | null = null;
    try {
      parsed = JSON.parse(await fs.readFile(this.configFile, 'utf-8')) as
        | PersistedAuthMetadata
        | LegacyConfig;
    } catch {
      parsed = null;
    }

    if (parsed && 'tokens' in parsed && parsed.tokens?.refresh_token) {
      await this.migrateLegacyConfig(parsed);
      return;
    }

    const metadata = this.parseMetadata(parsed);
    if (!metadata) return;
    const refreshToken = await this.credentialStore.getRefreshToken();
    this.hasCredential = !!refreshToken;
    this.state = { accessToken: null, expiresAt: null, metadata };
  }

  private async migrateLegacyConfig(config: LegacyConfig): Promise<void> {
    const legacy = config.tokens!;
    const source = config.source === 'codex-cli' ? 'codex-cli' : 'manual';
    const metadata: PersistedAuthMetadata = {
      source,
      ...(legacy.account_id ? { account_id: legacy.account_id } : {}),
      ...(legacy.email ? { email: legacy.email } : {}),
      saved_at: new Date(this.now()).toISOString(),
    };

    // The old plaintext file is replaced only after secure storage succeeds.
    await this.credentialStore.setRefreshToken(legacy.refresh_token!);
    await this.writeMetadata(metadata);

    this.hasCredential = true;
    this.state = {
      accessToken: legacy.access_token ?? null,
      expiresAt: legacy.expires_at ? Date.parse(legacy.expires_at) : null,
      metadata,
    };
  }

  private parseMetadata(value: PersistedAuthMetadata | LegacyConfig | null): PersistedAuthMetadata | null {
    if (!value || 'tokens' in value) return null;
    const metadata = value as PersistedAuthMetadata;
    if (metadata.source !== 'codex-cli' && metadata.source !== 'manual') return null;
    return {
      source: metadata.source,
      ...(typeof metadata.account_id === 'string' && metadata.account_id ? { account_id: metadata.account_id } : {}),
      ...(typeof metadata.email === 'string' && metadata.email ? { email: metadata.email } : {}),
      saved_at: typeof metadata.saved_at === 'string' ? metadata.saved_at : new Date(this.now()).toISOString(),
    };
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  isAuthenticated(): boolean {
    return this.hasCredential;
  }

  sourceOf(): AuthSource {
    return this.state?.metadata.source ?? 'none';
  }

  async setTokens(tokens: ImportedAuthTokens, source: Exclude<AuthSource, 'none'> = 'manual'): Promise<void> {
    await this.ready();
    await this.credentialStore.setRefreshToken(tokens.refresh_token);

    const metadata: PersistedAuthMetadata = {
      source,
      ...(tokens.account_id ? { account_id: tokens.account_id } : {}),
      saved_at: new Date(this.now()).toISOString(),
    };
    await this.writeMetadata(metadata);
    this.hasCredential = true;
    this.state = {
      accessToken: tokens.access_token,
      expiresAt: this.accessTokenExpiry(tokens.access_token),
      metadata,
    };
  }

  async logout(): Promise<void> {
    await this.ready();
    await this.credentialStore.deleteRefreshToken();
    this.hasCredential = false;
    this.state = null;
    try {
      await fs.unlink(this.configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async getAccessToken(): Promise<string> {
    await this.ready();
    if (!this.hasCredential) {
      throw new Error('Not authenticated. Import tokens from Codex CLI first.');
    }
    if (!this.state?.accessToken || this.shouldRefresh()) {
      await this.ensureRefreshed();
    }
    if (!this.state?.accessToken) throw new RefreshError('Token refresh produced no access token.');
    return this.state.accessToken;
  }

  async getAccountId(): Promise<string | undefined> {
    await this.ready();
    return this.state?.metadata.account_id;
  }

  async getStatus(emailFallback = ''): Promise<AuthStatus> {
    await this.ready();
    if (!this.hasCredential || !this.state) {
      return {
        authenticated: false,
        source: 'none',
        email: '',
        plan: '',
        account_id: '',
        expires_in_seconds: -1,
      };
    }
    const expiresAt = this.state.expiresAt;
    return {
      authenticated: true,
      source: this.state.metadata.source,
      email: this.state.metadata.email ?? emailFallback,
      plan: '',
      account_id: this.state.metadata.account_id ?? '',
      ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      expires_in_seconds: expiresAt ? Math.max(0, Math.round((expiresAt - this.now()) / 1000)) : -1,
    };
  }

  async updateEmail(email: string): Promise<void> {
    await this.ready();
    if (!this.state || !email || this.state.metadata.email === email) return;
    const metadata = { ...this.state.metadata, email, saved_at: new Date(this.now()).toISOString() };
    await this.writeMetadata(metadata);
    this.state.metadata = metadata;
  }

  private shouldRefresh(): boolean {
    if (!this.state?.expiresAt) return true;
    return (this.state.expiresAt - this.now()) / 1000 < REFRESH_MARGIN_SECS;
  }

  private async ensureRefreshed(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = await this.credentialStore.getRefreshToken();
    if (!refreshToken) {
      this.hasCredential = false;
      throw new RefreshError('Stored refresh token is missing. Please re-import from Codex CLI.');
    }
    const fresh = await this.refresh(refreshToken);

    // Token rotation must reach durable secure storage before the new access token is used.
    if (fresh.refresh_token && fresh.refresh_token !== refreshToken) {
      await this.credentialStore.setRefreshToken(fresh.refresh_token);
    }
    if (!this.state) throw new RefreshError('Authentication metadata is missing. Please re-import.');
    this.state.accessToken = fresh.access_token;
    this.state.expiresAt = this.now() + (fresh.expires_in ?? 3600) * 1000;
    this.hasCredential = true;
  }

  private accessTokenExpiry(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const json = Buffer.from(payload, 'base64url').toString('utf8');
      const exp = (JSON.parse(json) as { exp?: unknown }).exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private async writeMetadata(metadata: PersistedAuthMetadata): Promise<void> {
    const directory = path.dirname(this.configFile);
    await fs.mkdir(directory, { recursive: true });
    const tmp = `${this.configFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(metadata, null, 2), { encoding: 'utf-8', mode: 0o600 });
    try {
      await fs.rename(tmp, this.configFile);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
    await fs.chmod(this.configFile, 0o600).catch(() => undefined);
  }
}
