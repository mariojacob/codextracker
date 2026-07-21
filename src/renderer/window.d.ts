/**
 * Ambient type declarations for the renderer.
 *
 * The `codexAPI` global is set up by the preload script via contextBridge.
 * This file tells TypeScript what shape it has, so renderer code can
 * call `window.codexAPI.foo()` with full type-checking.
 */
import type {
  AuthStatus,
  CachedSnapshot,
  HistorySnapshot,
  Settings,
  Statistics,
} from '../shared/types';

declare global {
  interface Window {
    codexAPI: {
      getAuthStatus: () => Promise<AuthStatus>;
      importFromCodexCli: () => Promise<{ ok: boolean; email: string }>;
      logout: () => Promise<{ ok: boolean }>;
      fetchUsage: () => Promise<CachedSnapshot>;
      redeemReset: (creditId: string) => Promise<{ ok: boolean; message: string }>;
      getHistory: () => Promise<HistorySnapshot[]>;
      getSettings: () => Promise<Settings>;
      setSettings: (s: Settings) => Promise<{ ok: boolean }>;
      getStats: () => Promise<Statistics>;
      minimizeWindow: () => Promise<void>;
      quit: () => Promise<void>;
      openStatsWindow: () => Promise<{ ok: boolean }>;
      onSnapshotUpdate: (cb: (snap: CachedSnapshot) => void) => () => void;
    };
  }
}

export {};
