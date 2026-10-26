const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, WEEK_SECONDS, weeklyBudget } = require('../dist-main/shared/quota.js');
const { bankedResetPlan, createManualReset, manualResetWindow, activeManualReset, manualResetBudget, manualResetMarker } = require('../dist-main/shared/manual-reset.js');
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

test('banked reset budget uses the earliest upcoming available expiry and the weekly cycle origin', () => {
  const credit = (id, at, status = 'available') => ({ id, status, expires_at: new Date(at).toISOString() });
  const credits = [credit('later', start + 6 * DAY_MS), credit('used', now + 1, 'used'),
    credit('expired', now), { id: 'unknown', status: 'available' },
    { id: 'invalid', status: 'available', expires_at: 'invalid' }, credit('next', start + 4 * DAY_MS)];
  const plan = bankedResetPlan(quota, credits, now);
  assert.equal(plan.reset_at, start + 4 * DAY_MS);
  assert.equal(plan.start_at, start);
  assert.equal(plan.start_used_percent, 0);
  assert.equal(plan.window_id, 'weekly');
  assert.equal(plan.enabled, true);
  const budget = manualResetBudget(60, plan, now);
  assert.equal(budget.targetPct, 75);
  assert.equal(budget.available, 35);
  assert.equal(budget.elapsedPct, 62.5);
  assert.equal(credits[0].id, 'later', 'selecting a deadline does not mutate the credits');
});

test('banked reset planning follows expiry, redemption and changed deadlines without drifting on refresh', () => {
  const first = { id: 'first', status: 'available', expires_at: new Date(now + DAY_MS).toISOString() };
  const second = { id: 'second', status: 'available', expires_at: new Date(now + 2 * DAY_MS).toISOString() };
  const original = bankedResetPlan(quota, [first, second], now);
  assert.deepEqual(bankedResetPlan({ ...quota, used_percent: 55 }, [first, second], now + 1000), original);
  assert.equal(bankedResetPlan(quota, [first, second], original.reset_at).reset_at, Date.parse(second.expires_at));
  assert.equal(bankedResetPlan(quota, [{ ...first, status: 'used' }, second], now).reset_at, Date.parse(second.expires_at));
  const extended = { ...first, expires_at: new Date(now + 3 * DAY_MS).toISOString() };
  assert.equal(bankedResetPlan(quota, [extended, second], now).reset_at, Date.parse(second.expires_at));
  const newCycle = { ...quota, reset_at: quota.reset_at + 7 * DAY_MS };
  const later = { ...second, expires_at: new Date(quota.reset_at + 2 * DAY_MS).toISOString() };
  const renewed = bankedResetPlan(newCycle, [later], quota.reset_at);
  assert.equal(renewed.start_at, quota.reset_at, 'a reported weekly reset starts a fresh budget');
});

test('banked reset plans support deadlines beyond the current weekly reset', () => {
  const expiry = quota.reset_at + 3 * DAY_MS;
  const plan = bankedResetPlan(quota, [{ id: 'later', status: 'available', expires_at: new Date(expiry).toISOString() }], now);
  assert.equal(plan.reset_at, expiry);
  assert.equal(manualResetBudget(60, plan, now).targetPct, 30);
});

test('banked reset planning falls back when no expiry or reliable weekly cycle is available', () => {
  assert.equal(bankedResetPlan(quota, [], now), undefined);
  assert.equal(bankedResetPlan(quota, [{ id: 'unknown', status: 'available' }], now), undefined);
  assert.equal(bankedResetPlan(quota, [{ id: 'invalid', status: 'available', expires_at: 'invalid' }], now), undefined);
  const credits = [{ id: 'next', status: 'available', expires_at: new Date(quota.reset_at + DAY_MS).toISOString() }];
  for (const window of [{ ...quota, reset_at: null }, { ...quota, reset_at: NaN },
    { ...quota, window_seconds: null }, { ...quota, window_seconds: 18000 }]) {
    assert.equal(bankedResetPlan(window, credits, now), undefined);
  }
  for (const at of [NaN, start - 1, quota.reset_at]) assert.equal(bankedResetPlan(quota, credits, at), undefined);
});

test('settings preserve the banked budget preference independently from saved manual deadlines', () => {
  const base = { providers: [], refresh_seconds: 60, history_days: 30, language: 'de', notifications: { enabled: false, rules: [] } };
  const manual_resets = { codex: createManualReset(quota, now + DAY_MS, undefined, now) };
  assert.equal(validateSettings(base).codex_banked_reset_budget, undefined);
  for (const selected of [true, false]) {
    const settings = validateSettings({ ...base, manual_resets, codex_banked_reset_budget: selected });
    assert.equal(settings.codex_banked_reset_budget, selected);
    assert.deepEqual(settings.manual_resets, manual_resets);
  }
  for (const invalid of [null, 0, 1, 'true', {}, []]) {
    assert.throws(() => validateSettings({ ...base, codex_banked_reset_budget: invalid }), /banked reset/);
  }
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
