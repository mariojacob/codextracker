import { useState } from 'react';
import type { Settings } from '../../shared/types.js';
import { PROVIDERS, defaultProviderSettings, type ProviderError, type ProviderId, type ProviderSettings as Configuration } from '../../shared/providers.js';
import type { ProviderControls } from '../hooks/useProviders.js';
import { useLocale } from '../i18n.js';
import { LoginPrompt } from './LoginPrompt.js';

export function ProviderSettings({ settings, save, controls, codexAuthenticated, onCodexRefresh, onSignOut }: {
  settings: Settings; save: (next: Settings) => Promise<void>; controls: ProviderControls;
  codexAuthenticated: boolean; onCodexRefresh: () => Promise<void>; onSignOut: () => Promise<void>;
}) {
  const { t, locale } = useLocale();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [teams, setTeams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ProviderError | 'settings' | null>>({});
  async function configure(id: ProviderId, patch: Partial<Configuration>) {
    const current = settings.providers.find((provider) => provider.id === id) ?? defaultProviderSettings(id);
    const providers = [...settings.providers.filter((provider) => provider.id !== id), { ...current, ...patch }];
    setBusy(id); setErrors((all) => ({ ...all, [id]: null }));
    try { await save({ ...settings, providers }); await controls.reloadConnections(); }
    catch { setErrors((all) => ({ ...all, [id]: 'settings' })); }
    finally { setBusy(null); }
  }
  async function credentialAction(id: ProviderId, key: string, action: 'save' | 'import' | 'remove') {
    setBusy(id); setErrors((all) => ({ ...all, [id]: null }));
    try {
      const result = action === 'save' ? await controls.saveCredential(id, drafts[key] ?? '')
        : action === 'import' ? await controls.importCredential(id) : await controls.removeCredential(id);
      if (result.ok) setDrafts((all) => ({ ...all, [key]: '' }));
      else setErrors((all) => ({ ...all, [id]: result.error }));
    } finally { setBusy(null); }
  }
  return <div className="modal-section provider-settings">
    <h4>{t('providers.title')}</h4>
    <p className="provider-note">{t('providers.settingsNote')}</p>
    {(['subscription', 'api'] as const).map((category) => <div key={category}>
      <h5>{t(`providers.category.${category}`)}</h5>
      {category === 'subscription' && <div className="provider-setting-card">
        <label className="provider-toggle"><input type="checkbox" checked={settings.codex_enabled} disabled={busy != null}
          onChange={(event) => {
            setBusy('codex');
            void save({ ...settings, codex_enabled: event.target.checked }).catch(() => {}).finally(() => setBusy(null));
          }} /><strong>ChatGPT / Codex</strong></label>
        {settings.codex_enabled && <>
          <p className="provider-note">{t('providers.codexHelp')}</p>
          {errors.codex && <p className="provider-error" role="status">{t(`providers.error.${errors.codex}`)}</p>}
          {codexAuthenticated ? <div className="provider-setting-actions">
            <button className="btn-tiny" disabled={busy != null} onClick={() => {
              setBusy('codex'); setErrors((all) => ({ ...all, codex: null }));
              void onCodexRefresh().catch(() => setErrors((all) => ({ ...all, codex: 'network' }))).finally(() => setBusy(null));
            }}>{t('providers.check')}</button>
            <button className="btn-tiny" disabled={busy != null} onClick={() => {
              setBusy('codex'); setErrors((all) => ({ ...all, codex: null }));
              void onSignOut().catch(() => setErrors((all) => ({ ...all, codex: 'keyring' }))).finally(() => setBusy(null));
            }}>{t('settings.signOut')}</button>
          </div> : <LoginPrompt onImported={() => void onCodexRefresh()} />}
        </>}
      </div>}
      {PROVIDERS.filter((provider) => provider.category === category).map((definition) => {
        const config = settings.providers.find((provider) => provider.id === definition.id) ?? defaultProviderSettings(definition.id);
        const id = definition.id, key = `${id}-${config.region}`;
        const connected = controls.connections.find((connection) => connection.id === id && connection.region === config.region)?.configured;
        const snapshot = controls.snapshots.find((provider) => provider.id === id && provider.region === config.region);
        return <div className="provider-setting-card" key={id}>
          <label className="provider-toggle"><input type="checkbox" checked={config.enabled} disabled={busy != null}
            onChange={(event) => void configure(id, { enabled: event.target.checked })} /><strong>{definition.name}</strong></label>
          {config.enabled && <>
            {busy === id && <p className="provider-note" role="status">{t('providers.working')}</p>}
            <p className="provider-note">{definition.help[locale]}</p>
            {definition.regions && <label className="provider-field">{t('providers.region')}<select value={config.region} disabled={busy != null}
              onChange={(event) => void configure(id, { region: event.target.value as Configuration['region'] })}>
              <option value="global">{t('providers.global')}</option><option value="china">{t('providers.china')}</option>
            </select></label>}
            {id === 'xai' && <div className="provider-team-row"><label className="provider-field">{t('providers.teamId')}<input
              value={teams[id] ?? config.team_id} autoComplete="off" maxLength={128} disabled={busy != null}
              onChange={(event) => setTeams((all) => ({ ...all, [id]: event.target.value }))} /></label>
              <button className="btn-tiny" disabled={busy != null || !/^[a-zA-Z0-9_-]{1,128}$/.test(teams[id] ?? config.team_id)} onClick={() => void configure(id, { team_id: teams[id] ?? config.team_id })}>{t('providers.saveTeam')}</button></div>}
            {definition.auth !== 'local' && <>
              <label className="provider-field">{t(`providers.auth.${definition.auth}`)}<input type="password" autoComplete="off" spellCheck={false}
                value={drafts[key] ?? ''} maxLength={16384} disabled={busy != null} placeholder={connected ? t('providers.replaceSecret') : t('providers.enterSecret')}
                onChange={(event) => setDrafts((all) => ({ ...all, [key]: event.target.value }))} /></label>
              <div className="provider-setting-actions">
                <button className="btn-tiny" disabled={busy != null || !drafts[key]?.trim()} onClick={() => void credentialAction(id, key, 'save')}>{t('providers.saveCredential')}</button>
                {definition.localImport && <button className="btn-tiny" disabled={busy != null} onClick={() => void credentialAction(id, key, 'import')}>{t('providers.import')}</button>}
                {connected && <button className="btn-tiny" disabled={busy != null} onClick={() => void credentialAction(id, key, 'remove')}>{t('providers.removeCredential')}</button>}
              </div>
              <p className="provider-note">{connected ? t('providers.credentialStored') : t('providers.notConnected')}</p>
            </>}
            {(errors[id] || snapshot?.error) && <p className="provider-error" role="status">{t(`providers.error.${errors[id] ?? snapshot?.error}`)}</p>}
            {snapshot?.state === 'ready' && <p className="provider-connected">{t('providers.connected')}</p>}
            <div className="provider-setting-actions">
              <button className="btn-tiny" disabled={busy != null} onClick={() => { setBusy(id); void controls.refresh(id).finally(() => setBusy(null)); }}>{t('providers.check')}</button>
              <button className="btn-tiny" onClick={() => void window.codexAPI.openProviderDashboard(id)}>{t('providers.dashboard')}</button>
            </div>
          </>}
        </div>;
      })}
    </div>)}
    <p className="provider-note">{t('providers.statisticsNote')}</p>
  </div>;
}
