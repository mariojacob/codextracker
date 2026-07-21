/**
 * Settings dialog: refresh interval, notification rules, language switcher.
 * Language changes propagate up via onSettingsChanged so the LocaleProvider
 * in App.tsx re-renders the rest of the UI immediately.
 */
import { useEffect, useState } from 'react';
import type { Settings, NotificationRule, Language } from '../../shared/types.js';
import { useLocale } from '../i18n.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onQuit: () => void;
  /** Provided by parent so we can echo current settings back up after a change. */
  currentSettings?: Settings | null;
  onSettingsChanged?: (next: Settings) => void;
}

export function SettingsDialog({
  open,
  onClose,
  onSignOut,
  onQuit,
  currentSettings,
  onSettingsChanged,
}: Props) {
  const { t, locale, setLocale } = useLocale();
  const [settings, setSettings] = useState<Settings | null>(currentSettings ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Prefer parent-supplied (already current), else re-fetch.
    if (currentSettings) {
      setSettings(currentSettings);
    } else {
      void window.codexAPI.getSettings().then(setSettings);
    }
  }, [open, currentSettings]);

  if (!open || !settings) return null;

  async function save(newSettings: Settings) {
    setSaving(true);
    try {
      await window.codexAPI.setSettings(newSettings);
      setSettings(newSettings);
      onSettingsChanged?.(newSettings);
    } finally {
      setSaving(false);
    }
  }

  function updateRule(idx: number, patch: Partial<NotificationRule>) {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      notifications: {
        ...settings.notifications,
        rules: settings.notifications.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      },
    };
    setSettings(next);
    void save(next);
  }

  function addRule() {
    if (!settings) return;
    const id = `rule-${Date.now()}`;
    const next: Settings = {
      ...settings,
      notifications: {
        ...settings.notifications,
        rules: [
          ...settings.notifications.rules,
          { id, card: 'session', field: 'pct_left', threshold: 10, enabled: true },
        ],
      },
    };
    setSettings(next);
    void save(next);
  }

  function removeRule(idx: number) {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      notifications: {
        ...settings.notifications,
        rules: settings.notifications.rules.filter((_, i) => i !== idx),
      },
    };
    setSettings(next);
    void save(next);
  }

  function setRefreshSeconds(n: number) {
    if (!settings) return;
    const next = { ...settings, refresh_seconds: Math.max(10, Math.min(3600, n)) };
    setSettings(next);
    void save(next);
  }

  function setForecastMinutes(n: number) {
    if (!settings) return;
    const next = { ...settings, forecast_minutes: Math.max(5, Math.min(120, n)) };
    setSettings(next);
    void save(next);
  }

  function setNotifEnabled(enabled: boolean) {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      notifications: { ...settings.notifications, enabled },
    };
    setSettings(next);
    void save(next);
  }

  function setLanguage(lang: Language) {
    if (!settings) return;
    const next = { ...settings, language: lang };
    setSettings(next);
    void save(next);
    void setLocale(lang); // optimistic: re-render immediately, disk-write runs in parallel
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings.title')}</h3>

        <div className="modal-section">
          <h4>{t('settings.section.refresh')}</h4>
          <div className="modal-row">
            <label>{t('settings.intervalLabel')}</label>
            <input
              type="number"
              min={10}
              max={3600}
              step={10}
              value={settings.refresh_seconds}
              onChange={(e) => setRefreshSeconds(parseInt(e.target.value, 10) || 60)}
            />
          </div>
        </div>

        <div className="modal-section">
          <h4>{t('settings.section.forecast')}</h4>
          <div className="modal-row">
            <label>{t('settings.forecastInterval')}</label>
            <input
              type="number"
              min={5}
              max={120}
              step={5}
              value={settings.forecast_minutes}
              onChange={(e) => setForecastMinutes(parseInt(e.target.value, 10) || 20)}
            />
          </div>
        </div>

        <div className="modal-section">
          <h4>{t('settings.section.language')}</h4>
          <div className="modal-row">
            <label>{t('settings.section.language')}</label>
            <select
              value={settings.language ?? locale}
              onChange={(e) => setLanguage(e.target.value as Language)}
              style={{ width: 120 }}
            >
              <option value="en">{t('settings.language.en')}</option>
              <option value="de">{t('settings.language.de')}</option>
            </select>
          </div>
        </div>

        <div className="modal-section">
          <h4>{t('settings.section.notifications')}</h4>
          <div className="modal-row">
            <label>{t('settings.notificationsEnabled')}</label>
            <input
              type="checkbox"
              checked={settings.notifications.enabled}
              onChange={(e) => setNotifEnabled(e.target.checked)}
            />
          </div>

          {settings.notifications.rules.map((rule, idx) => (
            <div key={rule.id} className="modal-row">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => updateRule(idx, { enabled: e.target.checked })}
              />
              <select
                value={rule.card}
                onChange={(e) => updateRule(idx, { card: e.target.value as NotificationRule['card'] })}
                style={{ width: 80 }}
              >
                <option value="session">{t('settings.ruleCard.session')}</option>
                <option value="weekly">{t('settings.ruleCard.weekly')}</option>
                <option value="credits">{t('settings.ruleCard.credits')}</option>
                <option value="resets">{t('settings.ruleCard.resets')}</option>
                <option value="forecast">{t('settings.ruleCard.forecast')}</option>
              </select>
              <span style={{ color: 'var(--text-muted)' }}>&lt;</span>
              <input
                type="number"
                min={0}
                max={100}
                value={rule.threshold}
                onChange={(e) => updateRule(idx, { threshold: parseInt(e.target.value, 10) || 0 })}
                style={{ width: 60 }}
              />
              <span style={{ color: 'var(--text-muted)' }}>%</span>
              <button className="btn-tiny" onClick={() => removeRule(idx)} style={{ marginLeft: 'auto' }}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={addRule} style={{ width: 'auto', marginTop: 4 }}>
            {t('settings.addRule')}
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onSignOut} style={{ width: 'auto' }}>
            {t('settings.signOut')}
          </button>
          <button className="btn btn-secondary" onClick={onClose} style={{ width: 'auto' }}>
            {t('settings.close')}
          </button>
          <button className="btn btn-danger" onClick={onQuit} style={{ width: 'auto' }}>
            {t('settings.quit')}
          </button>
        </div>

        {saving && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
            {t('settings.saving')}
          </div>
        )}
      </div>
    </div>
  );
}