const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, WEEK_SECONDS, weeklyBudget, availableResetCredits, expiryUrgency } = require('../dist-main/shared/quota.js');
const reset = Date.parse('2026-10-26T15:00:00Z');
const start = reset - 7 * DAY_MS;

test('weekly budget starts at day one and changes at every reset-anchored boundary', () => {
  for (let day = 1; day <= 7; day++) {
    const now = start + (day - 1) * DAY_MS;
    const result = weeklyBudget(100, reset, WEEK_SECONDS, now);
    assert.equal(result.day, day);
    assert.equal(result.dayEnd, start + day * DAY_MS);
    assert.equal(result.targetPct, day * 100 / 7);
    if (day > 1) assert.equal(weeklyBudget(100, reset, WEEK_SECONDS, now - 1).day, day - 1);
  }
  assert.equal(weeklyBudget(0, reset, WEEK_SECONDS, reset - 1).day, 7);
  assert.equal(weeklyBudget(0, reset, WEEK_SECONDS, reset), null);
});

test('saved budget carries forward and overconsumption reduces allowance', () => {
  const now = start + 2.5 * DAY_MS;
  const saved = weeklyBudget(65, reset, WEEK_SECONDS, now);
  assert.equal(saved.day, 3);
  assert.ok(Math.abs(saved.available - 7.857142857) < 1e-6);
  assert.equal(saved.over, 0);
  const over = weeklyBudget(50, reset, WEEK_SECONDS, now);
  assert.equal(over.available, 0);
  assert.ok(Math.abs(over.over - 7.142857143) < 1e-6);
  assert.ok(Math.abs(saved.elapsedPct - 100 * 2.5 / 7) < 1e-6);
  assert.equal(weeklyBudget(100, reset + DAY_MS, WEEK_SECONDS, now).day, 2);
});

test('missing, out of range and implausible window data has no budget', () => {
  for (const [left, at, length, now] of [
    [null, reset, WEEK_SECONDS, start], [NaN, reset, WEEK_SECONDS, start],
    [-1, reset, WEEK_SECONDS, start], [101, reset, WEEK_SECONDS, start],
    [50, null, WEEK_SECONDS, start], [50, NaN, WEEK_SECONDS, start],
    [50, reset, null, start], [50, reset, 18000, start],
    [50, reset, WEEK_SECONDS, start - 1], [50, reset, WEEK_SECONDS, reset + 1],
  ]) assert.equal(weeklyBudget(left, at, length, now), null);
});

test('day boundaries use elapsed 24h across the Vienna daylight-saving transition', () => {
  const before = weeklyBudget(100, reset, WEEK_SECONDS, Date.parse('2026-10-25T14:59:59Z'));
  const after = weeklyBudget(100, reset, WEEK_SECONDS, Date.parse('2026-10-25T15:00:00Z'));
  assert.equal(before.day, 6);
  assert.equal(after.day, 7);
  assert.equal(after.dayEnd - before.dayEnd, DAY_MS);
  const hour = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23' }).format(ms);
  assert.equal(hour(Date.parse('2026-10-24T15:00:00Z')), '17');
  assert.equal(hour(Date.parse('2026-10-25T15:00:00Z')), '16');
});

test('reset urgency uses inclusive 72h/24h boundaries and removes expired credits', () => {
  const now = start;
  assert.equal(expiryUrgency(now + 3 * DAY_MS + 1, now), 'normal');
  assert.equal(expiryUrgency(now + 3 * DAY_MS, now), 'warn');
  assert.equal(expiryUrgency(now + DAY_MS + 1, now), 'warn');
  assert.equal(expiryUrgency(now + DAY_MS, now), 'err');
  assert.equal(expiryUrgency(now + 1, now), 'err');
  assert.equal(expiryUrgency(now, now), 'expired');
  assert.equal(expiryUrgency(null, now), 'normal');
  const credit = (id, time, status = 'available') => ({ id, status, expires_at: time == null ? undefined : new Date(time).toISOString() });
  const credits = [credit('unknown', null), credit('later', now + 5 * DAY_MS), credit('expired', now), credit('soon', now + DAY_MS), credit('redeemed', now + DAY_MS, 'used'), { id: 'invalid', status: 'available', expires_at: 'invalid' }];
  assert.deepEqual(availableResetCredits(credits, now).map((c) => c.id), ['soon', 'later', 'unknown', 'invalid']);
  assert.equal(credits[0].id, 'unknown', 'sorting must not mutate the source');
});
