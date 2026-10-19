import type { ProviderAmount, ProviderId, ProviderRegion, ProviderWarning, ProviderWindow } from '../../shared/providers.js';
import { ProviderFetchError } from './errors.js';

export interface ProviderData { plan: string | null; windows: ProviderWindow[]; amounts: ProviderAmount[]; warnings?: ProviderWarning[] }
type ObjectData = Record<string, unknown>;
export const object = (value: unknown): ObjectData => value != null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, 64) : [];
export function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
}
export function timestamp(value: unknown): number | null {
  if (value == null || value === '') return null;
  const seconds = object(value).seconds;
  if (seconds != null) return timestamp(seconds);
  const number = numeric(value);
  const ms = number == null ? typeof value === 'string' ? Date.parse(value) : NaN : number < 1e12 ? number * 1000 : number;
  return Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? ms : null;
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 100) : null;
}
function percent(value: unknown): number | null {
  const n = numeric(value);
  return n != null && n >= 0 ? Math.min(100, n) : null;
}
function ratio(used: unknown, limit: unknown, remaining?: unknown): number | null {
  const cap = numeric(limit), count = numeric(used), left = numeric(remaining);
  if (cap == null || cap <= 0) return null;
  if (count != null && count >= 0) return percent(count / cap * 100);
  return left != null && left >= 0 && left <= cap ? percent((cap - left) / cap * 100) : null;
}
function between(start: unknown, end: unknown): number | null {
  const a = timestamp(start), b = timestamp(end);
  return a != null && b != null && b > a && b - a <= 366 * 86400000 ? (b - a) / 1000 : null;
}
function windowLabel(seconds: number | null): string {
  return seconds === 604800 ? 'weekly' : seconds === 18000 ? '5h' : seconds === 86400 ? 'daily' : 'quota';
}
function addWindow(data: ProviderData, id: string, used: number | null, reset: unknown, seconds: number | null, label?: string): void {
  if (used == null) return;
  data.windows.push({ id, label: label ?? windowLabel(seconds), used_percent: used, reset_at: timestamp(reset), window_seconds: seconds });
}
function amount(data: ProviderData, kind: ProviderAmount['kind'], value: unknown, currency: string, divisor = 1, period: ProviderAmount['period'] = null): void {
  const n = numeric(value);
  if (n != null) data.amounts.push({ kind, value: n / divisor, currency, period });
}

export function parseAntigravity(raw: unknown): ProviderData {
  const root = object(raw), command = object(root.command);
  if (root.code != null && !['0', 'ok', 'success'].includes(String(root.code).toLowerCase())) throw new ProviderFetchError('unsupported_response');
  if (root.command != null && (root.status !== 'SUCCESS' || command.name !== 'usage')) throw new ProviderFetchError('unsupported_response');
  const payload = object(command.data ?? root.response ?? root.summary ?? root);
  const user = object(root.userStatus), planInfo = object(object(user.planStatus).planInfo);
  const data: ProviderData = { plan: text(planInfo.planDisplayName ?? planInfo.planName ?? object(user.userTier).name), windows: [], amounts: [] };
  array(payload.groups).forEach((group, groupIndex) => {
    const g = object(group), groupName = text(g.displayName ?? g.display_name ?? g.name) ?? 'Quota';
    array(g.buckets).forEach((bucket, index) => {
      const b = object(bucket);
      if (b.disabled === true) return;
      const remaining = object(b.remaining);
      const fraction = numeric(b.remainingFraction ?? b.remaining_fraction ?? remaining.remainingFraction ?? remaining.remaining_fraction ?? (remaining.case === 'remainingFraction' ? remaining.value : null));
      if (fraction == null || fraction < 0 || fraction > 1) return;
      const name = text(b.displayName ?? b.display_name ?? b.name ?? b.bucketId ?? b.bucket_id ?? b.id) ?? 'Quota';
      const kind = `${b.window ?? ''} ${b.bucketId ?? b.bucket_id ?? b.id ?? ''} ${name}`.toLowerCase();
      const seconds = /week|seven[_ -]?day|7[_ -]?d/.test(kind) ? 604800 : /five[_ -]?hour|5[_ -]?(?:hour|h)/.test(kind) ? 18000 : null;
      addWindow(data, `${groupIndex}-${index}`, (1 - fraction) * 100, b.resetTime ?? b.reset_time, seconds, `${groupName} · ${seconds == null ? name : windowLabel(seconds)}`);
    });
  });
  if (!data.windows.length) {
    const models = object(user.cascadeModelConfigData).clientModelConfigs ?? root.clientModelConfigs;
    array(models).forEach((model, index) => {
      const m = object(model), quota = object(m.quotaInfo), fraction = numeric(quota.remainingFraction);
      if (fraction != null && fraction >= 0 && fraction <= 1) addWindow(data, `model-${index}`, (1 - fraction) * 100, quota.resetTime, null, text(m.label) ?? 'Quota');
    });
  }
  return requireData(data);
}

export function parseProviderData(id: ProviderId, raw: unknown, region: ProviderRegion = 'global'): ProviderData {
  if (id === 'antigravity') return parseAntigravity(raw);
  const root = object(raw);
  const data: ProviderData = { plan: null, windows: [], amounts: [] };
  switch (id) {
    case 'claude': {
      for (const [key, seconds, label] of [
        ['five_hour', 18000, '5h'], ['seven_day', 604800, 'weekly'],
        ['seven_day_sonnet', 604800, 'Sonnet · weekly'], ['seven_day_opus', 604800, 'Opus · weekly'],
      ] as const) {
        const w = object(root[key]);
        addWindow(data, key, percent(w.utilization), w.resets_at, seconds, label);
      }
      const extra = object(root.extra_usage);
      if (extra.is_enabled === true) amount(data, 'on_demand_spend', extra.used_credits, text(extra.currency) ?? 'USD', 100, 'current_cycle');
      break;
    }
    case 'cursor': {
      data.plan = text(root.membershipType);
      const individual = object(root.individualUsage), plan = object(individual.plan), overall = object(individual.overall);
      const seconds = between(root.billingCycleStart, root.billingCycleEnd);
      // Never average independent Auto and API pools into a fictional overall percentage.
      const total = percent(plan.totalPercentUsed) ?? ratio(plan.used, plan.limit, plan.remaining) ?? ratio(overall.used, overall.limit, overall.remaining);
      addWindow(data, 'plan', total, root.billingCycleEnd, seconds, 'included');
      if (total == null) {
        addWindow(data, 'auto', percent(plan.autoPercentUsed), root.billingCycleEnd, seconds, 'Auto');
        addWindow(data, 'api', percent(plan.apiPercentUsed), root.billingCycleEnd, seconds, 'API models');
      }
      if (plan.enabled !== false) amount(data, 'included_spend', plan.used ?? overall.used, 'USD', 100, 'current_cycle');
      const extra = object(individual.onDemand);
      if (extra.enabled === true) amount(data, 'on_demand_spend', extra.used, 'USD', 100, 'current_cycle');
      break;
    }
    case 'grok': {
      const config = object(root.config), period = object(config.currentPeriod);
      const seconds = between(period.start, period.end) ?? between(config.billingPeriodStart, config.billingPeriodEnd);
      const used = percent(config.creditUsagePercent) ?? ratio(object(config.onDemandUsed).val, object(config.onDemandCap).val);
      addWindow(data, 'credits', used, period.end ?? config.billingPeriodEnd, seconds, windowLabel(seconds));
      // Unknown period-only responses remain unknown, even when the omitted scalar could mean zero.
      if (!data.windows.length) addWindow(data, 'legacy', ratio(object(object(root.usage).totalUsed).val, object(root.monthlyLimit).val), object(root.billingCycle).billingPeriodEnd, between(object(root.billingCycle).billingPeriodStart, object(root.billingCycle).billingPeriodEnd));
      data.plan = text(root.subscription_tier);
      break;
    }
    case 'minimax': {
      const status = object(root.base_resp).status_code;
      if (status != null && numeric(status) !== 0) throw new ProviderFetchError('needs_auth');
      const body = object(root.data ?? root);
      data.plan = text(body.current_subscribe_title ?? body.plan_name);
      array(body.model_remains).forEach((row, index) => {
        const model = object(row), name = text(model.model_name) ?? 'Quota';
        for (const weekly of [false, true]) {
          const prefix = weekly ? 'current_weekly' : 'current_interval';
          const remaining = numeric(model[`${prefix}_remaining_percent`]);
          // MiniMax's legacy "usage_count" reports REMAINING prompts, despite its name.
          const used = remaining != null && remaining >= 0 && remaining <= 100 ? 100 - remaining : ratio(null, model[`${prefix}_total_count`], model[`${prefix}_usage_count`]);
          const end = weekly ? model.weekly_end_time : model.end_time;
          const start = weekly ? model.weekly_start_time : model.start_time;
          const seconds = between(start, end);
          addWindow(data, `${index}-${prefix}`, used, end, seconds, `${name} · ${windowLabel(seconds)}`);
        }
      });
      amount(data, 'points', body.points_balance, 'points');
      break;
    }
    case 'zai': {
      if (root.success !== true || numeric(root.code) !== 200) throw new ProviderFetchError('unsupported_response');
      const body = object(root.data);
      data.plan = text(body.planName ?? body.plan ?? body.plan_type ?? body.packageName);
      array(body.limits).forEach((entry, index) => {
        const w = object(entry);
        if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(String(w.type))) return;
        const multipliers: Record<string, number> = { '1': 86400, '3': 3600, '5': 60, '6': 604800 };
        const count = numeric(w.number), multiplier = multipliers[String(w.unit)];
        const seconds = count != null && count > 0 && multiplier ? count * multiplier : null;
        addWindow(data, `quota-${index}`, ratio(w.currentValue, w.usage, w.remaining) ?? percent(w.percentage), w.nextResetTime, seconds, w.type === 'TIME_LIMIT' ? 'MCP' : windowLabel(seconds));
      });
      break;
    }
    case 'kimi': {
      const pools = object(root.usages);
      for (const [key, seconds, label] of [['limit_5h', 18000, '5h'], ['limit_7d', 604800, 'weekly'], ['limit_month_total', null, 'monthly']] as const) {
        const pool = object(pools[key]), used = numeric(pool.used_ratio);
        if (used != null && used >= 0) addWindow(data, key, Math.min(100, used * 100), pool.reset_time, seconds, label);
      }
      {
        const usage = object(root.usage);
        const used = ratio(usage.used, usage.limit, usage.remaining), reset = timestamp(usage.resetTime ?? usage.reset_time);
        const existing = data.windows.find((w) => w.id === 'limit_7d');
        if (!existing) addWindow(data, 'legacy-weekly', used, reset, 604800);
        else if (used != null && reset != null && existing.reset_at != null && Math.abs(reset - existing.reset_at) <= 2000) existing.used_percent = Math.max(existing.used_percent, used);
      }
      array(root.limits).forEach((entry, index) => {
        const w = object(entry), duration = object(w.window), detail = object(w.detail);
        const multipliers: Record<string, number> = { TIME_UNIT_MINUTE: 60, TIME_UNIT_HOUR: 3600, TIME_UNIT_DAY: 86400 };
        const n = numeric(duration.duration), multiplier = multipliers[String(duration.timeUnit)];
        const seconds = n != null && n > 0 && multiplier ? n * multiplier : null;
        const used = ratio(detail.used, detail.limit, detail.remaining), reset = timestamp(detail.resetTime ?? detail.reset_time);
        const existing = data.windows.find((w) => w.id === 'limit_5h' && seconds === 18000);
        if (!existing) addWindow(data, `legacy-${index}`, used, reset, seconds);
        else if (used != null && reset != null && existing.reset_at != null && Math.abs(reset - existing.reset_at) <= 2000) existing.used_percent = Math.max(existing.used_percent, used);
      });
      if (data.windows.some((w) => w.id === 'limit_month_total' && w.used_percent >= 100 && (w.reset_at == null || w.reset_at > Date.now()))) data.warnings = ['monthly_exhausted'];
      data.plan = text(object(object(root.user).membership).level);
      break;
    }
    case 'deepseek': {
      if (root.is_available === false) data.warnings = ['balance_unavailable'];
      array(root.balance_infos).forEach((entry) => {
        const row = object(entry), currency = text(row.currency);
        if (currency && /^[A-Z]{3}$/.test(currency)) amount(data, 'balance', row.total_balance, currency);
      });
      break;
    }
    case 'moonshot': {
      const body = object(root.data);
      amount(data, 'balance', body.available_balance, region === 'china' ? 'CNY' : 'USD');
      break;
    }
    case 'xai': {
      // The documented posted ledger is inverted and denominated in cents.
      const total = numeric(root.total);
      if (total != null) amount(data, 'posted_balance', -total, 'USD', 100);
      break;
    }
    case 'anthropic': {
      if (!Array.isArray(root.data)) throw new ProviderFetchError('unsupported_response');
      const totals = new Map<string, number>();
      for (const bucket of root.data) {
        const results = object(bucket).results;
        if (!Array.isArray(results)) throw new ProviderFetchError('unsupported_response');
        for (const item of results) {
        const row = object(item), value = numeric(row.amount), currency = text(row.currency)?.toUpperCase();
        if (value != null && currency && /^[A-Z]{3}$/.test(currency)) totals.set(currency, (totals.get(currency) ?? 0) + value / 100);
        else throw new ProviderFetchError('unsupported_response');
        }
      }
      if (!totals.size) totals.set('USD', 0);
      for (const [currency, value] of totals) data.amounts.push({ kind: 'spend', value, currency, period: 'last_30_days', partial: root.has_more === true });
      break;
    }
  }
  return requireData(data);
}

export function requireData(data: ProviderData): ProviderData {
  if (!data.windows.length && !data.amounts.length) throw new ProviderFetchError('unsupported_response');
  return data;
}
