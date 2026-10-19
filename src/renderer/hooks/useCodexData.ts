/**
 * useCodexData: hook that connects the renderer to the main process.
 * Holds the latest snapshot, history, and a few action callbacks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useCodexData(enabled: boolean): CodexDataHook {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CachedSnapshot | null>(null);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const revision = generation.current;
    const snap = await window.codexAPI.fetchUsage();
    if (revision === generation.current) setSnapshot(snap);
  }, [enabled]);

  const redeem = useCallback(async (creditId: string) => {
    if (!enabled) return { ok: false, message: 'Codex monitoring is disabled.' };
    return window.codexAPI.redeemReset(creditId);
  }, [enabled]);

  const signOut = useCallback(async () => {
    await window.codexAPI.logout();
    generation.current++;
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
    if (!enabled) return;
    const revision = generation.current;
    const a = await window.codexAPI.getAuthStatus();
    if (revision !== generation.current) return;
    setAuth(a);
    if (a.authenticated) {
      await refresh();
    }
  }, [refresh, enabled]);

  // Initial load: auth, snapshot, history
  useEffect(() => {
    const revision = ++generation.current;
    if (!enabled) {
      setAuth(null); setSnapshot(null); setHistory([]);
      return;
    }
    void (async () => {
      const a = await window.codexAPI.getAuthStatus();
      if (revision !== generation.current) return;
      setAuth(a);
      if (a.authenticated) {
        const [snap, hist] = await Promise.all([
          window.codexAPI.fetchUsage(),
          window.codexAPI.getHistory(),
        ]);
        if (revision !== generation.current) return;
        setSnapshot(snap);
        setHistory(hist);
      }
    })();
    return () => { generation.current++; };
  }, [enabled]);

  // Subscribe to live updates from main (push model)
  useEffect(() => {
    if (!enabled) return;
    const unsub = window.codexAPI.onSnapshotUpdate((snap) => {
      setSnapshot(snap);
      // Pull history every 5th update (cheap, but keeps it fresh)
      if (Math.random() < 0.2) {
        const revision = generation.current;
        void window.codexAPI.getHistory().then((value) => { if (revision === generation.current) setHistory(value); });
      }
    });
    return unsub;
  }, [enabled]);

  // Periodic history refresh (every 5 min) for the sparkline to grow
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const revision = generation.current;
      void window.codexAPI.getHistory().then((value) => { if (revision === generation.current) setHistory(value); });
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [enabled]);

  return { auth, snapshot, history, refresh, redeem, signOut, signIn };
}
