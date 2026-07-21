/**
 * Reads Codex CLI's auth.json and returns our normalized AuthTokens.
 *
 * Why we need this: most users of CodexTracker also use Codex CLI. The CLI
 * already handles the OAuth dance, so we just borrow the tokens instead
 * of forcing the user through a second browser login.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ImportedAuthTokens } from '../../shared/types.js';

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

export class CodexAuthNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Codex CLI auth.json not found at ${path}. Run \`codex\` and sign in once first.`);
  }
}

export class CodexAuthInvalidError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

/** Returns the absolute path to Codex CLI's auth.json. Honors $CODEX_HOME. */
export function codexAuthPath(): string {
  const env = process.env.CODEX_HOME;
  if (env && env.trim().length > 0) return path.join(env, 'auth.json');
  return path.join(os.homedir(), '.codex', 'auth.json');
}

export async function readCodexAuth(explicitPath?: string): Promise<ImportedAuthTokens> {
  const p = explicitPath ?? codexAuthPath();

  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CodexAuthNotFoundError(p);
    }
    throw err;
  }

  let data: CodexAuthFile;
  try {
    data = JSON.parse(raw) as CodexAuthFile;
  } catch {
    throw new CodexAuthInvalidError(`Codex CLI auth.json at ${p} is not valid JSON.`);
  }

  if (data.OPENAI_API_KEY) {
    throw new CodexAuthInvalidError(
      'Codex CLI is currently using an API key, not OAuth. ' +
        'Tracker needs OAuth tokens, which are only created by `codex login`.',
    );
  }

  const tokens = data.tokens ?? {};
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new CodexAuthInvalidError(
      `Codex CLI auth.json at ${p} has no OAuth tokens. Run \`codex\` and sign in first.`,
    );
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    account_id: tokens.account_id,
  };
}
