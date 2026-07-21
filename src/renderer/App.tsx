/**
 * App: top-level component.
 *   - Loads settings first so the LocaleProvider can render in the right language
 *   - Single-line header (title, account email/plan, refresh + settings icons)
 *   - Four compact sections via <Cards /> (or LoginPrompt when not authed)
 *   - SettingsDialog (modal) — language switcher lives here
 */
import { useEffect, useState } from 'react';
import { LoginPrompt } from './components/LoginPrompt.js';
import { Cards } from './components/Cards.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { useCodexData } from './hooks/useCodexData.js';
import { LocaleProvider, useLocale } from './i18n.js';
import type { Settings, Language } from '../shared/types.js';

function statusClass(pct: number | null, snapshotError: string | null | undefined): 'ok' | 'warn' | 'err' {
  if (snapshotError) return 'err';
  if (pct == null) return 'ok';     // no data yet → don't warn
  if (pct < 30) return 'warn';
  return 'ok';
}

function Inner() {
  const { t } = useLocale();
  const { auth, snapshot, signIn, signOut } = useCodexData();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<Settings | null>(null);

  async function handleRefresh() {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setSettingsOpen(false);
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
  const updatedAt = snapshot?.fetched_at;

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>

        {isAuthed && (
          <>
            <span className="header-spacer" />
            {(auth?.email || snapshot?.email) && (
              <div className="header-account">
                <span className="header-email" title={auth?.email || snapshot?.email}>
                  {auth?.email || snapshot?.email}
                </span>
                {snapshot?.plan && <span className="header-plan">{snapshot.plan}</span>}
              </div>
            )}
            <button
              className="icon-btn"
              onClick={handleRefresh}
              disabled={busy}
              title={t('app.refresh.tooltip')}
            >
              {busy ? '⟳' : '↻'}
            </button>
          </>
        )}

        {!isAuthed && <span className="header-spacer" />}

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
          title={t('app.settings.tooltip')}
        >
          ⚙
        </button>
      </header>

      {isAuthed ? (
        <main className="app-main">
          {snapshot?.session_window_available && (
            <span
              className={`status-pill ${statusClass(snapshot.session_pct_left, snapshot.error)}`}
            >
              {snapshot.session_pct_left != null && snapshot.session_pct_left < 30
                ? t('status.sessionLow')
                : t('status.ok')}
            </span>
          )}
          <Cards />
        </main>
      ) : (
        <main className="app-main">
          <LoginPrompt onImported={() => void signIn()} />
        </main>
      )}

      <footer className="app-footer">
        <span>
          {isAuthed && updatedAt
            ? `${t('app.footer.updated')} ${formatTime(updatedAt)}`
            : t('app.footer.never')}
        </span>
        <span>{t('app.version')}</span>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSignOut={handleSignOut}
        onQuit={handleQuit}
        currentSettings={currentSettings}
        onSettingsChanged={handleSettingsChanged}
      />
    </div>
  );
}

export default function App() {
  const [initialLocale, setInitialLocale] = useState<Language | null>(null);

  // Pull the persisted locale once, before first render of Inner.
  // Until then we render nothing (avoid a flash of English UI for German users).
  useEffect(() => {
    let cancelled = false;
    void window.codexAPI.getSettings().then((s) => {
      if (!cancelled) setInitialLocale(s.language ?? 'en');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (initialLocale == null) {
    // Minimal shell so the first paint doesn't blink from no-root → full UI.
    return <div className="app" />;
  }

  return (
    <LocaleProvider initial={initialLocale}>
      <Inner />
    </LocaleProvider>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}