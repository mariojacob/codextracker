const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULE_IDS, moduleOrder, moveModule } = require('../dist-main/shared/modules.js');
const { validateSettings } = require('../dist-main/main/security.js');

const settings = (order) => ({
  module_order: order, providers: [], codex_enabled: true, refresh_seconds: 60,
  history_days: 30, language: 'de', notifications: { enabled: false, rules: [] },
});

test('legacy settings keep the default module order; partial orders append missing modules', () => {
  assert.deepEqual(validateSettings(settings(undefined)).module_order, MODULE_IDS);
  const order = validateSettings(settings(['deepseek', 'antigravity', 'codex'])).module_order;
  assert.deepEqual(order.slice(0, 3), ['deepseek', 'antigravity', 'codex']);
  assert.equal(order.length, MODULE_IDS.length);
  assert.equal(new Set(order).size, MODULE_IDS.length);
  assert.deepEqual(moduleOrder(order), order);
});

test('moving visible modules works in both directions, across categories and past disabled modules', () => {
  const initial = moduleOrder();
  const moved = moveModule(initial, 'codex', 'deepseek');
  assert.ok(moved.indexOf('deepseek') < moved.indexOf('codex'));
  assert.deepEqual(moved.filter((id) => id !== 'codex'), initial.filter((id) => id !== 'codex'));
  assert.deepEqual(moveModule(moved, 'codex', 'antigravity'), initial);
  assert.deepEqual(moveModule(initial, 'codex', 'codex'), initial);
  assert.deepEqual(initial, MODULE_IDS, 'the original settings are not mutated');
});

test('invalid persisted module orders are rejected at the IPC boundary', () => {
  for (const order of [null, 'codex', {}, ['codex', 'codex'], ['unknown'], [1], ['__proto__']]) {
    assert.throws(() => validateSettings(settings(order)), /module order/);
  }
});
