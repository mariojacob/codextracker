const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ProviderHistoryStore, historyScope } = require('../dist-main/main/providers/history.js');
const { computeProviderStatistics } = require('../dist-main/main/providers/statistics.js');
const { statisticsReport } = require('../dist-main/main/providers/statistics-report.js');
const { validateStatisticsSelection } = require('../dist-main/main/security.js');
const { ProviderService } = require('../dist-main/main/providers/service.js');
const { ProviderFetchError } = require('../dist-main/main/providers/errors.js');
const { defaultProviderSettings } = require('../dist-main/shared/providers.js');

const now = Date.UTC(2026, 9, 19, 12), day = 86400000, minute = 60000;
const at = (offset) => new Date(now + offset).toISOString();
const config = (id = 'claude', patch = {}) => ({ ...defaultProviderSettings(id), enabled: true, ...patch });
const quota = (used, patch = {}) => ({ id: 'weekly', label: 'weekly', used_percent: used, reset_at: now + 3 * day, window_seconds: 604800, ...patch });
const money = (value, patch = {}) => ({ kind: 'balance', currency: 'USD', period: null, value, ...patch });
const row = (offset, windows = [], amounts = [], patch = {}) => ({ version: 1, id: 'claude', region: 'global', timestamp: at(offset), context: 'context', scope: '', segment: 'segment', refresh_seconds: 60, windows, amounts, ...patch });
const settings = (providers = [], enabled = true) => ({ codex_enabled: enabled, providers, refresh_seconds: 60, language: 'de', history_days: 30, notifications: { enabled: false, rules: [] } });
const snapshot = (id, offset, windows = [], amounts = [], patch = {}) => ({ id, region: 'global', state: 'ready', fetched_at: at(offset), error: null, source: 'api', plan: 'private-test-plan', windows, amounts, ...patch });
const measurement = (snap, cfg = config(snap.id), patch = {}) => ({ snapshot: snap, config: cfg, observed_at: snap.fetched_at ?? at(0), refresh_seconds: 60, segment: 'test-process:1', ...patch });

test('provider quotas remain independent per model and window, sum observed deltas only and preserve fractions', () => {
  const rows = [row(-2 * minute, [quota(12.25), quota(4, { id: 'other', label: 'Opus' })]), row(-minute, [quota(15.5), quota(5, { id: 'other', label: 'Opus' })])];
  const result = computeProviderStatistics(rows, now - 30000);
  assert.equal(result.quotas.length, 2);
  assert.equal(result.quotas[0].summary.current_day.value, 3.25);
  assert.equal(result.quotas[1].summary.current_day.value, 1);
  assert.equal(result.quotas[0].alignment, 'budget');
  assert.equal(result.quotas[0].summary.current_day.incomplete, true);
  assert.equal(result.quotas[0].current_used, 15.5);
});

test('provider resets, decreases, missing samples, unknown windows, long gaps and tracking restarts are not counted', () => {
  const cases = [
    [row(-2 * minute, [quota(20)]), row(-minute, [quota(30, { reset_at: now + 4 * day })])],
    [row(-2 * minute, [quota(80)]), row(-minute, [quota(20)])],
    [row(-3 * minute, [quota(20)]), row(-2 * minute), row(-minute, [quota(30)])],
    [row(-2 * minute, [quota(20, { reset_at: null })]), row(-minute, [quota(30, { reset_at: null })])],
    [row(-20 * minute, [quota(20)]), row(-minute, [quota(30)])],
    [row(-2 * minute, [quota(20)]), row(-minute, [quota(30)], [], { segment: 'restarted' })],
    [row(-2 * minute, [quota(20)]), row(-minute, [quota(30)], [], { context: 'other-login' })],
  ];
  for (const rows of cases) assert.equal(computeProviderStatistics(rows, now).quotas[0].summary.last_30_days.value, null);
  const recovered = [...cases[1], row(0, [quota(25)])];
  assert.equal(computeProviderStatistics(recovered, now).quotas[0].summary.last_30_days.value, 5);
});

test('model-pool reordering cannot compare a different model under the same array-index identifier', () => {
  const before = row(-2 * minute, [quota(10, { id: '0', label: 'Gemini' }), quota(30, { id: '1', label: 'Claude' })]);
  const after = row(-minute, [quota(40, { id: '0', label: 'Claude' }), quota(20, { id: '1', label: 'Gemini' })]);
  const { quotas } = computeProviderStatistics([before, after], now);
  assert.equal(quotas.length, 4);
  assert.ok(quotas.every((metric) => metric.summary.last_30_days.value === null));
});

test('quota deltas across day boundaries are apportioned; calendar buckets handle non-weekly windows', () => {
  // Current budget day began at 12:00 UTC. Straddle that exact instant.
  const reset = now + 3 * day;
  const result = computeProviderStatistics([row(-minute, [quota(10, { reset_at: reset })]), row(minute, [quota(12, { reset_at: reset })])], now + 2 * minute);
  assert.equal(result.quotas[0].daily.at(-2).value, 1);
  assert.equal(result.quotas[0].daily.at(-1).value, 1);
  assert.equal(result.quotas[0].daily.at(-1).estimated, true);
  const short = computeProviderStatistics([row(-2 * minute, [quota(10, { window_seconds: 18000, reset_at: now + 3600000 })]), row(-minute, [quota(15, { window_seconds: 18000, reset_at: now + 3600000 })])], now);
  assert.equal(short.quotas[0].alignment, 'calendar');
  assert.equal(short.quotas[0].summary.last_7_days.value, 5);
});

test('multiple reset windows may exceed 100 points, duplicate/future readings never inflate totals', () => {
  const rows = [row(-5 * minute, [quota(0)]), row(-4 * minute, [quota(80)]), row(-3 * minute, [quota(0, { reset_at: now + 4 * day })]), row(-2 * minute, [quota(70, { reset_at: now + 4 * day })])];
  const result = computeProviderStatistics([rows[3], rows[0], rows[1], rows[1], rows[2], row(minute, [quota(100)])], now);
  assert.equal(result.quotas[0].summary.last_30_days.value, 150);
});

test('API currencies, deficits, top-ups and missing balances stay separate; changes are not billed costs', () => {
  const rows = [row(-3 * minute, [], [money(.1234), money(30, { currency: 'CNY' })]), row(-2 * minute, [], [money(-.0766), money(25, { currency: 'CNY' })]), row(-minute, [], [money(.0234)])];
  const { amounts } = computeProviderStatistics(rows, now);
  assert.equal(amounts.length, 2);
  assert.equal(amounts[0].decrease_summary.last_30_days.value, .2);
  assert.equal(amounts[0].increase_summary.last_30_days.value, .1);
  assert.equal(amounts[1].decrease_summary.last_30_days.value, 5);
  assert.equal(amounts[1].current, 25, 'last known reading has its own timestamp');
  assert.equal(amounts[1].decreased.at(-1).incomplete, true);
});

test('rolling API spend is a reported level, never summed or converted to daily cost; partial results are marked', () => {
  const rows = [row(-2 * minute, [], [money(12, { kind: 'spend', period: 'last_30_days' })]), row(-minute, [], [money(15, { kind: 'spend', period: 'last_30_days', partial: true })])];
  const metric = computeProviderStatistics(rows, now).amounts[0];
  assert.equal(metric.current, 15);
  assert.equal(metric.partial, true);
  assert.equal(metric.decrease_summary.last_30_days.value, null);
  assert.equal(metric.increase_summary.last_30_days.value, null);
  assert.equal(metric.trend.at(-1).value, 15);
  assert.equal(metric.trend.at(-1).incomplete, true);
});

test('calendar statistics use local midnight through the Vienna daylight-saving change', () => {
  const script = `const {computeProviderStatistics}=require(${JSON.stringify(path.resolve(__dirname, '../dist-main/main/providers/statistics.js'))});
    const now=Date.parse('2026-10-26T10:00:00Z');
    const row={version:1,id:'deepseek',region:'global',context:'c',scope:'',segment:'s',refresh_seconds:60,timestamp:new Date(now).toISOString(),windows:[],amounts:[{kind:'balance',currency:'USD',period:null,value:1}]};
    const days=computeProviderStatistics([row],now).amounts[0].trend;
    process.stdout.write(JSON.stringify(days.slice(-2).map(d=>(d.end_at-d.start_at)/3600000)));`;
  const hours = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Europe/Vienna' }, encoding: 'utf8' }));
  assert.deepEqual(hours, [25, 24]);
});

test('history persists across restart, records error gaps, strips credentials/metadata, isolates regions and login changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codextracker-provider-history-'));
  const files = [];
  try {
    const store = new ProviderHistoryStore(root, () => now);
    const snap = snapshot('claude', -minute, [quota(10)], [money(12.3456)], { email: 'private@example.test', token: 'never-save-this', raw: { Authorization: 'secret' } });
    await store.record(measurement(snap));
    const failed = snapshot('claude', -minute, [quota(10)], [money(12.3456)], { state: 'error', error: 'network' });
    await store.record(measurement(failed, config(), { observed_at: at(0) }));
    let rows = await new ProviderHistoryStore(root, () => now).read(config());
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1].windows, []); assert.deepEqual(rows[1].amounts, []);
    assert.equal(rows[0].amounts[0].value, 12.3456);
    const raw = await fs.readFile(path.join(root, 'claude-global.jsonl'), 'utf8');
    assert.doesNotMatch(raw, /private@|never-save|Authorization|private-test-plan|"raw"/);
    assert.equal((await store.read(config('claude', { region: 'china' }))).length, 0);
    await store.rotate('claude', 'global');
    assert.equal((await store.read(config())).length, 0, 'a replacement login starts a fresh view');
    await store.record(measurement(snapshot('claude', 0, [quota(25)])));
    assert.equal((await store.read(config())).length, 1);
    assert.equal((await new ProviderHistoryStore(root, () => now).read(config())).length, 1);
    assert.equal((await fs.readFile(path.join(root, 'claude-global.jsonl'), 'utf8')).split('\n').filter(Boolean).length, 3, 'previous login history stays on disk');
    files.push(...await fs.readdir(root));
  } finally {
    for (const file of await fs.readdir(root)) await fs.unlink(path.join(root, file));
    await fs.rmdir(root);
  }
});

test('concurrent appends/pruning cannot lose new readings; invalid and old records are excluded; team scope is hashed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codextracker-provider-history-'));
  try {
    const store = new ProviderHistoryStore(root, () => now);
    const teamA = config('xai', { team_id: 'private-team-a' }), teamB = config('xai', { team_id: 'private-team-b' });
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.record(measurement(snapshot('xai', -(12 - index) * minute, [], [money(index)]), teamA))));
    await fs.appendFile(path.join(root, 'xai-global.jsonl'), '{"bad":true}\npartial\n');
    assert.equal((await store.read(teamA)).length, 12);
    assert.equal((await store.read(teamB)).length, 0);
    assert.doesNotMatch(await fs.readFile(path.join(root, 'xai-global.jsonl'), 'utf8'), /private-team-a/);
    assert.notEqual(historyScope(teamA), historyScope(teamB));
    const stale = new ProviderHistoryStore(root, () => now + 31 * day);
    assert.equal((await stale.read(teamA)).length, 0);
    assert.deepEqual(await store.list(), [{ id: 'xai', region: 'global' }]);
  } finally {
    for (const file of await fs.readdir(root)) await fs.unlink(path.join(root, file)); await fs.rmdir(root);
  }
});

test('statistics IPC selections reject arbitrary identifiers/regions; disabled historical modules remain selectable', async () => {
  assert.equal(validateStatisticsSelection(undefined), undefined);
  assert.deepEqual(validateStatisticsSelection({ id: 'kimi', region: 'china', secret: 'discard' }), { id: 'kimi', region: 'china' });
  for (const bad of [null, [], { id: '../../file', region: 'global' }, { id: 'codex', region: 'china' }, { id: 'deepseek', region: 'china' }, { id: 'kimi', region: 'mars' }]) assert.throws(() => validateStatisticsSelection(bad));
  const history = { list: async () => [{ id: 'minimax', region: 'china' }], read: async () => [row(-minute, [quota(12)])] };
  const report = await statisticsReport({ id: 'minimax', region: 'china' }, settings([config('deepseek')], false), { weekly_reset_at: null }, [], history, now);
  assert.equal(report.enabled, false); assert.equal(report.codex, null);
  assert.equal(report.quotas.length, 1);
  assert.ok(report.modules.some((value) => value.id === 'deepseek' && value.enabled));
  assert.ok(report.modules.some((value) => value.id === 'minimax' && value.region === 'china' && !value.enabled));
  assert.equal((await statisticsReport(undefined, settings([config('deepseek')], false), {}, [], history, now)).selected.id, 'deepseek');
});

test('service emits only fresh measurements and explicit error gaps; settings and cached display are not measurements', async () => {
  let fail = false;
  const service = new ProviderService({ get: async () => ({ secret: 'test-secret', expires_at: null }) }, async () => {
    if (fail) throw new ProviderFetchError('network'); return { plan: null, windows: [quota(10)], amounts: [] };
  });
  const measured = []; service.on('measurement', (value) => measured.push(value));
  service.updateSettings(settings([config()]));
  assert.equal(measured.length, 0);
  await service.refresh(); assert.equal(measured.length, 1); assert.equal(measured[0].snapshot.state, 'ready');
  service.getSnapshots(); assert.equal(measured.length, 1);
  fail = true; await service.refresh();
  assert.equal(measured.length, 2); assert.equal(measured[1].snapshot.state, 'error');
  assert.equal(measured[1].snapshot.windows.length, 1, 'the display retains data; the history store strips it');
  service.updateSettings(settings([])); await service.refresh(); assert.equal(measured.length, 2);
  service.stop();
});
