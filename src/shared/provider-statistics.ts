import type { Statistics, UsageTotal } from './types.js';
import type { ProviderAmount, ProviderId, ProviderRegion } from './providers.js';

export interface StatisticsSelection { id: 'codex' | ProviderId; region: ProviderRegion }
export interface StatisticsModule extends StatisticsSelection { enabled: boolean }
export interface ObservedDay {
  start_at: number; end_at: number; value: number | null;
  incomplete: boolean; estimated: boolean; observed_ms: number;
}
export interface MetricSummary {
  current_day: UsageTotal; previous_day: UsageTotal; last_7_days: UsageTotal; last_30_days: UsageTotal;
}
export interface QuotaStatistics {
  id: string; label: string; window_seconds: number | null;
  current_used: number | null; measured_at: string | null;
  alignment: 'budget' | 'calendar'; comparable: boolean;
  daily: ObservedDay[]; summary: MetricSummary;
}
export interface AmountStatistics {
  id: string; kind: ProviderAmount['kind']; currency: string; period: ProviderAmount['period'];
  current: number | null; measured_at: string | null; partial: boolean;
  decreased: ObservedDay[]; increased: ObservedDay[]; trend: ObservedDay[];
  decrease_summary: MetricSummary; increase_summary: MetricSummary;
}
export interface ModuleStatisticsReport {
  modules: StatisticsModule[]; selected: StatisticsSelection; enabled: boolean;
  codex: Statistics | null; quotas: QuotaStatistics[]; amounts: AmountStatistics[];
  has_history: boolean; computed_at: string;
}
