import type { CachedSnapshot, HistorySnapshot, Settings } from '../../shared/types.js';
import type { ModuleStatisticsReport, StatisticsModule, StatisticsSelection } from '../../shared/provider-statistics.js';
import { PROVIDERS, defaultProviderSettings } from '../../shared/providers.js';
import { computeStatistics } from '../codex/stats.js';
import { computeProviderStatistics } from './statistics.js';
import type { ProviderHistoryStore } from './history.js';

export async function statisticsReport(requested: StatisticsSelection | undefined, settings: Settings, snapshot: CachedSnapshot,
  codexHistory: HistorySnapshot[], history: Pick<ProviderHistoryStore, 'list' | 'read'>, now = Date.now()): Promise<ModuleStatisticsReport> {
  const stored = await history.list();
  const modules: StatisticsModule[] = [{ id: 'codex', region: 'global', enabled: settings.codex_enabled }];
  for (const definition of PROVIDERS) {
    const config = settings.providers.find((value) => value.id === definition.id) ?? defaultProviderSettings(definition.id);
    const regions = new Set(stored.filter((value) => value.id === definition.id).map((value) => value.region));
    if (config.enabled) regions.add(config.region);
    for (const region of regions) modules.push({ id: definition.id, region, enabled: config.enabled && config.region === region });
  }
  const selected = requested ?? modules.find((value) => value.enabled) ?? modules[0];
  if (!modules.some((value) => value.id === selected.id && value.region === selected.region)) modules.push({ ...selected, enabled: false });
  const enabled = modules.find((value) => value.id === selected.id && value.region === selected.region)?.enabled ?? false;
  const base = { modules, selected: { id: selected.id, region: selected.region }, enabled, computed_at: new Date(now).toISOString() };
  if (selected.id === 'codex') {
    const codex = computeStatistics(codexHistory, { now, refreshSeconds: settings.refresh_seconds,
      ...(enabled && snapshot.weekly_reset_at != null ? { resetAt: snapshot.weekly_reset_at, windowSeconds: snapshot.weekly_window_seconds } : {}),
    });
    return { ...base, codex, quotas: [], amounts: [], has_history: codexHistory.length > 0 };
  }
  const config = settings.providers.find((value) => value.id === selected.id) ?? defaultProviderSettings(selected.id);
  const rows = await history.read({ ...config, region: selected.region });
  return { ...base, codex: null, ...computeProviderStatistics(rows, now, Math.max(60, settings.refresh_seconds)), has_history: rows.some((row) => row.windows.length || row.amounts.length) };
}
