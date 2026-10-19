/** Provider history contains numeric readings only, never credentials or response bodies. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { PROVIDER_IDS, type ProviderId, type ProviderRegion, type ProviderSettings, type ProviderSnapshot, type ProviderWindow, type ProviderAmount } from '../../shared/providers.js';

export interface ProviderMeasurement {
  snapshot: ProviderSnapshot; config: ProviderSettings; observed_at: string; refresh_seconds: number; segment: string;
}
export interface ProviderHistoryEntry {
  version: 1; id: ProviderId; region: ProviderRegion; timestamp: string; context: string; scope: string;
  segment: string; refresh_seconds: number; windows: ProviderWindow[]; amounts: ProviderAmount[];
}
const DAYS = 30 * 86400000;
export function historyScope(config: Pick<ProviderSettings, 'id' | 'team_id'>): string {
  return config.id === 'xai' ? createHash('sha256').update(config.team_id).digest('hex') : '';
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const kinds = ['balance', 'posted_balance', 'spend', 'included_spend', 'on_demand_spend', 'points'];
function valid(entry: ProviderHistoryEntry): boolean {
  return entry?.version === 1 && PROVIDER_IDS.includes(entry.id) && ['global', 'china'].includes(entry.region) &&
    Number.isFinite(Date.parse(entry.timestamp)) && typeof entry.context === 'string' && typeof entry.scope === 'string' &&
    typeof entry.segment === 'string' && finite(entry.refresh_seconds) && entry.refresh_seconds >= 10 && entry.refresh_seconds <= 3600 &&
    Array.isArray(entry.windows) && entry.windows.length <= 64 && entry.windows.every((w) => w && typeof w.id === 'string' && w.id.length <= 256 &&
      typeof w.label === 'string' && w.label.length <= 256 && finite(w.used_percent) && w.used_percent >= 0 && w.used_percent <= 100 &&
      (w.reset_at === null || finite(w.reset_at)) && (w.window_seconds === null || finite(w.window_seconds) && w.window_seconds > 0)) &&
    Array.isArray(entry.amounts) && entry.amounts.length <= 64 && entry.amounts.every((a) => a && kinds.includes(a.kind) && finite(a.value) &&
      typeof a.currency === 'string' && a.currency.length <= 32 && [null, 'current_cycle', 'last_30_days'].includes(a.period));
}

export class ProviderHistoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private contexts: Record<string, string> | null = null;
  private pruned = new Map<string, number>();
  constructor(private root = path.join(os.homedir(), '.codex-tracker', 'provider-history'), private now = Date.now) {}
  private key(id: ProviderId, region: ProviderRegion) { return `${id}-${region}`; }
  private file(id: ProviderId, region: ProviderRegion) { return path.join(this.root, `${this.key(id, region)}.jsonl`); }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation); this.queue = next.catch(() => {}); return next;
  }
  private async loadContexts(): Promise<Record<string, string>> {
    if (this.contexts) return this.contexts;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.root, 'contexts.json'), 'utf8'));
      if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid contexts');
      this.contexts = {};
      for (const [key, value] of Object.entries(raw)) {
        if (/^[a-z]+-(global|china)$/.test(key) && typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)) this.contexts[key] = value;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read provider history contexts.');
      this.contexts = {};
    }
    return this.contexts!;
  }
  private async saveContexts(contexts: Record<string, string>) {
    await fs.mkdir(this.root, { recursive: true });
    const file = path.join(this.root, 'contexts.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(contexts), 'utf8');
    await fs.rename(file + '.tmp', file);
  }
  rotate(id: ProviderId, region: ProviderRegion): Promise<void> {
    return this.serial(async () => {
      const contexts = await this.loadContexts(); contexts[this.key(id, region)] = randomUUID();
      await this.saveContexts(contexts);
    });
  }
  record(measurement: ProviderMeasurement): Promise<void> {
    return this.serial(async () => {
      const { snapshot, config } = measurement;
      const contexts = await this.loadContexts(), key = this.key(config.id, config.region);
      if (!contexts[key]) { contexts[key] = randomUUID(); await this.saveContexts(contexts); }
      const fresh = snapshot.state === 'ready' && snapshot.fetched_at === measurement.observed_at;
      const entry: ProviderHistoryEntry = {
        version: 1, id: config.id, region: config.region, timestamp: measurement.observed_at, context: contexts[key], scope: historyScope(config),
        segment: measurement.segment, refresh_seconds: measurement.refresh_seconds,
        windows: fresh ? snapshot.windows.slice(0, 64).map((w) => ({ id: w.id, label: w.label, used_percent: w.used_percent, reset_at: w.reset_at, window_seconds: w.window_seconds })) : [],
        amounts: fresh ? snapshot.amounts.slice(0, 64).map((a) => ({ kind: a.kind, value: a.value, currency: a.currency, period: a.period, partial: a.partial === true })) : [],
      };
      if (!valid(entry)) throw new Error('Invalid provider measurement');
      const file = this.file(config.id, config.region);
      await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
      if (this.now() - (this.pruned.get(key) ?? 0) > 86400000) {
        const rows = await this.readFile(config.id, config.region);
        await fs.writeFile(file + '.tmp', rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
        await fs.rename(file + '.tmp', file); this.pruned.set(key, this.now());
      }
    });
  }
  private async readFile(id: ProviderId, region: ProviderRegion): Promise<ProviderHistoryEntry[]> {
    let raw: string;
    try { raw = await fs.readFile(this.file(id, region), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Could not read provider history.'); }
    const rows: ProviderHistoryEntry[] = [];
    for (const line of raw.split('\n')) {
      try {
        const entry = JSON.parse(line) as ProviderHistoryEntry;
        if (valid(entry) && entry.id === id && entry.region === region && Date.parse(entry.timestamp) >= this.now() - DAYS && Date.parse(entry.timestamp) <= this.now()) rows.push(entry);
      } catch { /* A malformed/partial line is not a measurement. */ }
    }
    return rows;
  }
  read(config: Pick<ProviderSettings, 'id' | 'region' | 'team_id'>): Promise<ProviderHistoryEntry[]> {
    return this.serial(async () => {
      const contexts = await this.loadContexts(), context = contexts[this.key(config.id, config.region)];
      return (await this.readFile(config.id, config.region)).filter((row) => row.context === context && row.scope === historyScope(config));
    });
  }
  list(): Promise<Array<{ id: ProviderId; region: ProviderRegion }>> {
    return this.serial(async () => {
      const files: string[] = await fs.readdir(this.root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [] as string[]; throw new Error('Could not list provider history.');
      });
      return PROVIDER_IDS.flatMap((id) => (['global', 'china'] as const).filter((region) => files.includes(`${this.key(id, region)}.jsonl`)).map((region) => ({ id, region })));
    });
  }
}
