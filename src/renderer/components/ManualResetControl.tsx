import { useId, useState } from 'react';
import { createManualReset, manualResetWindow, type ManualReset, type ResetWindow } from '../../shared/manual-reset.js';
import { useLocale } from '../i18n.js';
import { useNow } from '../hooks/useNow.js';

export type SaveManualReset = (value: ManualReset | undefined, bankedBudget?: boolean) => Promise<void>;

function localDate(timestamp: number) {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ManualResetControl({ windows, value, onSave, disabled, bankedReset }: {
  windows: ResetWindow[]; value?: ManualReset; onSave: SaveManualReset; disabled: boolean;
  bankedReset?: { selected: boolean; resetAt: number | null };
}) {
  const { t, locale } = useLocale();
  const now = useNow();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [enableOnSave, setEnableOnSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = !!value && value.reset_at <= now;
  const missing = !!value && !windows.some((window) => window.id === value.window_id);
  async function save(next: ManualReset | undefined, bankedBudget = false) {
    setError(null);
    try { await onSave(next, bankedBudget); setEditing(false); }
    catch { setError(t('providers.error.settings')); }
  }
  if (!windows.length && !value) return null;
  return <div className="manual-reset-control">
    <div className="manual-reset-toolbar">
      <label htmlFor={`${id}-mode`}>{t('manual.display')}</label>
      <select id={`${id}-mode`} value={bankedReset?.selected ? 'banked' : value?.enabled && !expired && !missing ? 'manual' : 'auto'} disabled={disabled}
        onChange={(event) => {
          if (event.target.value === 'banked') { void save(value, true); return; }
          if (event.target.value === 'manual' && (!value || expired || missing)) { setEnableOnSave(true); setEditing(true); return; }
          void save(value ? { ...value, enabled: event.target.value === 'manual' } : undefined);
        }}>
        <option value="auto">{t('manual.auto')}</option>
        <option value="manual">{t('manual.title')}</option>
        {bankedReset && <option value="banked">{t('banked.title')}</option>}
      </select>
      <button type="button" className="btn-tiny" disabled={disabled} onClick={() => { setEditing(!editing); setEnableOnSave(false); setError(null); }}>
        {t(value ? 'manual.edit' : 'manual.add')}
      </button>
    </div>
    {bankedReset?.selected && <p className="provider-note">
      {bankedReset.resetAt == null ? t('banked.missing') : `${t('banked.deadline')}: ${new Date(bankedReset.resetAt).toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}`}
    </p>}
    {value && !bankedReset?.selected && <p className={`provider-note${expired || missing ? ' provider-error' : ''}`}>
      <span className="legend-manual" />{t('manual.title')}: {new Date(value.reset_at).toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}
      {expired && ` · ${t('manual.expired')}`}{missing && ` · ${t('manual.missing')}`}
    </p>}
    {editing && <form className="manual-reset-editor" onSubmit={(event) => {
      event.preventDefault();
      const resetAt = new Date(String(new FormData(event.currentTarget).get('reset_at') ?? '')).getTime();
      const window = manualResetWindow(windows, value);
      if (!window || !Number.isFinite(resetAt) || resetAt <= Date.now()) { setError(t('manual.invalid')); return; }
      const next = createManualReset(window, resetAt, value);
      void save({ ...next, enabled: enableOnSave || next.enabled }, bankedReset?.selected && !enableOnSave);
    }}>
      <p className="manual-reset-once">{t('manual.once')}</p>
      <label className="provider-field">{t('manual.date')}
        <input type="datetime-local" name="reset_at" required defaultValue={value ? localDate(value.reset_at) : ''} disabled={disabled} />
      </label>
      <p className="provider-note">{t('manual.help')}</p>
      <div className="provider-setting-actions">
        <button type="submit" className="btn-tiny" disabled={disabled}>{t('manual.save')}</button>
        <button type="button" className="btn-tiny" disabled={disabled} onClick={() => { setEditing(false); setError(null); }}>{t('manual.cancel')}</button>
        {value && <button type="button" className="btn-tiny" disabled={disabled} onClick={() => void save(undefined, bankedReset?.selected)}>{t('manual.remove')}</button>}
      </div>
    </form>}
    {error && <p className="provider-error" role="alert">{error}</p>}
  </div>;
}
