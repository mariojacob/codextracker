import type { Settings } from '../shared/types.js';

const ALLOWED_CARDS = new Set(['session', 'weekly', 'credits', 'resets', 'forecast']);

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
  const refresh = boundedInteger(input.refresh_seconds, 10, 3600, 'refresh_seconds');
  const forecast = boundedInteger(input.forecast_minutes, 5, 120, 'forecast_minutes');
  const historyDays = boundedInteger(input.history_days, 1, 365, 'history_days');
  if (input.language !== 'en' && input.language !== 'de') throw new Error('Unsupported language.');

  const notifications = input.notifications;
  if (!notifications || typeof notifications !== 'object') throw new Error('Invalid notifications settings.');
  const notificationInput = notifications as Record<string, unknown>;
  if (typeof notificationInput.enabled !== 'boolean') throw new Error('Invalid notifications flag.');
  if (!Array.isArray(notificationInput.rules) || notificationInput.rules.length > 100) {
    throw new Error('Invalid notification rules.');
  }

  const seenIds = new Set<string>();
  const rules = notificationInput.rules.map((raw) => {
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
    refresh_seconds: refresh,
    forecast_minutes: forecast,
    history_days: historyDays,
    language: input.language,
    notifications: { enabled: notificationInput.enabled, rules },
  };
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
