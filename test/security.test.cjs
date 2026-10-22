const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTrustedIpcSender, validateResetCreditId, validateSettings } = require('../dist-main/main/security.js');
const { moduleOrder } = require('../dist-main/shared/modules.js');

function validSettings() {
  return { codex_enabled: true, providers: [], module_order: moduleOrder(), refresh_seconds: 60, history_days: 30, language: 'en', notifications: { enabled: true, rules: [{ id: 'weekly-low', card: 'weekly', field: 'pct_left', threshold: 20, enabled: true }] } };
}

test('IPC accepts only a known window main frame', () => {
  const frame = {};
  const sender = { id: 7, mainFrame: frame, isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents: sender };
  assert.doesNotThrow(() => assertTrustedIpcSender({ sender, senderFrame: frame }, [window]));
  assert.throws(() => assertTrustedIpcSender({ sender: { ...sender, id: 8 }, senderFrame: frame }, [window]), /untrusted/);
  assert.throws(() => assertTrustedIpcSender({ sender, senderFrame: {} }, [window]), /untrusted/);
});

test('settings validation enforces ranges and allowlists', () => {
  assert.deepEqual(validateSettings(validSettings()), validSettings());
  assert.throws(() => validateSettings({ ...validSettings(), refresh_seconds: 9 }), /between 10 and 3600/);
  assert.throws(() => validateSettings({ ...validSettings(), language: 'fr' }), /language/);
  const badCard = validSettings(); badCard.notifications.rules[0].card = 'shell';
  assert.throws(() => validateSettings(badCard), /card/);
  const badThreshold = validSettings(); badThreshold.notifications.rules[0].threshold = 101;
  assert.throws(() => validateSettings(badThreshold), /threshold/);
});

test('Codex module defaults to enabled for existing settings and only accepts boolean switches', () => {
  const legacy = validSettings(); delete legacy.codex_enabled;
  assert.equal(validateSettings(legacy).codex_enabled, true);
  assert.equal(validateSettings({ ...legacy, codex_enabled: false }).codex_enabled, false);
  for (const invalid of ['false', null, 0, {}]) {
    assert.throws(() => validateSettings({ ...legacy, codex_enabled: invalid }), /Codex/);
  }
});

test('reset credit IDs must be bounded and present in the current snapshot', () => {
  assert.equal(validateResetCreditId('known', ['known']), 'known');
  assert.throws(() => validateResetCreditId('unknown', ['known']), /Unknown/);
  assert.throws(() => validateResetCreditId('x'.repeat(257), ['x'.repeat(257)]), /Unknown/);
});


test('legacy forecast settings are removed without changing other preferences', () => {
  const legacy = validSettings();
  legacy.forecast_minutes = 42;
  legacy.language = 'de';
  legacy.refresh_seconds = 120;
  legacy.notifications.rules.push({ id: 'forecast-high', card: 'forecast', field: 'pct_left', threshold: 70, enabled: true });
  const expected = validSettings(); expected.language = 'de'; expected.refresh_seconds = 120;
  assert.deepEqual(validateSettings(legacy), expected);
  assert.doesNotMatch(JSON.stringify(validateSettings(legacy)), /forecast/);
});
