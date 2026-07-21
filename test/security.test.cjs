const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTrustedIpcSender, validateResetCreditId, validateSettings } = require('../dist-main/main/security.js');

function validSettings() {
  return { refresh_seconds: 60, forecast_minutes: 20, history_days: 30, language: 'en', notifications: { enabled: true, rules: [{ id: 'weekly-low', card: 'weekly', field: 'pct_left', threshold: 20, enabled: true }] } };
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

test('reset credit IDs must be bounded and present in the current snapshot', () => {
  assert.equal(validateResetCreditId('known', ['known']), 'known');
  assert.throws(() => validateResetCreditId('unknown', ['known']), /Unknown/);
  assert.throws(() => validateResetCreditId('x'.repeat(257), ['x'.repeat(257)]), /Unknown/);
});
