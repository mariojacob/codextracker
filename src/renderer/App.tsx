/**
 * App: top-level component.
 *   - Loads settings first so the LocaleProvider can render in the right language
 *   - Single-line header (title, account email/plan, refresh + settings icons)
 *   - Compact metric sections via Cards (or LoginPrompt when not authed)
 *   - SettingsDialog (modal) — language switcher lives here
 */
import { useEffect, useRef, useState } from 'react';
import { LoginPrompt } from './components/LoginPrompt.js';
import { Cards } from './components/Cards.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { useCodexData } from './hooks/useCodexData.js';
import { useProviders } from './hooks/useProviders.js';
import { ProviderCards } from './components/ProviderCards.js';
import { LocaleProvider, useLocale } from './i18n.js';
import type { Settings } from '../shared/types.js';
import { moveModule, type ModuleId } from '../shared/modules.js';

function statusClass(pct: number | null, snapshotError: string | null | undefined): 'ok' | 'warn' | 'err' {
  if (snapshotError) return 'err';
  if (pct == null) return 'ok';     // no data yet → don't warn
  if (pct < 30) return 'warn';
  return 'ok';
}

function Inner({ initialSettings }: { initialSettings: Settings }) {
  const { t } = useLocale();
  const [currentSettings, setCurrentSettings] = useState(initialSettings);
  const codexEnabled = currentSettings.codex_enabled;
  const { auth, snapshot, signIn, signOut } = useCodexData(codexEnabled);
  const providers = useProviders();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderError, setOrderError] = useState(false);
  const orderSavePending = useRef(false);

  async function handleMoveModule(source: ModuleId, target: ModuleId) {
    if (orderSavePending.current || settingsOpen || source === target) return;
    orderSavePending.current = true;
    setOrderSaving(true);
    setOrderError(false);
    const next = { ...currentSettings, module_order: moveModule(currentSettings.module_order, source, target) };
    try {
      const result = await window.codexAPI.setSettings(next);
      if (!result.ok) throw new Error('Settings save failed.');
      setCurrentSettings(next);
    } catch {
      setOrderError(true);
    } finally {
      orderSavePending.current = false;
      setOrderSaving(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      await Promise.allSettled([...(codexEnabled ? [signIn()] : []), providers.refresh()]);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
  }

  async function handleQuit() {
    await window.codexAPI.quit();
  }

  async function handleOpenStats() {
    await window.codexAPI.openStatsWindow();
  }

  function handleSettingsChanged(next: Settings) {
    setCurrentSettings(next);
  }

  const isAuthed = auth?.authenticated ?? false;
  const updatedAt = [codexEnabled ? snapshot?.fetched_at : null, ...providers.snapshots.map((provider) => provider.fetched_at)]
    .filter((value): value is string => !!value).sort().at(-1);

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>

        <span className="header-spacer" />

        <button className="icon-btn" onClick={() => void handleRefresh()} disabled={busy}
          title={t('app.refresh.tooltip')} aria-label={t('app.refresh.tooltip')}>{busy ? '⟳' : '↻'}</button>

        <button
          className="icon-btn"
          onClick={handleOpenStats}
          title={t('app.stats.tooltip')}
          aria-label={t('app.stats.tooltip')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2" y1="12" x2="2" y2="9" />
            <line x1="6" y1="12" x2="6" y2="5" />
            <line x1="10" y1="12" x2="10" y2="7" />
            <line x1="1" y1="12.5" x2="13" y2="12.5" />
          </svg>
        </button>

        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          disabled={orderSaving}
          title={t('app.settings.tooltip')}
        >
          ⚙
        </button>
      </header>

      <main className="app-main">
        {orderError && <div className="error-banner" role="alert">{t('providers.error.settings')}</div>}
        <ProviderCards snapshots={providers.snapshots} error={providers.error}
          order={currentSettings.module_order} onMove={handleMoveModule} saving={orderSaving || settingsOpen} codex={codexEnabled ? (controls) =>
          <section className="provider-card provider-codex">
            <div className="provider-card-head"><h3>ChatGPT / Codex</h3>
              {(snapshot?.plan || auth?.plan) && <span className="header-plan">{snapshot?.plan || auth?.plan}</span>}
              {controls}
            </div>
            {isAuthed && (auth?.email || snapshot?.email) && <p className="provider-note provider-account">{auth?.email || snapshot?.email}</p>}
            {isAuthed ? <>
            {snapshot?.session_window_available && (
            <span
              className={`status-pill ${statusClass(snapshot.session_pct_left, snapshot.error)}`}
            >
              {snapshot.session_pct_left != null && snapshot.session_pct_left < 30
                ? t('status.sessionLow')
                : t('status.ok')}
            </span>
          )}
          <Cards snapshot={snapshot} />
            <div className="provider-card-footer"><span>{snapshot?.fetched_at ? `${t('app.footer.updated')} ${formatTime(snapshot.fetched_at)}` : ''}</span>
              <button className="btn-tiny" onClick={() => void handleOpenStats()}>{t('app.stats.tooltip')}</button></div>
            </> : <LoginPrompt onImported={() => void signIn()} />}
          </section> : null} />
        {!codexEnabled && !providers.snapshots.length && <div className="providers-empty">
          <p className="provider-note">{t('providers.empty')}</p>
          <button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>{t('settings.title')}</button>
        </div>}
      </main>

      <footer className="app-footer">
        <span>
          {updatedAt
            ? `${t('app.footer.updated')} ${formatTime(updatedAt)}`
            : t('providers.noReadings')}
        </span>
        <span>{t('app.version')}</span>
      </footer>

      <SettingsDialog
        providers={providers}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSignOut={handleSignOut}
        onCodexRefresh={signIn}
        codexAuthenticated={isAuthed}
        onQuit={handleQuit}
        currentSettings={currentSettings}
        onSettingsChanged={handleSettingsChanged}
      />
    </div>
  );
}

export default function App() {
  const [initialSettings, setInitialSettings] = useState<Settings | null>(null);

  // Pull the persisted locale once, before first render of Inner.
  // Until then we render nothing (avoid a flash of English UI for German users).
  useEffect(() => {
    let cancelled = false;
    void window.codexAPI.getSettings().then((s) => {
      if (!cancelled) setInitialSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (initialSettings == null) {
    // Minimal shell so the first paint doesn't blink from no-root → full UI.
    return <div className="app" />;
  }

  return (
    <LocaleProvider initial={initialSettings.language}>
      <Inner initialSettings={initialSettings} />
    </LocaleProvider>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
