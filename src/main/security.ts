import type { Settings } from '../shared/types.js';
import { PROVIDERS, PROVIDER_IDS, type ProviderId, type ProviderSettings } from '../shared/providers.js';
import type { StatisticsSelection } from '../shared/provider-statistics.js';
import { MODULE_IDS, moduleOrder, type ModuleId } from '../shared/modules.js';

const ALLOWED_CARDS = new Set(['session', 'weekly', 'credits', 'resets']);

interface SenderLike {
  id: number;
  mainFrame?: unknown;
  isDestroyed?: () => boolean;
}

interface EventLike {
  sender: SenderLike;
  senderFrame?: unknown;
}

interface WindowLike {
  isDestroyed(): boolean;
  webContents: SenderLike;
}

export function assertTrustedIpcSender(event: EventLike, windows: Array<WindowLike | null>): void {
  const sender = event.sender;
  const knownWindow = windows.some(
    (window) => window && !window.isDestroyed() && window.webContents.id === sender.id,
  );
  const mainFrame = sender.mainFrame;
  if (!knownWindow || sender.isDestroyed?.() || !event.senderFrame || event.senderFrame !== mainFrame) {
    throw new Error('Blocked IPC call from an untrusted renderer.');
  }
}

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('Settings must be an object.');
  const input = value as Record<string, unknown>;
  const codexEnabled = input.codex_enabled === undefined ? true : input.codex_enabled;
  if (typeof codexEnabled !== 'boolean') throw new Error('Invalid Codex enabled flag.');
  if (input.codex_banked_reset_budget !== undefined && typeof input.codex_banked_reset_budget !== 'boolean') {
    throw new Error('Invalid banked reset budget flag.');
  }
  const refresh = boundedInteger(input.refresh_seconds, 10, 3600, 'refresh_seconds');
  const historyDays = boundedInteger(input.history_days, 1, 365, 'history_days');
  if (input.language !== 'en' && input.language !== 'de') throw new Error('Unsupported language.');
  const providers = validateProviderSettings(input.providers ?? []);
  const order = input.module_order === undefined ? [] : input.module_order;
  if (!Array.isArray(order) || order.length > MODULE_IDS.length ||
      order.some((id) => !MODULE_IDS.includes(id as ModuleId)) || new Set(order).size !== order.length) {
    throw new Error('Invalid module order.');
  }

  const notifications = input.notifications;
  if (!notifications || typeof notifications !== 'object') throw new Error('Invalid notifications settings.');
  const notificationInput = notifications as Record<string, unknown>;
  if (typeof notificationInput.enabled !== 'boolean') throw new Error('Invalid notifications flag.');
  if (!Array.isArray(notificationInput.rules) || notificationInput.rules.length > 100) {
    throw new Error('Invalid notification rules.');
  }

  const seenIds = new Set<string>();
  const rules = notificationInput.rules.filter((raw) => !(raw && typeof raw === 'object' && (raw as Record<string, unknown>).card === 'forecast')).map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid notification rule.');
    const rule = raw as Record<string, unknown>;
    if (typeof rule.id !== 'string' || rule.id.length < 1 || rule.id.length > 128 || seenIds.has(rule.id)) {
      throw new Error('Invalid or duplicate notification rule ID.');
    }
    seenIds.add(rule.id);
    if (typeof rule.card !== 'string' || !ALLOWED_CARDS.has(rule.card)) throw new Error('Invalid notification card.');
    if (rule.field !== 'pct_left') throw new Error('Invalid notification field.');
    if (typeof rule.enabled !== 'boolean') throw new Error('Invalid notification rule flag.');
    const threshold = boundedNumber(rule.threshold, 0, 100, 'notification threshold');
    return {
      id: rule.id,
      card: rule.card as Settings['notifications']['rules'][number]['card'],
      field: 'pct_left' as const,
      threshold,
      enabled: rule.enabled,
    };
  });

  return {
    codex_enabled: codexEnabled,
    providers,
    module_order: moduleOrder(order as ModuleId[]),
    ...(input.manual_resets === undefined ? {} : { manual_resets: validateManualResets(input.manual_resets) }),
    ...(input.codex_banked_reset_budget === undefined ? {} : { codex_banked_reset_budget: input.codex_banked_reset_budget }),
    refresh_seconds: refresh,
    history_days: historyDays,
    language: input.language,
    notifications: { enabled: notificationInput.enabled, rules },
  };
}

function validateManualResets(value: unknown): NonNullable<Settings['manual_resets']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manual resets.');
  const result: NonNullable<Settings['manual_resets']> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!MODULE_IDS.includes(id as ModuleId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid manual reset module.');
    const entry = raw as Record<string, unknown>;
    if (typeof entry.window_id !== 'string' || !entry.window_id.length || entry.window_id.length > 256 ||
        typeof entry.enabled !== 'boolean') throw new Error('Invalid manual reset.');
    const resetAt = boundedNumber(entry.reset_at, 0, 8.64e15, 'manual reset date');
    const startAt = boundedNumber(entry.start_at, 0, 8.64e15, 'manual reset start');
    if (resetAt <= startAt) throw new Error('Invalid manual reset interval.');
    result[id as ModuleId] = { window_id: entry.window_id, reset_at: resetAt, enabled: entry.enabled,
      start_at: startAt, start_used_percent: boundedNumber(entry.start_used_percent, 0, 100, 'manual reset usage') };
  }
  return result;
}

export function validateProviderId(value: unknown): ProviderId {
  if (typeof value !== 'string' || !PROVIDER_IDS.includes(value as ProviderId)) throw new Error('Invalid provider.');
  return value as ProviderId;
}

export function validateStatisticsSelection(value: unknown): StatisticsSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid statistics module.');
  const raw = value as Record<string, unknown>;
  const id = raw.id === 'codex' ? 'codex' : validateProviderId(raw.id);
  if (raw.region !== 'global' && raw.region !== 'china') throw new Error('Invalid statistics region.');
  if (raw.region === 'china' && (id === 'codex' || !PROVIDERS.find((provider) => provider.id === id)?.regions)) throw new Error('Invalid statistics region.');
  return { id, region: raw.region };
}

function validateProviderSettings(value: unknown): ProviderSettings[] {
  if (!Array.isArray(value) || value.length > PROVIDER_IDS.length) throw new Error('Invalid providers.');
  const seen = new Set<ProviderId>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid provider settings.');
    const id = validateProviderId(raw.id);
    if (seen.has(id)) throw new Error('Duplicate provider.');
    seen.add(id);
    if (typeof raw.enabled !== 'boolean') throw new Error('Invalid provider flag.');
    const region = raw.region ?? (id === 'kimi' ? 'china' : 'global');
    if (region !== 'global' && region !== 'china') throw new Error('Invalid provider region.');
    if (region === 'china' && !PROVIDERS.find((provider) => provider.id === id)?.regions) throw new Error('Unsupported provider region.');
    const team = raw.team_id ?? '';
    if (typeof team !== 'string' || !/^[a-zA-Z0-9_-]{0,128}$/.test(team)) throw new Error('Invalid team ID.');
    return { id, enabled: raw.enabled, region, team_id: team };
  });
}

export function validateResetCreditId(value: unknown, knownIds: readonly string[]): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !knownIds.includes(value)) {
    throw new Error('Unknown reset credit.');
  }
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, name: string): number {
  const result = boundedNumber(value, min, max, name);
  if (!Number.isInteger(result)) throw new Error(`${name} must be an integer.`);
  return result;
}

function boundedNumber(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}
