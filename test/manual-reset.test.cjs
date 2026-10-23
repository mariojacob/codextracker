const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, WEEK_SECONDS, weeklyBudget } = require('../dist-main/shared/quota.js');
const { createManualReset, manualResetWindow, activeManualReset, manualResetBudget, manualResetMarker } = require('../dist-main/shared/manual-reset.js');
const { validateSettings } = require('../dist-main/main/security.js');
const start = Date.parse('2026-10-19T15:00:00Z');
const now = start + 2.5 * DAY_MS;
const quota = { id: 'weekly', label: 'Weekly', reset_at: start + 7 * DAY_MS, window_seconds: WEEK_SECONDS, used_percent: 40 };

test('a one-time date automatically uses the main quota while preserving existing saved choices', () => {
  const session = { ...quota, id: 'session', window_seconds: 18000 };
  const monthly = { ...quota, id: 'monthly', window_seconds: null, reset_at: now + 20 * DAY_MS };
  assert.equal(manualResetWindow([session, quota], undefined, now).id, 'weekly');
  assert.equal(manualResetWindow([session, quota, monthly], undefined, now).id, 'monthly');
  const saved = createManualReset(session, now + DAY_MS, undefined, now);
  assert.equal(manualResetWindow([quota, session], saved, now).id, 'session');
  assert.equal(manualResetWindow([quota], saved, now).id, 'weekly');
  assert.equal(manualResetWindow([], saved, now), undefined);
});

test('an earlier manual reset increases the available budget and preserves the reported consumption', () => {
  const manual = { ...createManualReset(quota, start + 4 * DAY_MS, undefined, now), enabled: true };
  const result = manualResetBudget(60, manual, now);
  assert.equal(result.day, 3);
  assert.equal(result.targetPct, 75);
  assert.equal(result.elapsedPct, 62.5);
  assert.equal(result.available, 35);
  assert.deepEqual(result.segmentEnds, [25, 50, 75, 100]);
  assert.ok(result.available > weeklyBudget(60, quota.reset_at, quota.window_seconds, now).available);
  assert.equal(quota.used_percent, 40);
  assert.equal(manualResetMarker(manual, quota, now), 100);
  assert.ok(Math.abs(manualResetMarker({ ...manual, enabled: false }, quota, now) - 400 / 7) < 1e-9);
  assert.equal(activeManualReset(manual, 'session', now), false);
});

test('editing the deadline keeps the planning origin stable despite fresh provider data', () => {
  const original = createManualReset(quota, start + 4 * DAY_MS, undefined, now);
  const edited = createManualReset({ ...quota, reset_at: start + 14 * DAY_MS }, start + 5 * DAY_MS, original, now + DAY_MS);
  assert.equal(edited.start_at, original.start_at);
  assert.equal(edited.start_used_percent, 0);
  assert.equal(manualResetBudget(60, edited, now).targetPct, 60);
});

test('missing reset metadata plans only the remaining allowance and ends partial days at the deadline', () => {
  const manual = createManualReset({ ...quota, reset_at: null, window_seconds: null }, now + 1.5 * DAY_MS, undefined, now);
  assert.equal(manual.start_used_percent, 40);
  const result = manualResetBudget(50, manual, now + DAY_MS);
  assert.equal(result.day, 2);
  assert.equal(result.dayEnd, manual.reset_at);
  assert.equal(result.targetPct, 100);
  assert.equal(result.elapsedPct, 80);
  assert.deepEqual(result.segmentEnds, [80, 100]);
  assert.equal(result.available, 50);
});

test('expired plans do not wrap or fabricate new usage and invalid measurements have no budget', () => {
  const manual = createManualReset(quota, now + DAY_MS, undefined, now);
  assert.equal(activeManualReset(manual, quota.id, manual.reset_at), false);
  assert.equal(manualResetBudget(60, manual, manual.reset_at), null);
  assert.equal(manualResetMarker(manual, quota, manual.reset_at), undefined);
  for (const left of [null, undefined, NaN, -1, 101]) assert.equal(manualResetBudget(left, manual, now), null);
  const later = { ...manual, reset_at: quota.reset_at + DAY_MS };
  assert.equal(manualResetMarker(later, quota, now), undefined, 'out-of-range deadlines are not drawn on an unrelated time scale');
  assert.equal(manualResetBudget(60, later, now).segmentEnds.at(-1), 100);
});

test('settings validate independent manual reset plans, including expired saved dates', () => {
  const base = { providers: [], refresh_seconds: 60, history_days: 30, language: 'de', notifications: { enabled: false, rules: [] } };
  const manual = createManualReset(quota, now + DAY_MS, undefined, now);
  const manual_resets = { codex: manual, claude: { ...manual, enabled: true, window_id: 'seven_day' } };
  assert.deepEqual(validateSettings({ ...base, manual_resets }).manual_resets, manual_resets);
  assert.equal(validateSettings(base).manual_resets, undefined);
  for (const invalid of [null, [], { unknown: manual }, { codex: [] }, { codex: { ...manual, enabled: 1 } },
    { codex: { ...manual, reset_at: NaN } }, { codex: { ...manual, reset_at: manual.start_at } },
    { codex: { ...manual, start_used_percent: 101 } }, { codex: { ...manual, window_id: '' } }]) {
    assert.throws(() => validateSettings({ ...base, manual_resets: invalid }), /manual reset/);
  }
});
