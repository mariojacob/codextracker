import { Entry } from '@napi-rs/keyring';

export const CREDENTIAL_SERVICE = 'CodexTracker';
export const CREDENTIAL_ACCOUNT = 'codex-oauth-refresh-token';

/** Secret storage boundary used by TokenManager and its unit tests. */
export interface CredentialStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
}

/** Windows Credential Manager-backed production implementation. */
export class WindowsCredentialStore implements CredentialStore {
  private readonly entry = new Entry(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT);

  async getRefreshToken(): Promise<string | null> {
    try {
      const value = this.entry.getPassword();
      return value && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    if (!token) throw new Error('Cannot store an empty refresh token.');
    this.entry.setPassword(token);
  }

  async deleteRefreshToken(): Promise<void> {
    try {
      this.entry.deletePassword();
    } catch {
      // Missing credentials are equivalent to a successful deletion.
    }
  }
}
