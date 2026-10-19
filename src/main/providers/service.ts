import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Settings } from '../../shared/types.js';
import { PROVIDERS, defaultProviderSettings, type ProviderConnection, type ProviderId, type ProviderSettings, type ProviderSnapshot } from '../../shared/providers.js';
import { WindowsProviderCredentialStore, importLocalCredential, validateProviderSecret, type ProviderCredentialStore } from './credentials.js';
import { fetchRemoteProvider } from './adapters.js';
import { fetchAntigravity } from './antigravity.js';
import { ProviderFetchError } from './errors.js';
import type { ProviderData } from './parsers.js';

export class ProviderService extends EventEmitter {
  private sessionId = randomUUID();
  private settings: Settings | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private snapshots = new Map<ProviderId, ProviderSnapshot>();
  private revisions = new Map<ProviderId, number>();
  private inFlight = new Map<ProviderId, Promise<void>>();
  private nextAllowed = new Map<ProviderId, number>();
  private controllers = new Map<ProviderId, AbortController>();

  constructor(private credentials: ProviderCredentialStore = new WindowsProviderCredentialStore(),
    private remote = fetchRemoteProvider, private local: (signal?: AbortSignal) => Promise<ProviderData> = fetchAntigravity) { super(); }

  start(settings: Settings): void {
    this.running = true;
    this.updateSettings(settings);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const controller of this.controllers.values()) controller.abort();
    for (const id of this.revisions.keys()) this.revisions.set(id, this.revision(id) + 1);
  }

  private config(id: ProviderId): ProviderSettings {
    return this.settings?.providers.find((provider) => provider.id === id) ?? defaultProviderSettings(id);
  }

  private revision(id: ProviderId): number { return this.revisions.get(id) ?? 0; }
  private invalidate(id: ProviderId): void {
    this.controllers.get(id)?.abort();
    this.revisions.set(id, this.revision(id) + 1);
    this.snapshots.delete(id); this.nextAllowed.delete(id);
  }

  updateSettings(settings: Settings): void {
    const changed = PROVIDERS.filter(({ id }) => JSON.stringify(this.config(id)) !== JSON.stringify(settings.providers.find((p) => p.id === id) ?? defaultProviderSettings(id)));
    this.settings = structuredClone(settings);
    changed.forEach(({ id }) => this.invalidate(id));
    this.emit('updated', this.getSnapshots());
    if (this.running) {
      changed.filter(({ id }) => this.config(id).enabled).forEach(({ id }) => { void this.fetchOne(id); });
      this.schedule();
    }
  }

  getSnapshots(): ProviderSnapshot[] {
    return PROVIDERS.filter(({ id }) => this.config(id).enabled).map(({ id, auth }) => this.snapshots.get(id) ?? {
      id, region: this.config(id).region, state: 'loading', fetched_at: null, error: null,
      source: auth === 'local' ? 'local' : 'api', plan: null, windows: [], amounts: [],
    });
  }

  async connections(): Promise<ProviderConnection[]> {
    return Promise.all(PROVIDERS.map(async ({ id, auth }) => {
      const region = this.config(id).region;
      return { id, region, configured: auth === 'local' || await this.credentials.get(id, region).then(Boolean).catch(() => false) };
    }));
  }

  async setCredential(id: ProviderId, secret: unknown): Promise<void> {
    if (id === 'antigravity') throw new ProviderFetchError('unsupported_response');
    const config = this.config(id);
    await this.credentials.set(id, config.region, { secret: validateProviderSecret(secret), expires_at: null });
    this.emit('connection-changed', id, config.region);
    this.invalidate(id); this.emit('updated', this.getSnapshots());
    if (this.running && config.enabled) await this.fetchOne(id);
  }

  async importCredential(id: ProviderId): Promise<void> {
    const config = this.config(id);
    const value = await importLocalCredential(id);
    await this.credentials.set(id, config.region, value);
    this.emit('connection-changed', id, config.region);
    this.invalidate(id); this.emit('updated', this.getSnapshots());
    if (this.running && config.enabled) await this.fetchOne(id);
  }

  async removeCredential(id: ProviderId): Promise<void> {
    await this.credentials.remove(id, this.config(id).region);
    this.emit('connection-changed', id, this.config(id).region);
    this.invalidate(id); this.emit('updated', this.getSnapshots());
    if (this.running && this.config(id).enabled) await this.fetchOne(id);
  }

  async refresh(providerId?: ProviderId): Promise<ProviderSnapshot[]> {
    await Promise.allSettled(PROVIDERS.filter(({ id }) => this.config(id).enabled && (providerId == null || providerId === id)).map(({ id }) => this.fetchOne(id)));
    return this.getSnapshots();
  }

  private fetchOne(id: ProviderId): Promise<void> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    if (!this.config(id).enabled || (this.nextAllowed.get(id) ?? 0) > Date.now()) return Promise.resolve();
    const config = structuredClone(this.config(id)), revision = this.revision(id);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const request = this.fetch(config, revision, controller.signal).finally(() => {
      this.inFlight.delete(id);
      this.controllers.delete(id);
      if (this.running && this.config(id).enabled && revision !== this.revision(id)) void this.fetchOne(id);
    });
    this.inFlight.set(id, request);
    return request;
  }

  private async fetch(config: ProviderSettings, revision: number, signal: AbortSignal): Promise<void> {
    const { id, region } = config;
    let snapshot: ProviderSnapshot;
    try {
      const credential = id === 'antigravity' ? null : await this.credentials.get(id, region);
      if (id !== 'antigravity' && !credential) throw new ProviderFetchError('needs_auth');
      if (signal.aborted) return;
      const data = id === 'antigravity' ? await this.local(signal) : await this.remote(config, credential!, undefined, signal);
      // A provider must never reflect a credential into its display metadata.
      const scrub = (value: string | null) => value && credential ? value.split(credential.secret).join('[redacted]') : value;
      snapshot = { id, region, state: 'ready', fetched_at: new Date().toISOString(), error: null, source: id === 'antigravity' ? 'local' : 'api',
        plan: scrub(data.plan), windows: data.windows.slice(0, 64).map((window) => ({ ...window, label: scrub(window.label) ?? '' })), amounts: data.amounts, warnings: data.warnings ?? [] };
    } catch (error) {
      const failure = error instanceof ProviderFetchError ? error : new ProviderFetchError('network');
      if (revision !== this.revision(id)) return;
      const previous = this.snapshots.get(id);
      const retain = failure.code === 'network' || failure.code === 'rate_limited';
      snapshot = { id, region, state: 'error', fetched_at: retain ? previous?.fetched_at ?? null : null, error: failure.code,
        source: id === 'antigravity' ? 'local' : 'api', plan: retain ? previous?.plan ?? null : null,
        windows: retain ? previous?.windows ?? [] : [], amounts: retain ? previous?.amounts ?? [] : [], warnings: retain ? previous?.warnings ?? [] : [] };
      this.nextAllowed.set(id, Date.now() + (failure.retryAfterMs ?? (failure.code === 'needs_auth' || failure.code === 'expired' ? 300000 : 60000)));
    }
    if (revision !== this.revision(id)) return;
    this.snapshots.set(id, snapshot);
    this.emit('measurement', { snapshot, config, observed_at: snapshot.state === 'ready' ? snapshot.fetched_at! : new Date().toISOString(),
      refresh_seconds: Math.max(60, this.settings?.refresh_seconds ?? 60), segment: `${this.sessionId}:${revision}` });
    this.emit('updated', this.getSnapshots());
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => { if (this.running) this.schedule(); });
    }, Math.max(60, this.settings?.refresh_seconds ?? 60) * 1000);
  }
}
