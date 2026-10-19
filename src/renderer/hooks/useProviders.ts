import { useCallback, useEffect, useState } from 'react';
import type { ProviderConnection, ProviderError, ProviderId, ProviderSnapshot } from '../../shared/providers.js';

export function useProviders() {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [error, setError] = useState(false);
  const reloadConnections = useCallback(async () => {
    try { setConnections(await window.codexAPI.getProviderConnections()); }
    catch { setError(true); }
  }, []);
  const refresh = useCallback(async (id?: ProviderId) => {
    try { setSnapshots(await window.codexAPI.refreshProviders(id)); setError(false); }
    catch { setError(true); }
  }, []);
  useEffect(() => {
    let active = true;
    void window.codexAPI.getProviders().then((next) => { if (active) setSnapshots(next); }).catch(() => { if (active) setError(true); });
    const unsubscribe = window.codexAPI.onProvidersUpdate((next) => { setSnapshots(next); setError(false); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const credentialAction = async (action: () => Promise<{ ok: boolean; error: ProviderError | null }>) => {
    try {
      const result = await action();
      await reloadConnections();
      return result;
    } catch { return { ok: false, error: 'keyring' as const }; }
  };
  return {
    snapshots, connections, error, refresh, reloadConnections,
    saveCredential: (id: ProviderId, secret: string) => credentialAction(() => window.codexAPI.saveProviderCredential(id, secret)),
    removeCredential: (id: ProviderId) => credentialAction(() => window.codexAPI.removeProviderCredential(id)),
    importCredential: (id: ProviderId) => credentialAction(() => window.codexAPI.importProviderCredential(id)),
  };
}

export type ProviderControls = ReturnType<typeof useProviders>;
