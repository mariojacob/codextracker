/**
 * LoginPrompt: shown when no tokens are loaded.
 * Offers "Import from Codex CLI" (the primary path) and a brief explainer.
 * All visible strings are routed through the i18n dictionary.
 */
import { useState } from 'react';
import { useLocale } from '../i18n.js';

interface Props {
  onImported: () => void;
}

export function LoginPrompt({ onImported }: Props) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importFromCodex() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.codexAPI.importFromCodexCli();
      if (!result.ok) {
        setError(t('login.failed'));
        return;
      }
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-prompt">
      <h2>{t('login.heading')}</h2>
      <p>{t('login.body')}</p>
      {error && <div className="error-banner">{error}</div>}
      <button className="btn btn-primary" onClick={importFromCodex} disabled={busy}>
        {busy ? t('login.importing') : t('login.importButton')}
      </button>
      <p style={{ fontSize: 11, opacity: 0.7, marginTop: 12, marginBottom: 0 }}>
        {t('login.tokenStorage')}
      </p>
    </div>
  );
}