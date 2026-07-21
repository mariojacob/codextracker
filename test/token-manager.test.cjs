const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TokenManager } = require('../dist-main/main/codex/tokens.js');

class FakeCredentialStore {
  constructor(token = null) { this.token = token; this.writes = []; this.deleted = false; }
  async getRefreshToken() { return this.token; }
  async setRefreshToken(token) { this.token = token; this.writes.push(token); }
  async deleteRefreshToken() { this.token = null; this.deleted = true; }
}

async function tempConfig(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tracker-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'config.json');
}

function jwtWithExpiry(exp) {
  const encoded = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${encoded}.signature`;
}

test('import stores only the refresh token in the credential store', async (t) => {
  const configFile = await tempConfig(t);
  const store = new FakeCredentialStore();
  const manager = new TokenManager({ credentialStore: store, configFile });
  await manager.ready();
  await manager.setTokens({ access_token: jwtWithExpiry(2_000_000_000), refresh_token: 'refresh-secret', account_id: 'acct-1' }, 'codex-cli');

  const raw = await fs.readFile(configFile, 'utf8');
  assert.equal(store.token, 'refresh-secret');
  assert.doesNotMatch(raw, /refresh-secret|access_token|refresh_token|id_token|expires_at/);
  assert.deepEqual(JSON.parse(raw).account_id, 'acct-1');
  assert.equal(await manager.getAccessToken(), jwtWithExpiry(2_000_000_000));
});

test('restart refreshes into RAM and saves rotation before returning access', async (t) => {
  const configFile = await tempConfig(t);
  const store = new FakeCredentialStore('old-refresh');
  await fs.writeFile(configFile, JSON.stringify({ source: 'codex-cli', account_id: 'acct', saved_at: '2026-01-01T00:00:00.000Z' }));
  const manager = new TokenManager({
    credentialStore: store,
    configFile,
    refresh: async (token) => {
      assert.equal(token, 'old-refresh');
      return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 };
    },
  });
  await manager.ready();
  assert.equal(manager.isAuthenticated(), true);
  assert.equal(await manager.getAccessToken(), 'new-access');
  assert.equal(store.token, 'new-refresh');
  assert.deepEqual(store.writes, ['new-refresh']);
  assert.doesNotMatch(await fs.readFile(configFile, 'utf8'), /new-access|new-refresh/);
});

test('legacy plaintext config migrates atomically to metadata', async (t) => {
  const configFile = await tempConfig(t);
  const store = new FakeCredentialStore();
  await fs.writeFile(configFile, JSON.stringify({ source: 'codex-cli', tokens: { access_token: 'legacy-access', refresh_token: 'legacy-refresh', id_token: 'legacy-id', account_id: 'acct', email: 'user@example.test', expires_at: '2099-01-01T00:00:00.000Z' } }));
  const manager = new TokenManager({ credentialStore: store, configFile });
  await manager.ready();
  const raw = await fs.readFile(configFile, 'utf8');
  assert.equal(store.token, 'legacy-refresh');
  assert.doesNotMatch(raw, /legacy-access|legacy-refresh|legacy-id|tokens|expires_at/);
  assert.equal((await manager.getStatus()).email, 'user@example.test');
});

test('failed legacy secure write leaves plaintext config unchanged', async (t) => {
  const configFile = await tempConfig(t);
  const original = JSON.stringify({ source: 'codex-cli', tokens: { access_token: 'a', refresh_token: 'r' } });
  await fs.writeFile(configFile, original);
  const store = new FakeCredentialStore();
  store.setRefreshToken = async () => { throw new Error('credential failure'); };
  const manager = new TokenManager({ credentialStore: store, configFile });
  await assert.rejects(manager.ready(), /credential failure/);
  assert.equal(await fs.readFile(configFile, 'utf8'), original);
});

test('missing credential is unauthenticated and logout removes only auth data', async (t) => {
  const configFile = await tempConfig(t);
  const store = new FakeCredentialStore();
  await fs.writeFile(configFile, JSON.stringify({ source: 'codex-cli', saved_at: '2026-01-01T00:00:00.000Z' }));
  const manager = new TokenManager({ credentialStore: store, configFile });
  await manager.ready();
  assert.equal(manager.isAuthenticated(), false);
  await assert.rejects(manager.getAccessToken(), /Not authenticated/);

  await manager.setTokens({ access_token: 'access', refresh_token: 'refresh' }, 'codex-cli');
  await manager.logout();
  assert.equal(store.deleted, true);
  await assert.rejects(fs.stat(configFile), { code: 'ENOENT' });
});
