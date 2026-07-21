/**
 * Persistent app settings (refresh interval, notification rules).
 * Lives in ~/.codex-tracker/settings.json (alongside auth.json).
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Settings, NotificationRule } from '../shared/types.js';
import { validateSettings } from './security.js';

export type { Settings, NotificationRule };

const DEFAULT_SETTINGS: Settings = {
  refresh_seconds: 60,
  forecast_minutes: 20,
  notifications: {
    enabled: true,
    rules: [
      { id: 'session-low', card: 'session', field: 'pct_left', threshold: 20, enabled: true },
      { id: 'weekly-low', card: 'weekly', field: 'pct_left', threshold: 20, enabled: true },
      {
        id: 'reset-expiring',
        card: 'resets',
        field: 'pct_left',
        threshold: 100,
        enabled: false,
      },
      {
        id: 'forecast-high',
        card: 'forecast',
        field: 'pct_left',
        threshold: 70,
        enabled: false,
      },
    ],
  },
  history_days: 30,
  language: 'en',
};

function settingsPath(): string {
  return path.join(os.homedir(), '.codex-tracker', 'settings.json');
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<Settings>;
    return validateSettings({
      ...DEFAULT_SETTINGS,
      ...data,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        ...(data.notifications ?? {}),
        rules: data.notifications?.rules ?? DEFAULT_SETTINGS.notifications.rules,
      },
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const file = settingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}
