import type { ProviderSettings } from '../../shared/providers.js';
import type { ProviderCredential } from './credentials.js';
import { ProviderFetchError } from './errors.js';
import { requestJson, type JsonTransport } from './http.js';
import { object, parseProviderData, type ProviderData } from './parsers.js';

export async function fetchRemoteProvider(settings: ProviderSettings, credential: ProviderCredential, transport: JsonTransport = requestJson, signal?: AbortSignal): Promise<ProviderData> {
  const { id, region } = settings;
  if (credential.expires_at != null && credential.expires_at <= Date.now() + 30000) throw new ProviderFetchError('expired');
  const headers: Record<string, string> = { Authorization: `Bearer ${credential.secret}` };
  const get = (url: string, customHeaders = headers) => {
    if (signal?.aborted) throw new ProviderFetchError('network');
    return transport(id, region, { url, headers: customHeaders, signal });
  };
  let raw: unknown;
  switch (id) {
    case 'claude':
      raw = await get('https://api.anthropic.com/api/oauth/usage', { ...headers, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'CodexTracker' });
      break;
    case 'cursor': {
      const cookie = credential.secret.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/)?.[1] ?? credential.secret;
      if (!cookie || /[;\s]/.test(cookie)) throw new ProviderFetchError('needs_auth');
      raw = await get('https://cursor.com/api/usage-summary', { Cookie: `WorkosCursorSessionToken=${cookie}` });
      break;
    }
    case 'grok':
      raw = await get('https://cli-chat-proxy.grok.com/v1/billing?format=credits', { ...headers, 'x-xai-token-auth': 'xai-grok-cli' });
      break;
    case 'minimax': {
      const base = region === 'china' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
      try { raw = await get(`${base}/v1/token_plan/remains`); }
      catch (error) {
        if (!(error instanceof ProviderFetchError) || !['needs_auth', 'unsupported_response'].includes(error.code)) throw error;
        raw = await get(`${base}/v1/api/openplatform/coding_plan/remains`);
      }
      break;
    }
    case 'zai':
      raw = await get(`${region === 'china' ? 'https://open.bigmodel.cn' : 'https://api.z.ai'}/api/monitor/usage/quota/limit`);
      break;
    case 'kimi':
      raw = await get(`${region === 'china' ? 'https://api.kimi.com' : 'https://api.kimi.ai'}/coding/v1/usages`);
      break;
    case 'deepseek':
      raw = await get('https://api.deepseek.com/user/balance');
      break;
    case 'moonshot':
      raw = await get(`${region === 'china' ? 'https://api.moonshot.cn' : 'https://api.moonshot.ai'}/v1/users/me/balance`);
      break;
    case 'xai':
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(settings.team_id)) throw new ProviderFetchError('needs_auth');
      raw = await get(`https://management-api.x.ai/v1/billing/teams/${settings.team_id}/prepaid/balance`);
      break;
    case 'anthropic': {
      if (!credential.secret.startsWith('sk-ant-admin')) throw new ProviderFetchError('needs_auth');
      const end = new Date(), start = new Date(end.getTime() - 30 * 86400000);
      const params = new URLSearchParams({ starting_at: start.toISOString(), ending_at: end.toISOString(), bucket_width: '1d', limit: '31' });
      const data: ProviderData = { plan: null, windows: [], amounts: [] };
      let partial = false;
      for (let page = 0; page < 10; page++) {
        let response: unknown;
        try {
          response = await get(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, { 'x-api-key': credential.secret, 'anthropic-version': '2023-06-01' });
        } catch (error) {
          if (!data.amounts.length) throw error;
          partial = true; break;
        }
        const parsed = parseProviderData(id, response, region);
        for (const row of parsed.amounts) {
          const existing = data.amounts.find((item) => item.currency === row.currency);
          if (existing) existing.value += row.value; else data.amounts.push({ ...row });
        }
        const root = object(response);
        partial = root.has_more === true;
        if (!partial) break;
        if (typeof root.next_page !== 'string' || root.next_page.length > 2048) break;
        params.set('page', root.next_page);
      }
      data.amounts.forEach((row) => { row.partial = partial; });
      return data;
    }
    default: throw new ProviderFetchError('unsupported_response');
  }
  return parseProviderData(id, raw, region);
}
