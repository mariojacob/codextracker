const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStatistics } = require('../dist-main/main/codex/stats.js');
const { DAY_MS, WEEK_SECONDS } = require('../dist-main/shared/quota.js');
const start = Date.parse('2026-10-19T14:00:00Z');
const reset = start + 7 * DAY_MS;
const minute = 60000;
const options = (now = start + 5 * minute) => ({ now, resetAt: reset, windowSeconds: WEEK_SECONDS, refreshSeconds: 60 });
const sample = (at, left, extra = {}) => ({
  version: 2, timestamp: new Date(at).toISOString(), weekly_pct_left: left,
  session_pct_left: null, weekly_reset_at: reset, session_reset_at: null,
  weekly_window_seconds: WEEK_SECONDS, session_window_seconds: null,
  refresh_seconds: 60, credits_balance: 100, reset_credits_available: 1, ...extra,
});

test('observed consumption sums real deltas, including observed zero', () => {
  const result = computeStatistics([
    sample(start, 100), sample(start + minute, 90), sample(start + 2 * minute, 90),
    sample(start + 3 * minute, 85), sample(start + 5 * minute, 80),
  ], options());
  assert.deepEqual(result.summary.current_day, { value: 20, incomplete: false });
  assert.equal(result.daily.at(-1).observed_ms, 5 * minute);
  assert.equal(result.summary.previous_day.value, null);
  const zero = computeStatistics([sample(start, 100), sample(start + minute, 100)], options(start + minute));
  assert.equal(zero.summary.current_day.value, 0);
  assert.equal(zero.summary.current_day.incomplete, false);
});

test('reset jumps and changed reset timestamps start a new comparison', () => {
  const result = computeStatistics([
    sample(start, 50), sample(start + minute, 99), sample(start + 2 * minute, 95),
    sample(start + 3 * minute, 90, { weekly_reset_at: reset + minute }),
    sample(start + 4 * minute, 85, { weekly_reset_at: reset + minute }),
  ], options());
  assert.equal(result.summary.current_day.value, 9);
  assert.equal(result.summary.current_day.incomplete, true);
});

test('missing fresh windows break comparisons; cached values are not bridged', () => {
  const result = computeStatistics([
    sample(start, 100), sample(start + minute, null), sample(start + 2 * minute, 20),
    sample(start + 3 * minute, 15), sample(start + 4 * minute, NaN), sample(start + 5 * minute, 1),
  ], options());
  assert.equal(result.summary.current_day.value, 5);
  assert.equal(result.summary.current_day.incomplete, true);
  for (const invalid of [null, NaN, -1, 101]) {
    const missing = computeStatistics([sample(start, 100), sample(start + minute, invalid)], options());
    assert.equal(missing.summary.current_day.value, null);
  }
});

test('long gaps are excluded, exactly allowed intervals are included', () => {
  const gap = computeStatistics([sample(start, 100), sample(start + 6 * minute, 10)], options(start + 6 * minute));
  assert.equal(gap.summary.current_day.value, null);
  assert.equal(gap.summary.current_day.incomplete, true);
  const boundary = computeStatistics([sample(start, 100), sample(start + 5 * minute, 90)], options());
  assert.equal(boundary.summary.current_day.value, 10);
  const slower = computeStatistics([sample(start, 100, { refresh_seconds: 600 }), sample(start + 20 * minute, 90, { refresh_seconds: 600 })], { ...options(start + 20 * minute), refreshSeconds: 600 });
  assert.equal(slower.summary.current_day.value, 10);
});

test('short intervals crossing budget boundaries are proportionally allocated', () => {
  const boundary = start + DAY_MS;
  const result = computeStatistics([sample(boundary - minute, 90), sample(boundary + minute, 80)], options(boundary + minute));
  assert.equal(result.summary.current_day.value, 5);
  assert.equal(result.summary.previous_day.value, 5);
  assert.equal(result.daily.at(-1).estimated, true);
  assert.equal(result.daily.at(-2).estimated, true);
  assert.equal(result.summary.last_7_days.value, 10);
});

test('old history is retained as legacy without deriving consumption from fabricated zeroes', () => {
  const legacy = [sample(start, 100), sample(start + minute, 0)].map(({ version, weekly_reset_at, weekly_window_seconds, ...row }) => row);
  const result = computeStatistics(legacy, options());
  assert.equal(result.has_legacy_history, true);
  assert.equal(result.summary.current_day.value, null);
  assert.equal(result.summary.last_30_days.incomplete, true);
  assert.doesNotMatch(JSON.stringify(result), /sessions_opened|cost|token|weekday/);
});

test('credit changes preserve fractional values and missing balances create gaps', () => {
  const result = computeStatistics([
    sample(start, 100, { credits_balance: 10.25 }), sample(start + minute, 90, { credits_balance: 9.9 }),
    sample(start + 2 * minute, 80, { credits_balance: 11.15 }), sample(start + 3 * minute, 75, { credits_balance: null }),
    sample(start + 4 * minute, 70, { credits_balance: 1 }),
  ], options());
  assert.equal(result.summary.credits_spent.value, .35);
  assert.equal(result.summary.credits_gained.value, 1.25);
  assert.equal(result.summary.credits_spent.incomplete, true);
});

test('missing and expired anchors do not invent calendar-day statistics', () => {
  assert.equal(computeStatistics([], options()).daily.length, 30);
  assert.equal(computeStatistics([], options()).summary.current_day.value, null);
  for (const invalid of [null, start - 1, reset + 8 * DAY_MS]) {
    const result = computeStatistics([sample(start, 90)], { ...options(), resetAt: invalid });
    assert.equal(result.anchor_available, false);
    assert.equal(result.daily.length, 0);
  }
});

test('duplicates, unsorted input, invalid and future timestamps do not inflate consumption', () => {
  const result = computeStatistics([
    sample(start + minute, 90), sample(start, 100), sample(start + minute, 90),
    sample(start + 2 * minute, 80), sample(start + DAY_MS, 0), { ...sample(start, 100), timestamp: 'invalid' },
  ], options());
  assert.equal(result.summary.current_day.value, 20);
  assert.equal(result.daily.at(-1).observed_ms, 2 * minute);
});

test('totals may exceed 100 across multiple reset windows without counting the reset itself', () => {
  const history = [];
  for (let day = 0; day < 14; day++) {
    const at = start - (14 - day) * DAY_MS;
    const end = at + WEEK_SECONDS * 1000;
    history.push(sample(at, 100, { weekly_reset_at: end }), sample(at + minute, 80, { weekly_reset_at: end }));
  }
  const result = computeStatistics(history, options());
  assert.equal(result.summary.last_30_days.value, 280);
  assert.equal(result.summary.last_30_days.incomplete, true);
});
