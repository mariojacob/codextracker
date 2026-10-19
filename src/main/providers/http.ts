import type { ProviderId, ProviderRegion } from '../../shared/providers.js';
import { ProviderFetchError } from './errors.js';

const HOSTS: Record<ProviderId, Partial<Record<ProviderRegion, readonly string[]>>> = {
  antigravity: {}, claude: { global: ['api.anthropic.com'] }, cursor: { global: ['cursor.com'] },
  grok: { global: ['cli-chat-proxy.grok.com'] },
  minimax: { global: ['api.minimax.io'], china: ['api.minimaxi.com'] },
  zai: { global: ['api.z.ai'], china: ['open.bigmodel.cn'] },
  kimi: { global: ['api.kimi.ai'], china: ['api.kimi.com'] },
  deepseek: { global: ['api.deepseek.com'] },
  moonshot: { global: ['api.moonshot.ai'], china: ['api.moonshot.cn'] },
  xai: { global: ['management-api.x.ai'] }, anthropic: { global: ['api.anthropic.com'] },
};

export interface JsonRequest { url: string; headers: Record<string, string>; method?: 'GET' | 'POST'; body?: string; signal?: AbortSignal }
export type JsonTransport = (id: ProviderId, region: ProviderRegion, request: JsonRequest) => Promise<unknown>;

/** No redirects, arbitrary endpoints, cookies from an ambient browser, or raw HTTP diagnostics. */
export async function requestJson(id: ProviderId, region: ProviderRegion, request: JsonRequest, fetcher: typeof fetch = fetch): Promise<unknown> {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !HOSTS[id][region]?.includes(url.hostname)) throw new ProviderFetchError('unsupported_response');
  try {
    const response = await fetcher(url, {
      method: request.method ?? 'GET', headers: { Accept: 'application/json', ...request.headers },
      body: request.body, redirect: 'manual', credentials: 'omit', signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new ProviderFetchError('needs_auth');
      if (response.status === 429) {
        const header = response.headers.get('retry-after');
        const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 300000;
        throw new ProviderFetchError('rate_limited', Math.max(60000, Math.min(3600000, Number.isFinite(delay) ? delay : 300000)));
      }
      throw new ProviderFetchError('unsupported_response');
    }
    const limit = 2 * 1024 * 1024;
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderFetchError('unsupported_response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new ProviderFetchError('unsupported_response'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ProviderFetchError('unsupported_response'); }
  } catch (error) {
    if (error instanceof ProviderFetchError) throw error;
    throw new ProviderFetchError('network');
  }
}
