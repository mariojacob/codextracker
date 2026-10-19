import type { AmountStatistics, MetricSummary, ObservedDay, QuotaStatistics } from '../../shared/provider-statistics.js';
import type { UsageTotal } from '../../shared/types.js';
import { DAY_MS, weeklyBudget } from '../../shared/quota.js';
import type { ProviderAmount, ProviderWindow } from '../../shared/providers.js';
import type { ProviderHistoryEntry } from './history.js';

const round = (value: number) => Math.round(value * 10000) / 10000;
function total(days: ObservedDay[]): UsageTotal {
  const known = days.filter((day) => day.value != null);
  return { value: known.length ? round(known.reduce((sum, day) => sum + day.value!, 0)) : null, incomplete: !days.length || days.some((day) => day.incomplete) };
}
function summary(days: ObservedDay[]): MetricSummary {
  return { current_day: total(days.slice(-1)), previous_day: total(days.slice(-2, -1)), last_7_days: total(days.slice(-7)), last_30_days: total(days) };
}
function calendarDays(now: number): ObservedDay[] {
  const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
  return Array.from({ length: 30 }, (_, index) => {
    const start = new Date(end); start.setDate(start.getDate() - (30 - index));
    const next = new Date(end); next.setDate(next.getDate() - (29 - index));
    return empty(start.getTime(), next.getTime());
  });
}
function empty(start_at: number, end_at: number): ObservedDay {
  return { start_at, end_at, value: null, incomplete: false, estimated: false, observed_ms: 0 };
}
function quotaDays(window: ProviderWindow, now: number): { alignment: 'budget' | 'calendar'; daily: ObservedDay[] } {
  const budget = weeklyBudget(100, window.reset_at, window.window_seconds, now);
  return budget ? { alignment: 'budget', daily: Array.from({ length: 30 }, (_, index) => empty(budget.dayEnd - (30 - index) * DAY_MS, budget.dayEnd - (29 - index) * DAY_MS)) }
    : { alignment: 'calendar', daily: calendarDays(now) };
}
function overlaps(days: ObservedDay[], start: number, end: number, now: number) {
  return days.map((day) => ({ day, overlap: Math.max(0, Math.min(end, day.end_at, now) - Math.max(start, day.start_at)) })).filter(({ overlap }) => overlap > 0);
}
function distribute(days: ObservedDay[], start: number, end: number, value: number | null, now: number) {
  const affected = overlaps(days, start, end, now);
  for (const { day, overlap } of affected) {
    if (value == null) { day.incomplete = true; continue; }
    day.value = (day.value ?? 0) + value * overlap / (end - start);
    day.observed_ms += overlap;
    if (affected.length > 1) day.estimated = true;
  }
}
function finish(days: ObservedDay[], now: number, maxGap: number) {
  for (const day of days) {
    const expected = Math.max(0, Math.min(now, day.end_at) - day.start_at);
    day.incomplete ||= day.value == null || expected - day.observed_ms > maxGap;
    if (day.value != null) day.value = round(day.value);
  }
}
// Some providers identify model pools by array index. A changed label must not
// turn another model's reading into a comparable measurement of that index.
const quotaKey = (window: ProviderWindow) => JSON.stringify([window.id, window.label, window.window_seconds]);
export const amountKey = (amount: ProviderAmount) => JSON.stringify([amount.kind, amount.currency, amount.period]);
function validWindow(window: ProviderWindow, at: number): boolean {
  return window.reset_at != null && window.window_seconds != null && window.window_seconds > 0 &&
    at >= window.reset_at - window.window_seconds * 1000 && at <= window.reset_at;
}

export function computeProviderStatistics(history: ProviderHistoryEntry[], now = Date.now(), refreshSeconds = 60): { quotas: QuotaStatistics[]; amounts: AmountStatistics[] } {
  // A caller supplies one provider, region, team and saved-login context only.
  const unique = new Map<number, ProviderHistoryEntry>();
  for (const row of history) {
    const time = Date.parse(row.timestamp);
    if (Number.isFinite(time) && time <= now) unique.set(time, row);
  }
  const rows = [...unique.entries()].sort((a, b) => a[0] - b[0]);
  const windows = new Map<string, { window: ProviderWindow; at: string }>();
  const amounts = new Map<string, { amount: ProviderAmount; at: string }>();
  for (const [, row] of rows) {
    for (const window of row.windows) windows.set(quotaKey(window), { window, at: row.timestamp });
    for (const amount of row.amounts) amounts.set(amountKey(amount), { amount, at: row.timestamp });
  }
  const quotas: QuotaStatistics[] = [...windows].slice(-64).map(([id, { window, at }]) => ({
    id, label: window.label, window_seconds: window.window_seconds, current_used: window.used_percent, measured_at: at,
    comparable: validWindow(window, Date.parse(at)), ...quotaDays(window, now), summary: summary([]),
  }));
  const money: AmountStatistics[] = [...amounts].slice(-64).map(([id, { amount, at }]) => ({
    id, kind: amount.kind, currency: amount.currency, period: amount.period, current: amount.value, measured_at: at, partial: amount.partial === true,
    decreased: calendarDays(now), increased: calendarDays(now), trend: calendarDays(now), decrease_summary: summary([]), increase_summary: summary([]),
  }));
  const maxGap = Math.max(300000, refreshSeconds * 2000);
  for (const [time, row] of rows) {
    for (const metric of money) {
      const amount = row.amounts.find((value) => amountKey(value) === metric.id);
      const day = metric.trend.find((value) => time >= value.start_at && time < value.end_at);
      if (day && amount) { day.value = amount.value; day.incomplete ||= amount.partial === true; }
    }
  }
  for (let index = 1; index < rows.length; index++) {
    const [start, previous] = rows[index - 1], [end, current] = rows[index];
    const timely = end - start <= Math.max(300000, Math.max(previous.refresh_seconds, current.refresh_seconds) * 2000);
    const same = timely && previous.segment === current.segment && previous.context === current.context && previous.scope === current.scope && previous.id === current.id && previous.region === current.region;
    for (const metric of quotas) {
      const before = previous.windows.find((value) => quotaKey(value) === metric.id), after = current.windows.find((value) => quotaKey(value) === metric.id);
      const comparable = same && before && after && validWindow(before, start) && validWindow(after, end) &&
        before.reset_at === after.reset_at && after.used_percent >= before.used_percent;
      distribute(metric.daily, start, end, comparable ? after!.used_percent - before!.used_percent : null, now);
    }
    for (const metric of money) {
      const before = previous.amounts.find((value) => amountKey(value) === metric.id), after = current.amounts.find((value) => amountKey(value) === metric.id);
      const comparable = same && before && after && !before.partial && !after.partial;
      // Rolling reported costs and plan spend are levels, never sum samples or infer daily costs from them.
      const balance = ['balance', 'posted_balance', 'points'].includes(metric.kind);
      const delta = comparable && balance ? before!.value - after!.value : null;
      distribute(metric.decreased, start, end, delta == null ? null : Math.max(0, delta), now);
      distribute(metric.increased, start, end, delta == null ? null : Math.max(0, -delta), now);
      for (const { day, overlap } of overlaps(metric.trend, start, end, now)) {
        if (comparable) day.observed_ms += overlap; else day.incomplete = true;
      }
    }
  }
  for (const metric of quotas) { finish(metric.daily, now, maxGap); metric.summary = summary(metric.daily); }
  for (const metric of money) {
    finish(metric.decreased, now, maxGap); finish(metric.increased, now, maxGap); finish(metric.trend, now, maxGap);
    metric.decrease_summary = summary(metric.decreased); metric.increase_summary = summary(metric.increased);
  }
  return { quotas, amounts: money };
}
