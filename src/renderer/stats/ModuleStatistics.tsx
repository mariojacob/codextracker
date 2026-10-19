import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, UsageTotal } from '../../shared/types.js';
import type { AmountStatistics, ModuleStatisticsReport, ObservedDay, StatisticsSelection } from '../../shared/provider-statistics.js';
import { PROVIDERS } from '../../shared/providers.js';
import { CodexStatistics } from './Statistics.js';

const TEXT = {
  en: {
    title: 'Statistics', subtitle: 'Each module is evaluated separately', module: 'Module', metric: 'Quota / balance', refresh: 'Refresh', loading: 'Loading…', error: 'Statistics could not be loaded.',
    subscription: 'Subscriptions & Coding Plans', api: 'API balances & spend', global: 'Global', china: 'China', disabled: 'Paused',
    paused: 'Tracking is paused for this module. Existing history remains available.', empty: 'No measurements yet for this module and login. History starts when this module provides valid readings.',
    current: 'Current budget day', previous: 'Previous budget day', week: 'Last 7 budget days', month: 'Last 30 budget days',
    today: 'Today', yesterday: 'Yesterday', days7: 'Last 7 calendar days', days30: 'Last 30 calendar days',
    points: 'Percentage points of this quota', pointUnit: 'Percentage points', lastReading: 'Last reading', used: 'used', incomplete: 'Incomplete',
    budget: 'Budget days follow this quota’s reset time in 24-hour periods.', calendar: 'Calendar days use your computer’s local time.',
    quotaNote: 'Only positive changes inside the same reset window are counted. Different quotas and modules are never added together.',
    unknownWindow: 'The provider did not supply a comparable reset window. A usage percentage alone cannot establish observed consumption.',
    gap: 'Data gap', estimated: 'Approximated across a day boundary', coverage: 'Observed coverage', chart: 'Observed consumption per day',
    legend: 'Hatching marks missing coverage. A baseline with 0 means a measured zero value, not missing data.',
    short7: '7 days', short30: '30 days', decrease7: 'Observed decrease · 7 days', decrease30: 'Observed decrease · 30 days', increase30: 'Observed increase · 30 days',
    trend: 'Last reported value per calendar day', decreases: 'Observed decreases', increases: 'Observed increases', view: 'Chart',
    balanceNote: 'Balance changes may include top-ups, adjustments and delayed postings. A decrease is not a verified cost.',
    costNote: 'Vendor-reported cost or allowance for the stated period. Samples and rolling 30-day totals are never added together or treated as daily spend.',
    updated: 'Updated', periodCycle: 'Current billing cycle', period30: 'Provider’s last 30 days', noPeriod: 'Reported value',
    weekly: 'Weekly', '5h': '5-hour', daily: 'Daily', monthly: 'Monthly', quota: 'Quota', included: 'Included allowance',
    balance: 'Available balance', posted_balance: 'Posted prepaid balance', spend: 'Reported API spend', included_spend: 'Included plan usage', on_demand_spend: 'Paid extra usage', pointsKind: 'Plan points balance',
    pointsUnit: 'points', notSummed: 'No total across providers, currencies or independent quota pools.',
  },
  de: {
    title: 'Statistik', subtitle: 'Jedes Modul wird getrennt ausgewertet', module: 'Modul', metric: 'Kontingent / Guthaben', refresh: 'Aktualisieren', loading: 'Lade…', error: 'Statistik konnte nicht geladen werden.',
    subscription: 'Abos & Coding-Pläne', api: 'API-Guthaben & Ausgaben', global: 'Global', china: 'China', disabled: 'Pausiert',
    paused: 'Die Erfassung für dieses Modul ist pausiert. Die bisherige Historie bleibt verfügbar.', empty: 'Noch keine Messwerte für dieses Modul und diese Anmeldung. Die Historie beginnt, sobald das Modul gültige Messwerte liefert.',
    current: 'Aktueller Budgettag', previous: 'Vorheriger Budgettag', week: 'Letzte 7 Budgettage', month: 'Letzte 30 Budgettage',
    today: 'Heute', yesterday: 'Gestern', days7: 'Letzte 7 Kalendertage', days30: 'Letzte 30 Kalendertage',
    points: 'Prozentpunkte dieses Kontingents', pointUnit: 'Prozentpunkte', lastReading: 'Letzter Messwert', used: 'verbraucht', incomplete: 'Unvollständig',
    budget: 'Budgettage folgen der Reset-Uhrzeit dieses Kontingents in 24-Stunden-Abschnitten.', calendar: 'Kalendertage richten sich nach der lokalen Zeit deines Rechners.',
    quotaNote: 'Es zählen nur positive Änderungen innerhalb desselben Resetfensters. Verschiedene Kontingente und Module werden nicht addiert.',
    unknownWindow: 'Der Anbieter liefert kein vergleichbares Resetfenster. Aus einem Prozentstand allein lässt sich kein beobachteter Verbrauch ermitteln.',
    gap: 'Datenlücke', estimated: 'An Tagesgrenze zeitanteilig angenähert', coverage: 'Beobachteter Zeitraum', chart: 'Beobachteter Verbrauch pro Tag',
    legend: 'Schraffierung zeigt fehlende Erfassung. Eine Grundlinie mit 0 steht für einen gemessenen Nullwert, keine Datenlücke.',
    short7: '7 Tage', short30: '30 Tage', decrease7: 'Beobachtete Abnahme · 7 Tage', decrease30: 'Beobachtete Abnahme · 30 Tage', increase30: 'Beobachtete Zunahme · 30 Tage',
    trend: 'Letzter gemeldeter Wert pro Kalendertag', decreases: 'Beobachtete Abnahmen', increases: 'Beobachtete Zunahmen', view: 'Diagramm',
    balanceNote: 'Guthabenänderungen können Aufladungen, Korrekturen und verzögerte Buchungen enthalten. Eine Abnahme ist kein bestätigter Kostenbetrag.',
    costNote: 'Vom Anbieter gemeldete Kosten oder Kontingentwerte für den genannten Zeitraum. Messwerte und rollierende 30-Tage-Summen werden nicht addiert oder als Tageskosten interpretiert.',
    updated: 'Aktualisiert', periodCycle: 'Aktueller Abrechnungszeitraum', period30: 'Letzte 30 Tage laut Anbieter', noPeriod: 'Gemeldeter Wert',
    weekly: 'Wöchentlich', '5h': '5 Stunden', daily: 'Täglich', monthly: 'Monatlich', quota: 'Kontingent', included: 'Enthaltenes Kontingent',
    balance: 'Verfügbares Guthaben', posted_balance: 'Gebuchtes Prepaid-Guthaben', spend: 'Gemeldete API-Ausgaben', included_spend: 'Genutztes Abo-Kontingent', on_demand_spend: 'Kostenpflichtige Zusatznutzung', pointsKind: 'Plan-Punkteguthaben',
    pointsUnit: 'Punkte', notSummed: 'Keine Gesamtsumme über Anbieter, Währungen oder unabhängige Kontingente.',
  },
} as const;
type Strings = typeof TEXT[Language];
const selectionKey = (selection: StatisticsSelection) => `${selection.id}:${selection.region}`;

export function Statistics() {
  const [locale, setLocale] = useState<Language>('en');
  const [report, setReport] = useState<ModuleStatisticsReport | null>(null);
  const [selection, setSelection] = useState<StatisticsSelection>();
  const [metricKey, setMetricKey] = useState('');
  const [refreshing, setRefreshing] = useState(false), [error, setError] = useState(false);
  const [days, setDays] = useState<7 | 30>(7), [view, setView] = useState<'trend' | 'decreased' | 'increased'>('trend');
  const revision = useRef(0);
  const t = TEXT[locale], language = locale === 'de' ? 'de-AT' : 'en-GB';
  const number = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 2 });
  const date = (value: string) => new Date(value).toLocaleString(language);
  const load = useCallback(async () => {
    const current = ++revision.current; setRefreshing(true);
    try {
      const [next, settings] = await Promise.all([window.codexAPI.getStats(selection), window.codexAPI.getSettings()]);
      if (current === revision.current) { setReport(next); setLocale(settings.language); setError(false); }
    } catch { if (current === revision.current) setError(true); }
    finally { if (current === revision.current) setRefreshing(false); }
  }, [selection]);
  useEffect(() => {
    void load();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const update = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => void load(), 150); };
    const unsubscribe = window.codexAPI.onStatsUpdate(update);
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { revision.current++; unsubscribe(); clearInterval(timer); clearTimeout(debounce); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [load]);
  const quotaLabel = (value: string) => value.split(' · ').map((part) => part in t ? t[part as keyof Strings] : part).join(' · ');
  const amountLabel = (amount: AmountStatistics) => `${t[amount.kind === 'points' ? 'pointsKind' : amount.kind]} · ${amount.currency === 'points' ? t.pointsUnit : amount.currency}`;
  const quota = report?.quotas.find((value) => `q:${value.id}` === metricKey) ?? (!metricKey.startsWith('a:') ? report?.quotas[0] : undefined);
  const amount = report?.amounts.find((value) => `a:${value.id}` === metricKey) ?? (!quota ? report?.amounts[0] : undefined);
  const actualMetric = quota ? `q:${quota.id}` : amount ? `a:${amount.id}` : '';
  function amountValue(value: number) {
    if (amount && /^[A-Z]{3}$/.test(amount.currency)) return new Intl.NumberFormat(language, { style: 'currency', currency: amount.currency, maximumFractionDigits: 4 }).format(value);
    return `${number(value)} ${amount?.currency === 'points' ? t.pointsUnit : amount?.currency ?? ''}`;
  }
  function card(label: string, total: UsageTotal, money = false) {
    return <div className="stat-card"><span className="stat-label">{label}</span>
      <span className="stat-value">{total.value == null ? '—' : money ? amountValue(total.value) : number(total.value)}</span>
      {!money && <span className="stat-unit">{t.points}</span>}{total.incomplete && <span className="stat-incomplete">{t.incomplete}</span>}
    </div>;
  }
  const balance = amount && ['balance', 'posted_balance', 'points'].includes(amount.kind);
  const moduleName = (id: string) => id === 'codex' ? 'ChatGPT / Codex' : PROVIDERS.find((value) => value.id === id)?.name ?? id;
  const category = (id: string) => id === 'codex' ? 'subscription' : PROVIDERS.find((value) => value.id === id)?.category;
  return <div className="stats-window" aria-busy={refreshing}>
    <header className="stats-header"><div><h1>{t.title}</h1><span className="stats-subtitle">{t.subtitle}</span></div>
      <button className="stats-refresh" disabled={refreshing} onClick={() => void load()}>↻ {t.refresh}</button></header>
    {error && <div className="stats-error" role="alert">{t.error}</div>}
    {!report && !error && <div className="stats-loading">{t.loading}</div>}
    {report && <>
      <div className="stats-selectors"><label>{t.module}<select value={selectionKey(report.selected)} onChange={(event) => {
        const module = report.modules.find((value) => selectionKey(value) === event.target.value);
        if (module) { setSelection({ id: module.id, region: module.region }); setMetricKey(''); setReport(null); setView('trend'); }
      }}>{(['subscription', 'api'] as const).map((group) => <optgroup key={group} label={t[group]}>
        {report.modules.filter((value) => category(value.id) === group).map((value) => <option key={selectionKey(value)} value={selectionKey(value)}>
          {moduleName(value.id)}{PROVIDERS.find((provider) => provider.id === value.id)?.regions ? ` · ${t[value.region]}` : ''}{!value.enabled ? ` · ${t.disabled}` : ''}
        </option>)}
      </optgroup>)}</select></label>
      {(report.quotas.length + report.amounts.length > 0) && <label>{t.metric}<select value={actualMetric} onChange={(event) => { setMetricKey(event.target.value); setView('trend'); }}>
        {report.quotas.map((value) => <option key={`q:${value.id}`} value={`q:${value.id}`}>{quotaLabel(value.label)}</option>)}
        {report.amounts.map((value) => <option key={`a:${value.id}`} value={`a:${value.id}`}>{amountLabel(value)}</option>)}
      </select></label>}</div>
      {!report.enabled && <p className="stats-notice">{t.paused}</p>}
      {report.codex ? <CodexStatistics stats={report.codex} locale={locale} /> : <>
        {!report.has_history && <p className="stats-empty">{t.empty}</p>}
        {quota && <>
          <p className="stats-notice">{t.lastReading}: <strong>{quota.current_used == null ? '—' : `${number(quota.current_used)} % ${t.used}`}</strong>{quota.measured_at && ` · ${date(quota.measured_at)}`}</p>
          <div className="stats-grid quota-grid">{card(quota.alignment === 'budget' ? t.current : t.today, quota.summary.current_day)}{card(quota.alignment === 'budget' ? t.previous : t.yesterday, quota.summary.previous_day)}
            {card(quota.alignment === 'budget' ? t.week : t.days7, quota.summary.last_7_days)}{card(quota.alignment === 'budget' ? t.month : t.days30, quota.summary.last_30_days)}</div>
          {!quota.comparable && <p className="stats-notice">{t.unknownWindow}</p>}
          <ChartPanel days={days} setDays={setDays} title={t.chart} t={t}><MetricChart daily={quota.daily.slice(-days)} locale={locale} unit={t.pointUnit} format={number} computedAt={Date.parse(report.computed_at)} /></ChartPanel>
          <p className="stats-notice">{quota.alignment === 'budget' ? t.budget : t.calendar} {t.quotaNote}</p>
        </>}
        {amount && <>
          <div className="stats-grid quota-grid">
            <div className="stat-card"><span className="stat-label">{amountLabel(amount)} · {t.lastReading}</span><span className="stat-value">{amount.current == null ? '—' : amountValue(amount.current)}</span>
              <span className="stat-unit">{amount.period === 'current_cycle' ? t.periodCycle : amount.period === 'last_30_days' ? t.period30 : t.noPeriod}</span>
              {amount.partial && <span className="stat-incomplete">{t.incomplete}</span>}{amount.measured_at && <span className="stat-unit">{date(amount.measured_at)}</span>}</div>
            {balance && <>{card(t.decrease7, amount.decrease_summary.last_7_days, true)}{card(t.decrease30, amount.decrease_summary.last_30_days, true)}{card(t.increase30, amount.increase_summary.last_30_days, true)}</>}
          </div>
          {balance && <label className="stats-chart-select">{t.view}<select value={view} onChange={(event) => setView(event.target.value as typeof view)}>
            <option value="trend">{t.trend}</option><option value="decreased">{t.decreases}</option><option value="increased">{t.increases}</option>
          </select></label>}
          <ChartPanel days={days} setDays={setDays} title={view === 'trend' || !balance ? t.trend : view === 'decreased' ? t.decreases : t.increases} t={t}>
            <MetricChart daily={(balance ? amount[view] : amount.trend).slice(-days)} locale={locale} unit={amount.currency === 'points' ? t.pointsUnit : amount.currency} format={amountValue} computedAt={Date.parse(report.computed_at)} />
          </ChartPanel><p className="stats-notice">{t.calendar} {balance ? t.balanceNote : t.costNote}</p>
        </>}
      </>}
      <p className="stats-notice">{t.notSummed}</p>
      <footer className="stats-footer">{t.updated} {date(report.computed_at)}</footer>
    </>}
  </div>;
}

function ChartPanel({ days, setDays, title, t, children }: { days: 7 | 30; setDays: (value: 7 | 30) => void; title: string; t: Strings; children: React.ReactNode }) {
  return <section className="chart-panel"><div className="chart-heading"><h2>{title}</h2><div className="chart-switch" aria-label={title}>
    {([7, 30] as const).map((value) => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value === 7 ? t.short7 : t.short30}</button>)}
  </div></div>{children}<p className="chart-legend">{t.legend}</p></section>;
}
function MetricChart({ daily, locale, unit, format, computedAt }: { daily: ObservedDay[]; locale: Language; unit: string; format: (value: number) => string; computedAt: number }) {
  const t = TEXT[locale], language = locale === 'de' ? 'de-AT' : 'en-GB';
  const max = Math.max(1, ...daily.map((day) => day.value ?? 0)), min = Math.min(0, ...daily.map((day) => day.value ?? 0));
  const range = max - min, baseline = -min / range * 100;
  const date = (timestamp: number) => new Date(timestamp).toLocaleString(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return <div className="daily-chart"><div className="chart-scale"><span>{format(max)}</span><span>{unit}</span><span>{format(min)}</span></div>
    <div className="daily-columns" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>{daily.map((day, index) => {
      const value = day.value, height = value == null ? 0 : Math.abs(value) / range * 100;
      const coverage = Math.min(100, day.observed_ms / Math.max(1, Math.min(day.end_at, computedAt) - day.start_at) * 100);
      const description = `${date(day.start_at)} – ${date(day.end_at)}\n${value == null ? t.gap : `${format(value)} ${unit}`}\n${t.coverage}: ${coverage.toLocaleString(language, { maximumFractionDigits: 1 })} %${day.incomplete ? ` · ${t.incomplete}` : ''}${day.estimated ? ` · ${t.estimated}` : ''}`;
      return <div className="daily-column" key={day.start_at}><div className={`daily-slot${day.incomplete ? ' has-gap' : ''}`} title={description} aria-label={description} role="img" tabIndex={0}>
        <div className="daily-zero" style={{ bottom: `${baseline}%` }} />
        {value != null && <div className={`daily-fill metric-fill${value < 0 ? ' negative' : ''}`} style={{ bottom: `${value < 0 ? baseline - height : baseline}%`, height: `${Math.max(1, height)}%` }} />}
        {(daily.length <= 7 || value === 0) && <span className="daily-value">{value == null ? '—' : format(value)}</span>}
      </div><span className="daily-date">{daily.length <= 7 || index % 5 === 0 || index === daily.length - 1 ? new Date(day.start_at).toLocaleDateString(language, { day: '2-digit', month: '2-digit' }) : ''}</span></div>;
    })}</div></div>;
}
