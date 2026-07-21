/**
 * Tiny i18n: two dictionary tables, React context, lookup helper.
 * No interpolation yet (rarely needed), no plural rules. Easy to extend.
 *
 * Usage:
 *   const { t, locale, setLocale } = useLocale();
 *   <h1>{t('app.title')}</h1>
 */
import { createContext, useContext, useMemo, useState, useCallback, ReactNode } from 'react';
import type { Language } from '../shared/types.js';

type Dict = Record<string, string>;

const en: Dict = {
  // App / header
  'app.title': 'CodexTracker',
  'app.refresh.tooltip': 'Refresh now',
  'app.settings.tooltip': 'Settings',
  'app.stats.tooltip': 'Open statistics window',
  'app.footer.updated': 'Updated',
  'app.footer.never': 'Not signed in',
  'app.footer.neverLowercase': 'never',
  'app.version': 'v2.1.0',

  // Account / status
  'account.notSignedIn': 'Not signed in',
  'status.ok': 'OK',
  'status.sessionLow': 'Session low',

  // Login prompt
  'login.heading': 'Sign in',
  'login.body': 'CodexTracker reads your tokens from the Codex CLI. Run `codex` in your terminal once to sign in, then click the button below.',
  'login.importButton': 'Import from Codex CLI',
  'login.importing': 'Importing…',
  'login.failed': 'Import failed.',
  'login.tokenStorage': 'The refresh token is stored in Windows Credential Manager. Access tokens stay in memory only.',

  // Sections
  'section.session': 'Session',
  'section.weekly': 'Weekly',
  'section.forecast': 'Reset Forecast',
  'section.resetCredits': 'Limit-Reset Credits',
  'section.credits': 'Credits',

  // Meta labels
  'meta.left': 'Left',
  'meta.used': 'Used',
  'meta.reset': 'Reset',
  'meta.nextExpiry': 'Next expiry',
  'meta.plan': 'Plan',
  'meta.balance': 'Balance',
  'meta.available': 'Available',
  'meta.forecastScore': 'Score',
  'meta.forecastSince': 'Since reset',
  'meta.forecastChanges': 'Recent changes',
  'meta.forecastHorizon': 'Next 48 hours',
  'meta.forecastAnnounced': 'Reset announced',
  'meta.forecastUnavailable': 'Forecast unavailable',

  // Settings dialog
  'settings.title': 'Settings',
  'settings.section.refresh': 'Refresh',
  'settings.intervalLabel': 'Interval (seconds)',
  'settings.section.forecast': 'Forecast',
  'settings.forecastInterval': 'Refresh interval (minutes)',
  'settings.section.notifications': 'Notifications',
  'settings.notificationsEnabled': 'Enabled',
  'settings.section.language': 'Language',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
  'settings.addRule': '+ Add rule',
  'settings.signOut': 'Sign out',
  'settings.close': 'Close',
  'settings.quit': 'Quit',
  'settings.saving': 'Saving…',
  'settings.ruleCard.session': 'Session',
  'settings.ruleCard.weekly': 'Weekly',
  'settings.ruleCard.credits': 'Credits',
  'settings.ruleCard.resets': 'Resets',
  'settings.ruleCard.forecast': 'Forecast',

  // Hints
  'hint.available': '{n} available',
  'hint.tokens': '{n} Tokens',
  'hint.expiresAt': 'expires {when}',

  // Credits list
  'credits.redeem': 'Redeem',

  // Time / dates
  'time.expired': 'expired',
  'time.expired.de': 'abgelaufen',
  'time.dash': '—',
  'time.daysHours': '{d}d {h}h',
  'time.hoursMinutes': '{h}h {m}m',
  'time.minutes': '{m}m',
  'time.daysHoursDe': '{d} T. {h} Std.',
  'time.hoursMinutesDe': '{h} Std. {m} Min.',
  'time.minutesDe': '{m} Min.',

  // Errors
  'error.banner': 'Error',

  // LoginPrompt + footer variants
  'footer.updatedAt': 'Updated {time}',
};

const de: Dict = {
  'app.title': 'CodexTracker',
  'app.refresh.tooltip': 'Jetzt aktualisieren',
  'app.settings.tooltip': 'Einstellungen',
  'app.stats.tooltip': 'Statistik-Fenster öffnen',
  'app.footer.updated': 'Aktualisiert',
  'app.footer.never': 'Nicht angemeldet',
  'app.footer.neverLowercase': 'nie',
  'app.version': 'v2.1.0',

  'account.notSignedIn': 'Nicht angemeldet',
  'status.ok': 'OK',
  'status.sessionLow': 'Sitzung niedrig',

  'login.heading': 'Anmelden',
  'login.body': 'CodexTracker liest deine Tokens aus der Codex-CLI. Starte `codex` einmal im Terminal, um dich anzumelden, und klicke dann auf die Schaltfläche unten.',
  'login.importButton': 'Aus Codex CLI importieren',
  'login.importing': 'Importiere…',
  'login.failed': 'Import fehlgeschlagen.',
  'login.tokenStorage': 'Der Refresh-Token liegt im Windows-Anmeldeinformationsmanager. Access-Tokens bleiben nur im Arbeitsspeicher.',

  'section.session': 'Sitzung',
  'section.weekly': 'Wöchentlich',
  'section.forecast': 'Reset-Prognose',
  'section.resetCredits': 'Limit-Reset-Credits',
  'section.credits': 'Credits',

  'meta.left': 'Übrig',
  'meta.used': 'Verbraucht',
  'meta.reset': 'Reset',
  'meta.nextExpiry': 'Nächster Ablauf',
  'meta.plan': 'Plan',
  'meta.balance': 'Kontostand',
  'meta.available': 'Verfügbar',
  'meta.forecastScore': 'Score',
  'meta.forecastSince': 'Seit Reset',
  'meta.forecastChanges': 'Letzte Änderungen',
  'meta.forecastHorizon': 'Nächste 48 Stunden',
  'meta.forecastAnnounced': 'Reset angekündigt',
  'meta.forecastUnavailable': 'Prognose nicht verfügbar',

  'hint.available': '{n} verfügbar',
  'hint.tokens': '{n} Tokens',
  'hint.expiresAt': 'läuft ab {when}',

  'credits.redeem': 'Einlösen',

  'time.expired': 'abgelaufen',
  'time.expired.de': 'abgelaufen',
  'time.dash': '—',
  'time.daysHours': '{d} T. {h} Std.',
  'time.hoursMinutes': '{h} Std. {m} Min.',
  'time.minutes': '{m} Min.',
  'time.daysHoursDe': '{d} T. {h} Std.',
  'time.hoursMinutesDe': '{h} Std. {m} Min.',
  'time.minutesDe': '{m} Min.',

  'settings.title': 'Einstellungen',
  'settings.section.refresh': 'Aktualisierung',
  'settings.intervalLabel': 'Intervall (Sekunden)',
  'settings.section.forecast': 'Prognose',
  'settings.forecastInterval': 'Aktualisierungsintervall (Minuten)',
  'settings.section.notifications': 'Benachrichtigungen',
  'settings.notificationsEnabled': 'Aktiviert',
  'settings.section.language': 'Sprache',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
  'settings.addRule': '+ Regel hinzufügen',
  'settings.signOut': 'Abmelden',
  'settings.close': 'Schließen',
  'settings.quit': 'Beenden',
  'settings.saving': 'Speichere…',
  'settings.ruleCard.session': 'Sitzung',
  'settings.ruleCard.weekly': 'Wöchentlich',
  'settings.ruleCard.credits': 'Credits',
  'settings.ruleCard.resets': 'Resets',
  'settings.ruleCard.forecast': 'Prognose',

  'error.banner': 'Fehler',

  'footer.updatedAt': 'Aktualisiert {time}',
};

const DICTS: Record<Language, Dict> = { en, de };

export type TranslationParams = Record<string, string | number>;

export interface LocaleApi {
  locale: Language;
  setLocale: (lang: Language) => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
}

const LocaleContext = createContext<LocaleApi | null>(null);

export function LocaleProvider({
  initial,
  onChange,
  children,
}: {
  initial: Language;
  onChange?: (lang: Language) => Promise<void>;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Language>(initial);

  const setLocale = useCallback(
    async (lang: Language) => {
      setLocaleState(lang);
      if (onChange) await onChange(lang);
    },
    [onChange],
  );

  const api = useMemo<LocaleApi>(() => {
    const dict = DICTS[locale];
    return {
      locale,
      setLocale,
      t: (key: string, params?: TranslationParams) => {
        let s = dict[key] ?? en[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            s = s.split(`{${k}}`).join(String(v));
          }
        }
        return s;
      },
    };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={api}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleApi {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Fallback: render-time error swallowed, returns English placeholder.
    // Better than crashing the whole app if Provider is forgotten.
    return {
      locale: 'en',
      setLocale: async () => {},
      t: (key: string) => en[key] ?? key,
    };
  }
  return ctx;
}

/** Localized relative-time formatter, plugged into the i18n system. */
export function makeRelativeFormatter(locale: Language) {
  const dict = DICTS[locale];
  return (ms: number): string => {
    if (ms <= 0) return dict['time.expired'] ?? 'expired';
    const secs = Math.floor(ms / 1000);
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    if (days > 0) {
      const tpl = dict[`time.daysHours${locale === 'de' ? 'De' : ''}`];
      return (tpl ?? `${days}d ${hours}h`).replace('{d}', String(days)).replace('{h}', String(hours));
    }
    if (hours > 0) {
      const tpl = dict[`time.hoursMinutes${locale === 'de' ? 'De' : ''}`];
      return (tpl ?? `${hours}h ${minutes}m`).replace('{h}', String(hours)).replace('{m}', String(minutes));
    }
    const tpl = dict[`time.minutes${locale === 'de' ? 'De' : ''}`];
    return (tpl ?? `${minutes}m`).replace('{m}', String(minutes));
  };
}
