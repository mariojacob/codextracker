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
  'manual.day': 'Budget day {day}',
  'manual.display': 'Display',
  'manual.auto': 'Automatic',
  'manual.title': 'Manual reset',
  'manual.edit': 'Edit reset',
  'manual.add': 'Set reset',
  'manual.once': 'One-time reset · no repetition',
  'manual.date': 'Date and time (local time)',
  'manual.save': 'Save',
  'manual.cancel': 'Cancel',
  'manual.remove': 'Remove reset',
  'manual.expired': 'Expired · automatic display',
  'manual.missing': 'Quota unavailable · automatic display',
  'manual.invalid': 'Enter a future date and time. Usage data must be available for this module.',
  'manual.help': 'This date applies once. The module’s main quota is selected automatically. Choose Manual reset to align your budget with this deadline. No reset is triggered automatically.',
  'manual.budgetNote': 'Unused allowance carries over until the manual planning deadline.',

  'modules.drag': 'Drag to move {name}',
  'modules.up': 'Move {name} up',
  'modules.down': 'Move {name} down',
  'providers.warning.balance_unavailable': 'The provider reports this balance as unavailable for API calls.',
  'providers.warning.monthly_exhausted': 'Monthly pool exhausted. Shorter-window allowance cannot be used until this limit resets.',
  "providers.title": "Providers & modules",
  'providers.codexHelp': 'Reads your ChatGPT/Codex subscription limits via the Codex CLI login. Disabling pauses requests and notifications, while keeping the saved login and history.',
  'providers.codexNotifications': 'These rules apply to the ChatGPT / Codex module. They pause while that module is disabled.',
  'providers.empty': 'No modules enabled. Choose the providers you want to monitor in Settings.',
  'providers.noReadings': 'No readings yet',
  "providers.settingsNote": "Enable providers individually. Keys and session credentials are stored in Windows Credential Manager. Disabling stops polling; remove a credential separately to delete it.",
  "providers.category.subscription": "Subscriptions & Coding Plans",
  "providers.category.api": "API balances & spend",
  "providers.region": "Service region",
  "providers.global": "Global / International",
  "providers.china": "China mainland",
  "providers.teamId": "xAI team ID",
  "providers.saveTeam": "Save team ID",
  "providers.auth.token": "Access token / plan API key",
  "providers.auth.cookie": "WorkosCursorSessionToken cookie",
  "providers.auth.management": "Management API key",
  "providers.auth.admin": "Organization Admin API key",
  "providers.saveCredential": "Save credential",
  "providers.replaceSecret": "Stored · enter replacement",
  "providers.enterSecret": "Enter credential",
  "providers.import": "Import CLI login",
  "providers.removeCredential": "Remove credential",
  "providers.credentialStored": "Credential stored securely. This does not itself verify access.",
  "providers.notConnected": "No credential stored for this region.",
  "providers.connected": "Usage retrieved successfully.",
  "providers.check": "Refresh this provider",
  "providers.dashboard": "Open dashboard",
  "providers.working": "Working…",
  "providers.loading": "Loading usage…",
  "providers.loadError": "Provider data could not be loaded.",
  "providers.error.needs_auth": "Sign-in or credentials required. Check the credential type and selected region.",
  "providers.error.expired": "The imported login expired. Renew the CLI login and import it again.",
  "providers.error.local_unavailable": "Antigravity could not be reached locally. Open the app/IDE or sign in to agy and ensure it is on PATH.",
  "providers.error.network": "Network request failed. Retry when the connection is available.",
  "providers.error.rate_limited": "The provider limited usage requests. Automatic retries will wait before trying again.",
  "providers.error.unsupported_response": "No supported usage data returned. Check the dashboard; this account or response format may not be supported.",
  "providers.error.keyring": "The credential could not be read or saved in Windows Credential Manager.",
  "providers.error.settings": "Settings could not be saved. Please retry.",
  "providers.stale": "Showing the last successful reading; it may be outdated.",
  "providers.points": "points",
  "providers.amount.balance": "Available balance",
  "providers.amount.posted_balance": "Posted prepaid balance",
  "providers.amount.spend": "Reported API spend",
  "providers.amount.included_spend": "Included plan usage",
  "providers.amount.on_demand_spend": "Paid extra usage",
  "providers.amount.points": "Plan points balance",
  "providers.period.current_cycle": "Current billing cycle",
  "providers.period.last_30_days": "Last 30 days",
  "providers.window.weekly": "Weekly",
  "providers.window.5h": "5-hour",
  "providers.window.daily": "Daily",
  "providers.window.monthly": "Monthly",
  "providers.window.quota": "Quota",
  "providers.window.included": "Included allowance",
  "providers.partial": "Incomplete",
  "providers.postedNote": "Posted ledger balance; current-cycle spend may not yet be deducted.",
  "providers.statisticsNote": "Statistics are stored separately per module and region. Quotas, balances and reported costs are never combined.",
  'quota.usage': '{used} % used · {left} % left',
  'budget.day': 'Budget day {day}/7',
  'budget.target': 'Daily target: {pct} %',
  'budget.marker': 'Even pace now: {pct} %. Usage to the right is above the time-based plan.',
  'budget.available': 'Until {when}: {n} percentage points in budget',
  'budget.over': '{n} percentage points over the daily budget',
  'budget.unavailable': 'Daily budget unavailable without a valid weekly reset.',
  'budget.note': 'Unused budget carries over until the weekly reset.',
  'credits.unknownExpiry': 'Expiry unknown',
  'credits.expiryMarker': '{name} expires: {when}',
  'credits.expiryLegend': 'Banked reset expires · hover over a marker for the time',
  'credits.soon': 'Expires soon',
  'credits.urgent': 'Expires within 24h',

  // App / header
  'app.title': 'CodexTracker',
  'app.refresh.tooltip': 'Refresh now',
  'app.settings.tooltip': 'Settings',
  'app.stats.tooltip': 'Open statistics',
  'app.footer.updated': 'Updated',
  'app.footer.never': 'Not signed in',
  'app.footer.neverLowercase': 'never',
  'app.version': 'v2.4.3',

  // Account / status
  'account.notSignedIn': 'Not signed in',
  'status.ok': 'OK',
  'status.sessionLow': 'Session low',

  // Login prompt
  'login.heading': 'Sign in to Codex',
  'login.body': 'CodexTracker reads your tokens from the Codex CLI. Run `codex` in your terminal once to sign in, then click the button below.',
  'login.importButton': 'Import from Codex CLI',
  'login.importing': 'Importing…',
  'login.failed': 'Import failed.',
  'login.tokenStorage': 'The refresh token is stored in Windows Credential Manager. Access tokens stay in memory only.',

  // Sections
  'section.session': 'Session',
  'section.weekly': 'Weekly',
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

  // Settings dialog
  'settings.title': 'Settings',
  'settings.section.refresh': 'Refresh',
  'settings.intervalLabel': 'Interval (seconds)',
  'settings.section.notifications': 'Notifications',
  'settings.notificationsEnabled': 'Enabled',
  'settings.section.language': 'Language',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
  'settings.addRule': '+ Add rule',
  'settings.signOut': 'Sign out of Codex',
  'settings.close': 'Close',
  'settings.quit': 'Quit',
  'settings.saving': 'Saving…',
  'settings.ruleCard.session': 'Session',
  'settings.ruleCard.weekly': 'Weekly',
  'settings.ruleCard.credits': 'Credits',
  'settings.ruleCard.resets': 'Resets',

  // Hints
  'hint.available': '{n} available',
  'hint.creditBalance': '{n} Credits',
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
  'manual.day': 'Budgettag {day}',
  'manual.display': 'Anzeige',
  'manual.auto': 'Automatisch',
  'manual.title': 'Manueller Reset',
  'manual.edit': 'Reset bearbeiten',
  'manual.add': 'Reset eintragen',
  'manual.once': 'Einmaliger Reset · keine Wiederholung',
  'manual.date': 'Datum und Uhrzeit (Ortszeit)',
  'manual.save': 'Speichern',
  'manual.cancel': 'Abbrechen',
  'manual.remove': 'Reset entfernen',
  'manual.expired': 'Abgelaufen · automatische Anzeige',
  'manual.missing': 'Limit nicht verfügbar · automatische Anzeige',
  'manual.invalid': 'Bitte Datum und Uhrzeit in der Zukunft eintragen. Für dieses Modul müssen Verbrauchsdaten verfügbar sein.',
  'manual.help': 'Dieser Termin gilt einmalig. Das Hauptkontingent des Moduls wird automatisch gewählt. Mit Manueller Reset richtet sich dein Budget nach diesem Termin. Ein Reset wird nicht automatisch ausgelöst.',
  'manual.budgetNote': 'Ungenutztes Budget bleibt bis zum manuell geplanten Reset erhalten.',

  'modules.drag': '{name} durch Ziehen verschieben',
  'modules.up': '{name} nach oben verschieben',
  'modules.down': '{name} nach unten verschieben',
  'providers.warning.balance_unavailable': 'Der Anbieter meldet dieses Guthaben als nicht für API-Aufrufe verfügbar.',
  'providers.warning.monthly_exhausted': 'Monatskontingent ausgeschöpft. Kürzere Kontingente sind bis zu dessen Reset nicht nutzbar.',
  "providers.title": "Anbieter & Module",
  'providers.codexHelp': 'Liest deine ChatGPT-/Codex-Abolimits über die Codex-CLI-Anmeldung. Deaktivieren pausiert Abrufe und Benachrichtigungen; gespeicherte Anmeldung und Historie bleiben erhalten.',
  'providers.codexNotifications': 'Diese Regeln gelten für das Modul ChatGPT / Codex. Bei deaktiviertem Modul pausieren sie.',
  'providers.empty': 'Keine Module aktiviert. Wähle in den Einstellungen die Anbieter aus, die du überwachen möchtest.',
  'providers.noReadings': 'Noch keine Messwerte',
  "providers.settingsNote": "Anbieter einzeln aktivieren. Schlüssel und Sitzungszugänge liegen im Windows-Anmeldeinformationsmanager. Deaktivieren stoppt Abrufe; Zugang separat entfernen, um ihn zu löschen.",
  "providers.category.subscription": "Abos & Coding-Pläne",
  "providers.category.api": "API-Guthaben & Ausgaben",
  "providers.region": "Dienstregion",
  "providers.global": "Global / International",
  "providers.china": "Festlandchina",
  "providers.teamId": "xAI-Team-ID",
  "providers.saveTeam": "Team-ID speichern",
  "providers.auth.token": "Access-Token / Plan-API-Key",
  "providers.auth.cookie": "WorkosCursorSessionToken-Cookie",
  "providers.auth.management": "Management-API-Key",
  "providers.auth.admin": "Organisations-Admin-API-Key",
  "providers.saveCredential": "Zugang speichern",
  "providers.replaceSecret": "Gespeichert · Ersatz eingeben",
  "providers.enterSecret": "Zugang eingeben",
  "providers.import": "CLI-Anmeldung importieren",
  "providers.removeCredential": "Zugang entfernen",
  "providers.credentialStored": "Zugang sicher gespeichert. Das allein bestätigt noch keinen Zugriff.",
  "providers.notConnected": "Kein Zugang für diese Region gespeichert.",
  "providers.connected": "Verbrauch erfolgreich abgerufen.",
  "providers.check": "Diesen Anbieter aktualisieren",
  "providers.dashboard": "Dashboard öffnen",
  "providers.working": "Wird verarbeitet…",
  "providers.loading": "Verbrauch wird geladen…",
  "providers.loadError": "Anbieterdaten konnten nicht geladen werden.",
  "providers.error.needs_auth": "Anmeldung oder Zugang erforderlich. Zugangstyp und gewählte Region prüfen.",
  "providers.error.expired": "Die importierte Anmeldung ist abgelaufen. CLI-Anmeldung erneuern und erneut importieren.",
  "providers.error.local_unavailable": "Antigravity lokal nicht erreichbar. App/IDE öffnen oder bei agy anmelden und PATH prüfen.",
  "providers.error.network": "Netzwerkabruf fehlgeschlagen. Bei verfügbarer Verbindung erneut versuchen.",
  "providers.error.rate_limited": "Der Anbieter begrenzt Verbrauchsabfragen. Automatische Wiederholungen warten zunächst.",
  "providers.error.unsupported_response": "Keine unterstützten Verbrauchsdaten erhalten. Dashboard prüfen; Konto oder Antwortformat werden möglicherweise nicht unterstützt.",
  "providers.error.keyring": "Zugang konnte im Windows-Anmeldeinformationsmanager nicht gelesen oder gespeichert werden.",
  "providers.error.settings": "Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.",
  "providers.stale": "Letzter erfolgreicher Stand; möglicherweise veraltet.",
  "providers.points": "Punkte",
  "providers.amount.balance": "Verfügbares Guthaben",
  "providers.amount.posted_balance": "Gebuchtes Prepaid-Guthaben",
  "providers.amount.spend": "Gemeldete API-Ausgaben",
  "providers.amount.included_spend": "Genutztes Abo-Kontingent",
  "providers.amount.on_demand_spend": "Kostenpflichtige Zusatznutzung",
  "providers.amount.points": "Plan-Punkteguthaben",
  "providers.period.current_cycle": "Aktueller Abrechnungszeitraum",
  "providers.period.last_30_days": "Letzte 30 Tage",
  "providers.window.weekly": "Wöchentlich",
  "providers.window.5h": "5 Stunden",
  "providers.window.daily": "Täglich",
  "providers.window.monthly": "Monatlich",
  "providers.window.quota": "Kontingent",
  "providers.window.included": "Enthaltenes Kontingent",
  "providers.partial": "Unvollständig",
  "providers.postedNote": "Gebuchtes Guthaben; Verbrauch des laufenden Abrechnungszeitraums kann noch unberücksichtigt sein.",
  "providers.statisticsNote": "Statistiken werden je Modul und Region getrennt gespeichert. Kontingente, Guthaben und gemeldete Kosten werden nicht zusammengerechnet.",
  'quota.usage': '{used} % verbraucht · {left} % übrig',
  'budget.day': 'Budgettag {day}/7',
  'budget.target': 'Tagesziel: {pct} %',
  'budget.marker': 'Gleichmäßiger Verbrauch bis jetzt: {pct} %. Verbrauch rechts davon liegt über dem zeitanteiligen Plan.',
  'budget.available': 'Bis {when}: noch {n} Prozentpunkte im Budget',
  'budget.over': '{n} Prozentpunkte über Tagesbudget',
  'budget.unavailable': 'Tagesbudget ohne gültigen Wochenreset nicht verfügbar.',
  'budget.note': 'Ungenutztes Budget bleibt bis zum Wochenreset erhalten.',
  'credits.unknownExpiry': 'Ablauf unbekannt',
  'credits.expiryMarker': '{name} läuft ab: {when}',
  'credits.expiryLegend': 'Banked Reset läuft ab · Zeitpunkt beim Darüberfahren',
  'credits.soon': 'Läuft bald ab',
  'credits.urgent': 'Läuft innerhalb von 24 Std. ab',

  'app.title': 'CodexTracker',
  'app.refresh.tooltip': 'Jetzt aktualisieren',
  'app.settings.tooltip': 'Einstellungen',
  'app.stats.tooltip': 'Statistik öffnen',
  'app.footer.updated': 'Aktualisiert',
  'app.footer.never': 'Nicht angemeldet',
  'app.footer.neverLowercase': 'nie',
  'app.version': 'v2.4.3',

  'account.notSignedIn': 'Nicht angemeldet',
  'status.ok': 'OK',
  'status.sessionLow': 'Sitzung niedrig',

  'login.heading': 'Bei Codex anmelden',
  'login.body': 'CodexTracker liest deine Tokens aus der Codex-CLI. Starte `codex` einmal im Terminal, um dich anzumelden, und klicke dann auf die Schaltfläche unten.',
  'login.importButton': 'Aus Codex CLI importieren',
  'login.importing': 'Importiere…',
  'login.failed': 'Import fehlgeschlagen.',
  'login.tokenStorage': 'Der Refresh-Token liegt im Windows-Anmeldeinformationsmanager. Access-Tokens bleiben nur im Arbeitsspeicher.',

  'section.session': 'Sitzung',
  'section.weekly': 'Wöchentlich',
  'section.resetCredits': 'Limit-Reset-Credits',
  'section.credits': 'Credits',

  'meta.left': 'Übrig',
  'meta.used': 'Verbraucht',
  'meta.reset': 'Reset',
  'meta.nextExpiry': 'Nächster Ablauf',
  'meta.plan': 'Plan',
  'meta.balance': 'Kontostand',
  'meta.available': 'Verfügbar',

  'hint.available': '{n} verfügbar',
  'hint.creditBalance': '{n} Credits',
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
  'settings.section.notifications': 'Benachrichtigungen',
  'settings.notificationsEnabled': 'Aktiviert',
  'settings.section.language': 'Sprache',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
  'settings.addRule': '+ Regel hinzufügen',
  'settings.signOut': 'Codex abmelden',
  'settings.close': 'Schließen',
  'settings.quit': 'Beenden',
  'settings.saving': 'Speichere…',
  'settings.ruleCard.session': 'Sitzung',
  'settings.ruleCard.weekly': 'Wöchentlich',
  'settings.ruleCard.credits': 'Credits',
  'settings.ruleCard.resets': 'Resets',

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
