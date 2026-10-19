const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProviderData, parseAntigravity } = require('../dist-main/main/providers/parsers.js');
const { requestJson } = require('../dist-main/main/providers/http.js');
const { fetchRemoteProvider } = require('../dist-main/main/providers/adapters.js');
const { importedCredential, validateProviderSecret } = require('../dist-main/main/providers/credentials.js');
const { ProviderService } = require('../dist-main/main/providers/service.js');
const { ProviderFetchError } = require('../dist-main/main/providers/errors.js');
const { validateSettings, validateProviderId } = require('../dist-main/main/security.js');
const { defaultProviderSettings } = require('../dist-main/shared/providers.js');
const { validateLocalEndpoints } = require('../dist-main/main/providers/antigravity.js');

const now = Date.now(), day = 86400000;
const iso = (at) => new Date(at).toISOString();
const config = (id, patch = {}) => ({ ...defaultProviderSettings(id), enabled: true, ...patch });
const settings = (providers = []) => ({ providers, refresh_seconds: 60, history_days: 30, language: 'de', notifications: { enabled: false, rules: [] } });
const window = (used = 25) => ({ id: 'weekly', label: 'weekly', used_percent: used, reset_at: now + 6 * day, window_seconds: 604800 });
const data = (used = 25) => ({ plan: null, windows: [window(used)], amounts: [] });
const credential = { secret: 'private-test-key', expires_at: null };
const errorCode = (code) => (error) => error instanceof ProviderFetchError && error.code === code;

class MemoryCredentials {
  entries = new Map();
  reads = [];
  async get(id, region) { this.reads.push(`${id}:${region}`); return this.entries.get(`${id}:${region}`) ?? null; }
  async set(id, region, value) { this.entries.set(`${id}:${region}`, value); }
  async remove(id, region) { this.entries.delete(`${id}:${region}`); }
}

test('provider settings migrate old configs, reject unknown IDs and isolate regions without retaining keys', () => {
  const legacy = settings(); delete legacy.providers;
  assert.deepEqual(validateSettings(legacy).providers, []);
  const input = settings([config('kimi', { region: 'china', apiKey: credential.secret })]);
  assert.doesNotMatch(JSON.stringify(validateSettings(input)), /private-test-key|apiKey/);
  assert.throws(() => validateSettings(settings([config('grok'), config('grok')])), /Duplicate/);
  assert.throws(() => validateSettings(settings([config('fake')])));
  assert.throws(() => validateSettings(settings([config('deepseek', { region: 'china' })])), /region/);
  assert.throws(() => validateSettings(settings([config('xai', { team_id: '../elsewhere' })])), /team/);
  assert.throws(() => validateProviderId('__proto__'));
});

test('Antigravity grouped quotas keep Gemini and Claude/GPT and all supplied windows', () => {
  const raw = { groups: ['Gemini', 'Claude / GPT'].map((name) => ({ displayName: name, buckets: [
    { bucketId: 'weekly', remainingFraction: .68, resetTime: iso(now + 4 * day) },
    { bucketId: 'five_hour', remaining: { case: 'remainingFraction', value: 1 }, resetTime: iso(now + 18000000) },
    { bucketId: 'hidden', disabled: true, remainingFraction: 1 },
  ] })) };
  const parsed = parseAntigravity(raw);
  assert.equal(parsed.windows.length, 4);
  assert.equal(parsed.windows[0].window_seconds, 604800);
  assert.ok(Math.abs(parsed.windows[0].used_percent - 32) < 1e-8);
  assert.equal(parsed.windows[1].used_percent, 0);
  assert.equal(parsed.windows[1].window_seconds, 18000);
  const cli = parseAntigravity({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ display_name: 'Gemini', buckets: [{ bucket_id: 'weekly', remaining_fraction: .5 }] }] } } });
  assert.equal(cli.windows[0].used_percent, 50);
  assert.throws(() => parseAntigravity({ status: 'FAILED', command: { name: 'usage', data: raw } }), errorCode('unsupported_response'));
  assert.throws(() => parseAntigravity({ groups: [{ buckets: [{ id: 'weekly' }] }] }), errorCode('unsupported_response'));
});

test('Antigravity legacy model quotas do not fabricate a weekly window', () => {
  const parsed = parseAntigravity({ userStatus: { planStatus: { planInfo: { planName: 'Pro' } }, cascadeModelConfigData: { clientModelConfigs: [
    { label: 'Gemini', quotaInfo: { remainingFraction: .7, resetTime: iso(now + 18000000) } },
  ] } } });
  assert.equal(parsed.plan, 'Pro');
  assert.equal(parsed.windows[0].window_seconds, null);
});

test('Claude parses real zeroes and omits absent windows instead of inventing 100% left', () => {
  const parsed = parseProviderData('claude', { five_hour: { utilization: 0, resets_at: iso(now + day) }, seven_day: null, extra_usage: { is_enabled: true, used_credits: 1234, currency: 'USD' } });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].used_percent, 0);
  assert.equal(parsed.amounts[0].value, 12.34);
  assert.equal(parsed.amounts[0].kind, 'on_demand_spend');
  assert.throws(() => parseProviderData('claude', { five_hour: { utilization: null } }), errorCode('unsupported_response'));
});

test('Cursor converts cents and retains independent pools without averaging them', () => {
  const parsed = parseProviderData('cursor', { membershipType: 'pro', individualUsage: {
    plan: { autoPercentUsed: .36, apiPercentUsed: 20, used: null, limit: null },
    onDemand: { enabled: true, used: 123 },
  } });
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].used_percent, .36);
  assert.equal(parsed.windows[1].used_percent, 20);
  assert.equal(parsed.amounts[0].value, 1.23);
  assert.equal(parsed.amounts[0].kind, 'on_demand_spend');
});

test('Grok accepts measured credits and keeps an unknown period-only response unavailable', () => {
  const parsed = parseProviderData('grok', { config: { creditUsagePercent: 35, currentPeriod: { start: iso(now - day), end: iso(now + 6 * day) } } });
  assert.equal(parsed.windows[0].used_percent, 35);
  assert.equal(parsed.windows[0].window_seconds, 604800);
  assert.throws(() => parseProviderData('grok', { config: { currentPeriod: { start: iso(now - day), end: iso(now + 6 * day) } } }), errorCode('unsupported_response'));
});

test('MiniMax token-plan ratios and legacy remaining counts are interpreted in the right direction', () => {
  const parsed = parseProviderData('minimax', { base_resp: { status_code: 0 }, data: { current_subscribe_title: 'Token Plan', points_balance: '14.5', model_remains: [
    { model_name: 'general', current_interval_remaining_percent: '96', start_time: now, end_time: now + 18000000, current_weekly_remaining_percent: '99', weekly_start_time: now, weekly_end_time: now + 7 * day },
    { model_name: 'legacy', current_interval_total_count: 100, current_interval_usage_count: 80 },
  ] } });
  assert.equal(parsed.windows[0].used_percent, 4);
  assert.equal(parsed.windows[1].used_percent, 1);
  assert.equal(parsed.windows[2].used_percent, 20);
  assert.equal(parsed.amounts[0].value, 14.5);
  assert.equal(parsed.amounts[0].kind, 'points');
});

test('z.ai preserves known percentage when counts are missing, and maps actual durations', () => {
  const parsed = parseProviderData('zai', { success: true, code: 200, data: { limits: [
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 12, usage: null, currentValue: null },
    { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 0, usage: 100, currentValue: 30 },
    { type: 'UNKNOWN_FUTURE_LIMIT', percentage: 100 },
  ] } });
  assert.equal(parsed.windows[0].used_percent, 12);
  assert.equal(parsed.windows[0].window_seconds, 18000);
  assert.equal(parsed.windows[1].used_percent, 30);
  assert.equal(parsed.windows[1].window_seconds, 604800);
});

test('Kimi supports ratio pools and legacy counts without fabricating absent values', () => {
  const modern = parseProviderData('kimi', { usages: { limit_5h: { used_ratio: 0 }, limit_7d: { used_ratio: .75 }, limit_month_total: { used_ratio: 1 } } });
  assert.deepEqual(modern.windows.map((w) => w.used_percent), [0, 75, 100]);
  assert.equal(modern.windows[2].label, 'monthly');
  assert.deepEqual(modern.warnings, ['monthly_exhausted']);
  const legacy = parseProviderData('kimi', { usage: { limit: '100', used: '25' }, limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '200', remaining: '150' } }] });
  assert.deepEqual(legacy.windows.map((w) => w.used_percent), [25, 25]);
});

test('Kimi reconciles conflicting readings only when reset periods match', () => {
  const reset = iso(now + day);
  const parsed = parseProviderData('kimi', { usages: { limit_7d: { used_ratio: .1, reset_time: reset } }, usage: { limit: '100', used: '80', resetTime: reset } });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].used_percent, 80);
  const mismatch = parseProviderData('kimi', { usages: { limit_7d: { used_ratio: .1, reset_time: reset } }, usage: { limit: '100', used: '80', resetTime: iso(now + 2 * day) } });
  assert.equal(mismatch.windows[0].used_percent, 10);
});

test('API balances keep currencies, fractions and deficits without inventing quotas', () => {
  const deepseek = parseProviderData('deepseek', { balance_infos: [{ currency: 'USD', total_balance: '12.34' }, { currency: 'CNY', total_balance: '-1.25' }] });
  assert.equal(deepseek.windows.length, 0);
  assert.deepEqual(deepseek.amounts.map((r) => [r.value, r.currency]), [[12.34, 'USD'], [-1.25, 'CNY']]);
  assert.equal(parseProviderData('moonshot', { data: { available_balance: 0 } }, 'china').amounts[0].currency, 'CNY');
  assert.equal(parseProviderData('xai', { total: '-1000' }).amounts[0].value, 10);
  assert.equal(parseProviderData('xai', { total: '250' }).amounts[0].value, -2.5);
  assert.throws(() => parseProviderData('deepseek', { balance_infos: [{ currency: 'USD', total_balance: null }] }), errorCode('unsupported_response'));
  assert.deepEqual(parseProviderData('deepseek', { is_available: false, balance_infos: [{ currency: 'USD', total_balance: '10' }] }).warnings, ['balance_unavailable']);
});

test('Anthropic API spend is distinct from subscription quota and marks partial reports', () => {
  const parsed = parseProviderData('anthropic', { data: [{ results: [{ amount: '1234', currency: 'usd' }, { amount: '1.5', currency: 'usd' }] }], has_more: true });
  assert.equal(parsed.amounts[0].value, 12.355);
  assert.equal(parsed.amounts[0].partial, true);
  assert.equal(parsed.windows.length, 0);
  assert.equal(parseProviderData('anthropic', { data: [{ results: [] }] }).amounts[0].value, 0);
  assert.throws(() => parseProviderData('anthropic', { data: [{}] }), errorCode('unsupported_response'));
});

test('HTTP transport rejects redirects, wrong regional hosts and oversized responses; errors do not leak secrets', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(credential.secret, { status: 302, headers: { Location: 'https://evil.test/' } }); };
  await assert.rejects(requestJson('moonshot', 'global', { url: 'https://api.moonshot.ai/v1/users/me/balance', headers: { Authorization: credential.secret } }, fetcher), errorCode('unsupported_response'));
  assert.equal(calls, 1);
  await assert.rejects(requestJson('moonshot', 'china', { url: 'https://api.moonshot.ai/v1/users/me/balance', headers: {} }, fetcher));
  await assert.rejects(requestJson('deepseek', 'global', { url: 'http://api.deepseek.com/user/balance', headers: {} }, fetcher));
  assert.equal(calls, 1);
  await assert.rejects(requestJson('deepseek', 'global', { url: 'https://api.deepseek.com/user/balance', headers: {} }, async () => new Response(credential.secret, { status: 401 })), (error) => {
    assert.doesNotMatch(error.message, /private-test-key/); return error.code === 'needs_auth';
  });
  await assert.rejects(requestJson('deepseek', 'global', { url: 'https://api.deepseek.com/user/balance', headers: {} }, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), errorCode('unsupported_response'));
  await assert.rejects(requestJson('deepseek', 'global', { url: 'https://api.deepseek.com/user/balance', headers: {} }, async () => new Response('{}', { status: 429, headers: { 'retry-after': '600' } })), (error) => error.retryAfterMs === 600000);
});

test('adapters bind keys to fixed regional origins and use distinct credential types', async () => {
  const seen = [];
  const transport = async (id, region, request) => { seen.push({ id, region, request }); return { data: { available_balance: '10' } }; };
  await fetchRemoteProvider(config('moonshot', { region: 'china' }), credential, transport);
  assert.match(seen[0].request.url, /^https:\/\/api\.moonshot\.cn\//);
  assert.equal(seen[0].request.headers.Authorization, 'Bearer private-test-key');
  await assert.rejects(fetchRemoteProvider(config('anthropic'), credential, transport), errorCode('needs_auth'));
  assert.equal(seen.length, 1);
  await assert.rejects(fetchRemoteProvider(config('xai', { team_id: '../bad' }), credential, transport), errorCode('needs_auth'));
  assert.equal(seen.length, 1);
  await assert.rejects(fetchRemoteProvider(config('claude'), { ...credential, expires_at: now - 1 }, transport), errorCode('expired'));
});

test('credential imports read only supported login shapes and retain no refresh tokens', () => {
  const claude = importedCredential('claude', { claudeAiOauth: { accessToken: 'test-access', refreshToken: 'must-not-retain', expiresAt: now + day } }, now);
  assert.deepEqual(claude, { secret: 'test-access', expires_at: now + day });
  assert.doesNotMatch(JSON.stringify(claude), /must-not-retain|refresh/);
  const grok = importedCredential('grok', { 'https://auth.x.ai::example': { key: 'grok-access', expires_at: String((now + day) / 1000), refresh_token: 'secret-refresh' } }, now);
  assert.equal(grok.secret, 'grok-access');
  assert.ok(Math.abs(grok.expires_at - now - day) < 1);
  assert.throws(() => importedCredential('claude', { claudeAiOauth: { accessToken: 'expired', expiresAt: now - 1 } }, now), errorCode('expired'));
  assert.throws(() => validateProviderSecret('secret\r\nAuthorization: bad'), errorCode('needs_auth'));
});

test('local Antigravity endpoints accept only bounded ports and safe CSRF headers', () => {
  assert.equal(validateLocalEndpoints([{ port: 1234, csrf: 'safe', tls: true }]).length, 1);
  assert.deepEqual(validateLocalEndpoints([{ port: 0, csrf: 'safe', tls: true }, { port: 1234, csrf: 'bad\r\nheader', tls: true }]), []);
});

test('disabled providers perform no credential reads or network calls', async () => {
  const store = new MemoryCredentials(); let requests = 0;
  const service = new ProviderService(store, async () => { requests++; return data(); });
  service.start(settings());
  try {
    assert.deepEqual(await service.refresh(), []);
    assert.equal(requests, 0); assert.equal(store.reads.length, 0);
  } finally { service.stop(); }
});

test('provider polling works without Codex auth and connections never return secrets', async () => {
  const store = new MemoryCredentials(); await store.set('deepseek', 'global', credential);
  const service = new ProviderService(store, async () => ({ plan: null, windows: [], amounts: [{ kind: 'balance', value: 12.34, currency: 'USD', period: null }] }));
  service.start(settings([config('deepseek')]));
  try {
    const result = await service.refresh();
    assert.equal(result[0].state, 'ready');
    assert.equal(result[0].amounts[0].value, 12.34);
    assert.doesNotMatch(JSON.stringify(await service.connections()), /private-test-key|secret/);
  } finally { service.stop(); }
});

test('region changes never reuse credentials from another region', async () => {
  const store = new MemoryCredentials(); await store.set('moonshot', 'global', credential);
  let requests = 0;
  const service = new ProviderService(store, async () => { requests++; return data(); });
  service.start(settings([config('moonshot')]));
  try {
    await service.refresh(); assert.equal(requests, 1);
    service.updateSettings(settings([config('moonshot', { region: 'china' })]));
    const result = await service.refresh();
    assert.equal(result[0].region, 'china');
    assert.equal(result[0].error, 'needs_auth');
    assert.equal(result[0].windows.length, 0);
    assert.equal(requests, 1);
  } finally { service.stop(); }
});

test('disabled providers cancel pending requests and reject late results', async () => {
  const store = new MemoryCredentials(); await store.set('claude', 'global', credential);
  let finish, signal;
  const remote = (_config, _credential, _transport, abortSignal) => { signal = abortSignal; return new Promise((resolve) => { finish = resolve; }); };
  const service = new ProviderService(store, remote);
  service.start(settings([config('claude')]));
  try {
    const pending = service.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    service.updateSettings(settings([config('claude', { enabled: false })]));
    assert.equal(signal.aborted, true);
    finish(data()); await pending;
    assert.deepEqual(service.getSnapshots(), []);
  } finally { service.stop(); }
});

test('network failures mark last readings stale; auth failures clear them and back off', async () => {
  const store = new MemoryCredentials(); await store.set('claude', 'global', credential);
  let fail = null, requests = 0;
  const service = new ProviderService(store, async () => { requests++; if (fail) throw new ProviderFetchError(fail); return data(); });
  service.start(settings([config('claude')]));
  try {
    await service.refresh(); fail = 'network';
    let result = await service.refresh();
    assert.equal(result[0].state, 'error'); assert.equal(result[0].windows.length, 1); assert.ok(result[0].fetched_at);
    const before = requests; await service.refresh(); assert.equal(requests, before);
    await service.setCredential('claude', credential.secret); // explicit replacement resets retry gate
    fail = 'needs_auth';
    await service.setCredential('claude', credential.secret);
    result = service.getSnapshots();
    assert.equal(result[0].windows.length, 0); assert.equal(result[0].fetched_at, null);
  } finally { service.stop(); }
});

test('removing credentials stops use of the previous login and clears its reading', async () => {
  const store = new MemoryCredentials(); await store.set('grok', 'global', credential);
  let requests = 0;
  const service = new ProviderService(store, async () => { requests++; return data(); });
  service.start(settings([config('grok')]));
  try {
    await service.refresh(); await service.removeCredential('grok');
    assert.equal(service.getSnapshots()[0].error, 'needs_auth');
    assert.equal(service.getSnapshots()[0].windows.length, 0);
    assert.equal(requests, 1);
    assert.equal(await store.get('grok', 'global'), null);
  } finally { service.stop(); }
});

test('rate-limit retry delays survive manual refresh and successful readings redact reflected credentials', async () => {
  const store = new MemoryCredentials(); await store.set('claude', 'global', credential);
  let requests = 0, limited = false;
  const service = new ProviderService(store, async () => {
    requests++;
    if (limited) throw new ProviderFetchError('rate_limited', 600000);
    return { plan: credential.secret, windows: [{ ...window(), label: `weekly ${credential.secret}` }], amounts: [] };
  });
  service.start(settings([config('claude')]));
  try {
    await service.refresh();
    assert.doesNotMatch(JSON.stringify(service.getSnapshots()), /private-test-key/);
    limited = true; await service.refresh();
    const calls = requests; await service.refresh();
    assert.equal(requests, calls);
    assert.equal(service.getSnapshots()[0].error, 'rate_limited');
    assert.equal(service.getSnapshots()[0].windows.length, 1);
  } finally { service.stop(); }
});

test('Anthropic cost pages aggregate actual currencies and mark interrupted pagination incomplete', async () => {
  let calls = 0;
  const transport = async (_id, _region, request) => {
    calls++;
    assert.equal(request.headers['x-api-key'], 'sk-ant-admin-test');
    assert.equal(request.headers.Authorization, undefined);
    if (calls === 1) return { data: [{ results: [{ amount: '120', currency: 'USD' }] }], has_more: true, next_page: 'page two' };
    assert.match(request.url, /page=page\+two/);
    return { data: [{ results: [{ amount: '230', currency: 'USD' }] }], has_more: false };
  };
  const parsed = await fetchRemoteProvider(config('anthropic'), { secret: 'sk-ant-admin-test', expires_at: null }, transport);
  assert.equal(parsed.amounts[0].value, 3.5);
  assert.equal(parsed.amounts[0].partial, false);
  calls = 0;
  const interrupted = await fetchRemoteProvider(config('anthropic'), { secret: 'sk-ant-admin-test', expires_at: null }, async () => {
    if (++calls === 1) return { data: [{ results: [{ amount: '120', currency: 'USD' }] }], has_more: true, next_page: 'two' };
    throw new ProviderFetchError('network');
  });
  assert.equal(interrupted.amounts[0].value, 1.2);
  assert.equal(interrupted.amounts[0].partial, true);
});
