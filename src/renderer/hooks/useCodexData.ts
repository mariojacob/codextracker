/**
 * useCodexData: hook that connects the renderer to the main process.
 * Holds the latest snapshot, history, and a few action callbacks.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AuthStatus, CachedSnapshot, HistorySnapshot } from '../../shared/types.js';

export interface CodexDataHook {
  auth: AuthStatus | null;
  snapshot: CachedSnapshot | null;
  history: HistorySnapshot[];
  refresh: () => Promise<void>;
  redeem: (creditId: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  signIn: () => Promise<void>; // re-checks auth and re-fetches
}

export function useCodexData(): CodexDataHook {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CachedSnapshot | null>(null);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);

  const refresh = useCallback(async () => {
    const snap = await window.codexAPI.fetchUsage();
    setSnapshot(snap);
  }, []);

  const redeem = useCallback(async (creditId: string) => {
    return window.codexAPI.redeemReset(creditId);
  }, []);

  const signOut = useCallback(async () => {
    await window.codexAPI.logout();
    setAuth({
      authenticated: false,
      source: 'none',
      email: '',
      plan: '',
      account_id: '',
      expires_in_seconds: -1,
    });
    setSnapshot(null);
  }, []);

  const signIn = useCallback(async () => {
    const a = await window.codexAPI.getAuthStatus();
    setAuth(a);
    if (a.authenticated) {
      await refresh();
    }
  }, [refresh]);

  // Initial load: auth, snapshot, history
  useEffect(() => {
    void (async () => {
      const a = await window.codexAPI.getAuthStatus();
      setAuth(a);
      if (a.authenticated) {
        const [snap, hist] = await Promise.all([
          window.codexAPI.fetchUsage(),
          window.codexAPI.getHistory(),
        ]);
        setSnapshot(snap);
        setHistory(hist);
      }
    })();
  }, []);

  // Subscribe to live updates from main (push model)
  useEffect(() => {
    const unsub = window.codexAPI.onSnapshotUpdate((snap) => {
      setSnapshot(snap);
      // Pull history every 5th update (cheap, but keeps it fresh)
      if (Math.random() < 0.2) {
        void window.codexAPI.getHistory().then(setHistory);
      }
    });
    return unsub;
  }, []);

  // Periodic history refresh (every 5 min) for the sparkline to grow
  useEffect(() => {
    const id = setInterval(() => {
      void window.codexAPI.getHistory().then(setHistory);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return { auth, snapshot, history, refresh, redeem, signOut, signIn };
}
