/**
 * Preload bridge: the only path between renderer (Chromium sandbox) and
 * main (Node.js). Each function is a thin wrapper over ipcRenderer.invoke
 * for the corresponding channel.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthStatus,
  CachedSnapshot as _CS,
  HistorySnapshot,
  Settings,
} from '../shared/types.js';
import type { ProviderConnection, ProviderError, ProviderId, ProviderSnapshot } from '../shared/providers.js';
import type { ModuleStatisticsReport, StatisticsSelection } from '../shared/provider-statistics.js';

// Sandboxed Electron preload scripts may only require a small set of built-in
// modules. In particular, they cannot load our compiled ../shared/types.js at
// runtime. Keep the channel strings local so this file compiles to a standalone
// preload script (the corresponding handlers live in src/main/index.ts).
const IPC = {
  AUTH_STATUS: 'auth:status',
  AUTH_IMPORT_CODEX: 'auth:import-codex',
  AUTH_LOGOUT: 'auth:logout',
  USAGE_FETCH: 'usage:fetch',
  RESET_REDEEM: 'reset:redeem',
  HISTORY_GET: 'history:get',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  STATS_GET: 'stats:get',
  WINDOW_OPEN_STATS: 'window:open-stats',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_QUIT: 'window:quit',
  PROVIDERS_GET: 'providers:get',
  PROVIDERS_REFRESH: 'providers:refresh',
  PROVIDERS_CONNECTIONS: 'providers:connections',
  PROVIDER_SAVE_CREDENTIAL: 'providers:save-credential',
  PROVIDER_REMOVE_CREDENTIAL: 'providers:remove-credential',
  PROVIDER_IMPORT_CREDENTIAL: 'providers:import-credential',
  PROVIDER_OPEN_DASHBOARD: 'providers:open-dashboard',
} as const;

// Re-export type used by the renderer.
type CachedSnapshot = _CS;

const api = {
  // ---- Auth ----
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.AUTH_STATUS),
  importFromCodexCli: (): Promise<{ ok: boolean; email: string }> =>
    ipcRenderer.invoke(IPC.AUTH_IMPORT_CODEX),
  logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.AUTH_LOGOUT),

  // ---- Usage ----
  fetchUsage: (): Promise<CachedSnapshot> => ipcRenderer.invoke(IPC.USAGE_FETCH),
  redeemReset: (creditId: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.RESET_REDEEM, creditId),

  // ---- History ----
  getHistory: (): Promise<HistorySnapshot[]> => ipcRenderer.invoke(IPC.HISTORY_GET),

  // ---- Settings ----
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (s: Settings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, s),

  // ---- Statistics ----
  getStats: (selection?: StatisticsSelection): Promise<ModuleStatisticsReport> => ipcRenderer.invoke(IPC.STATS_GET, selection),
  onStatsUpdate: (cb: () => void): (() => void) => {
    const listener = () => cb(); ipcRenderer.on('stats:updated', listener);
    return () => ipcRenderer.removeListener('stats:updated', listener);
  },

  getProviders: (): Promise<ProviderSnapshot[]> => ipcRenderer.invoke(IPC.PROVIDERS_GET),
  refreshProviders: (id?: ProviderId): Promise<ProviderSnapshot[]> => ipcRenderer.invoke(IPC.PROVIDERS_REFRESH, id),
  getProviderConnections: (): Promise<ProviderConnection[]> => ipcRenderer.invoke(IPC.PROVIDERS_CONNECTIONS),
  saveProviderCredential: (id: ProviderId, secret: string): Promise<{ ok: boolean; error: ProviderError | null }> => ipcRenderer.invoke(IPC.PROVIDER_SAVE_CREDENTIAL, id, secret),
  removeProviderCredential: (id: ProviderId): Promise<{ ok: boolean; error: ProviderError | null }> => ipcRenderer.invoke(IPC.PROVIDER_REMOVE_CREDENTIAL, id),
  importProviderCredential: (id: ProviderId): Promise<{ ok: boolean; error: ProviderError | null }> => ipcRenderer.invoke(IPC.PROVIDER_IMPORT_CREDENTIAL, id),
  openProviderDashboard: (id: ProviderId): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.PROVIDER_OPEN_DASHBOARD, id),
  onProvidersUpdate: (cb: (snapshots: ProviderSnapshot[]) => void): (() => void) => {
    const listener = (_e: unknown, snapshots: ProviderSnapshot[]) => cb(snapshots);
    ipcRenderer.on('providers:updated', listener);
    return () => ipcRenderer.removeListener('providers:updated', listener);
  },

  // ---- Window controls ----
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_QUIT),
  openStatsWindow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.WINDOW_OPEN_STATS),

  // ---- Events from main → renderer ----
  onSnapshotUpdate: (cb: (snap: CachedSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, snap: CachedSnapshot) => cb(snap);
    ipcRenderer.on('snapshot:updated', listener);
    return () => ipcRenderer.removeListener('snapshot:updated', listener);
  },
};

contextBridge.exposeInMainWorld('codexAPI', api);

export type CodexAPI = typeof api;
