const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStatistics } = require('../dist-main/main/codex/stats.js');

test('old history fields are ignored while quota statistics remain available', () => {
  const history = [
    { timestamp: '2026-07-19T10:00:00.000Z', session_pct_left: 40, weekly_pct_left: 80, credits_balance: 100, reset_credits_available: 1, weekly_cost_estimate: 12, cost_by_model: { old: 12 }, total_tokens: 1234, tokens_by_model: { old: 1234 } },
    { timestamp: '2026-07-19T10:30:00.000Z', session_pct_left: 95, weekly_pct_left: 70, credits_balance: 90, reset_credits_available: 1, weekly_cost_estimate: 15, cost_by_model: { old: 15 }, total_tokens: 1600, tokens_by_model: { old: 1600 } },
  ];
  const result = computeStatistics(history);
  assert.equal(result.summary.credits_spent, 10);
  assert.equal(result.summary.sessions_opened, 1);
  assert.equal(result.summary.peak_weekly_pct_used, 30);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /cost|token|by_model/);
});

test('empty history returns the reduced wire format', () => {
  const result = computeStatistics([]);
  assert.equal(result.summary.days_covered, 0);
  assert.equal(result.weekday.length, 7);
  assert.doesNotMatch(JSON.stringify(result), /cost|token|by_model/);
});
