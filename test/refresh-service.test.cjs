const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RefreshService } = require('../dist-main/main/refresh-service.js');
const history = require('../dist-main/main/codex/history.js');
const { WEEK_SECONDS } = require('../dist-main/shared/quota.js');
const api = require('../dist-main/main/codex/api.js');
const moduleSettings = (enabled) => ({ codex_enabled: enabled, providers: [], refresh_seconds: 60, history_days: 30, language: 'en', notifications: { enabled: true, rules: [] } });

test('disabled Codex module makes no token, quota or redemption requests and schedules no polling', async () => {
  let tokenReads = 0;
  const service = new RefreshService({ isAuthenticated: () => true, getAccessToken: async () => { tokenReads++; throw new Error('must not read'); } });
  service.updateSettings(moduleSettings(false));
  assert.equal(service.isEnabled(), false);
  assert.equal(service.timer, null);
  await service.refreshNow();
  await service.tick();
  assert.equal(service.timer, null);
  assert.equal(tokenReads, 0);
  assert.equal((await service.redeemCredit('anything')).ok, false);
  service.stop();
});

test('Codex disable aborts pending quota reads, rejects late results and re-enable resumes with the same login', async () => {
  const originalUsage = api.fetchUsage, originalResets = api.fetchResetCredits, originalAppend = history.appendSnapshot;
  const pending = [];
  let recordings = 0, notifications = 0, tokenReads = 0;
  const service = new RefreshService({
    isAuthenticated: () => true,
    getAccessToken: async () => { tokenReads++; return 'test-access-token'; },
    getAccountId: async () => 'test-account', updateEmail: async () => {},
  });
  service.checkNotifications = () => { notifications++; };
  api.fetchUsage = (_token, _account, signal) => new Promise((resolve) => pending.push({ resolve, signal }));
  api.fetchResetCredits = async () => ({ credits: [], available_count: 0 });
  history.appendSnapshot = async () => { recordings++; };
  const usage = (used) => ({ rate_limit: { primary_window: { used_percent: used, reset_at: Date.now() + 86400000, limit_window_seconds: WEEK_SECONDS } } });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    service.updateSettings(moduleSettings(true));
    await flush();
    assert.equal(pending.length, 1, 'enabling starts an immediate read');
    service.updateSettings(moduleSettings(false));
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(service.timer, null);
    assert.equal(service.getSnapshot().weekly_pct_left, null);
    service.updateSettings(moduleSettings(true));
    await flush();
    assert.equal(pending.length, 2);
    pending[1].resolve(usage(40));
    await flush();
    assert.equal(service.getSnapshot().weekly_pct_left, 60);
    pending[0].resolve(usage(80));
    await flush();
    assert.equal(service.getSnapshot().weekly_pct_left, 60, 'old response cannot overwrite resumed data');
    assert.equal(recordings, 1);
    assert.equal(notifications, 1);
    assert.equal(tokenReads, 2);
  } finally {
    service.stop(); api.fetchUsage = originalUsage; api.fetchResetCredits = originalResets; history.appendSnapshot = originalAppend;
  }
});

test('history records fresh nullable API values independently from display fallbacks', async () => {
  const service = new RefreshService({});
  const reset = Date.now() + 5 * 86400000;
  const usage = { rate_limit: { primary_window: { used_percent: 30, reset_at: reset, limit_window_seconds: WEEK_SECONDS } }, credits: { balance: 12.34 } };
  const resets = { credits: [], available_count: 0 };
  service.snapshot = service.buildSnapshot(usage, resets);
  const missing = { rate_limit: { primary_window: null, secondary_window: null }, credits: { balance: 12.34 } };
  const snapshot = service.buildSnapshot(missing, resets);
  assert.equal(snapshot.weekly_pct_left, 70, 'display keeps its previous value');
  const append = history.appendSnapshot;
  let recorded;
  history.appendSnapshot = async (entry) => { recorded = entry; };
  try {
    await service.recordHistory(snapshot, missing);
    assert.equal(recorded.version, 2);
    assert.equal(recorded.weekly_pct_left, null);
    assert.equal(recorded.session_pct_left, null);
    assert.equal(recorded.weekly_reset_at, null);
    assert.equal(recorded.credits_balance, 12.34);
    await service.recordHistory(service.snapshot, usage);
    assert.equal(recorded.weekly_pct_left, 70);
    assert.equal(recorded.weekly_reset_at, reset);
    assert.equal(recorded.weekly_window_seconds, WEEK_SECONDS);
  } finally { history.appendSnapshot = append; }
});

test('runtime source no longer contains a forecast endpoint or polling loop', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../dist-main/main/refresh-service.js'), 'utf8');
  assert.doesNotMatch(runtime, /willcodexquotareset|fetchForecast|forecastTimer|refreshForecast/);
  assert.equal(fs.existsSync(path.join(__dirname, '../dist-main/main/codex/forecast.js')), false);
});
