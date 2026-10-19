import { useState } from 'react';
import type { DailyBucket, Language, Statistics as StatisticsData, UsageTotal } from '../../shared/types.js';

const STRINGS = {
  en: {
    title: 'Statistics', subtitle: 'Observed consumption', refresh: 'Refresh', loading: 'Loading…',
    error: 'Statistics could not be loaded.', noAnchor: 'A valid weekly reset is needed to align budget days. Refresh usage in the main window.',
    current: 'Current budget day', previous: 'Previous budget day', week: 'Last 7 budget days', month: 'Last 30 budget days',
    spent: 'Credits decreased · 30 days', gained: 'Credits increased · 30 days', points: 'percentage points of weekly quota',
    incomplete: 'Incomplete', estimated: 'Approximated across a day boundary', gap: 'Data gap', zero: 'No observed consumption',
    chart: 'Consumption per budget day', days7: '7 days', days30: '30 days', unit: 'Percentage points',
    note: 'Budget days follow the current reset time, in 24-hour periods. Totals include observed changes only; usage while tracking was unavailable may be missing.',
    legacy: 'Older history is preserved. Reliable consumption starts with new measurements containing reset information.',
    empty: 'No comparable measurements yet. Keep the tracker running to collect consumption.',
    legend: 'Hatched areas indicate gaps; a small baseline with 0 indicates measured zero consumption.',
    updated: 'Updated', coverage: 'Observed coverage',
  },
  de: {
    title: 'Statistik', subtitle: 'Beobachteter Verbrauch', refresh: 'Aktualisieren', loading: 'Lade…',
    error: 'Statistik konnte nicht geladen werden.', noAnchor: 'Für Budgettage wird ein gültiger Wochenreset benötigt. Aktualisiere die Nutzung im Hauptfenster.',
    current: 'Aktueller Budgettag', previous: 'Vorheriger Budgettag', week: 'Letzte 7 Budgettage', month: 'Letzte 30 Budgettage',
    spent: 'Credits abgenommen · 30 Tage', gained: 'Credits zugenommen · 30 Tage', points: 'Prozentpunkte des Wochenkontingents',
    incomplete: 'Unvollständig', estimated: 'An Tagesgrenze zeitanteilig angenähert', gap: 'Datenlücke', zero: 'Kein beobachteter Verbrauch',
    chart: 'Verbrauch pro Budgettag', days7: '7 Tage', days30: '30 Tage', unit: 'Prozentpunkte',
    note: 'Budgettage folgen der aktuellen Reset-Uhrzeit in 24-Stunden-Abschnitten. Summen enthalten nur beobachtete Änderungen; bei unterbrochener Erfassung kann Verbrauch fehlen.',
    legacy: 'Alte Historie bleibt erhalten. Verlässlicher Verbrauch wird ab neuen Messungen mit Resetinformationen erfasst.',
    empty: 'Noch keine vergleichbaren Messungen. Lass den Tracker laufen, um Verbrauch zu erfassen.',
    legend: 'Schraffierte Bereiche zeigen Datenlücken; eine kleine Grundlinie mit 0 bedeutet gemessenen Nullverbrauch.',
    updated: 'Aktualisiert', coverage: 'Beobachteter Zeitraum',
  },
} as const;

export function CodexStatistics({ stats, locale }: { stats: StatisticsData; locale: Language }) {
  const [days, setDays] = useState<7 | 30>(7);
  const t = STRINGS[locale];
  const language = locale === 'de' ? 'de-AT' : 'en-GB';
  const number = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 2 });

  function card(label: string, total: UsageTotal, credit = false) {
    return <div className="stat-card" key={label}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{total.value == null ? '—' : number(total.value)}</span>
      <span className="stat-unit">{credit ? 'Credits' : t.points}</span>
      {total.incomplete && <span className="stat-incomplete">{t.incomplete}</span>}
    </div>;
  }

  return <>
    {stats && !stats.anchor_available && <div className="stats-empty">{t.noAnchor}</div>}
    {stats?.anchor_available && <>
      <div className="stats-grid quota-grid">
        {card(t.current, stats.summary.current_day)}{card(t.previous, stats.summary.previous_day)}
        {card(t.week, stats.summary.last_7_days)}{card(t.month, stats.summary.last_30_days)}
      </div>
      {stats.summary.last_30_days.value == null && <p className="stats-notice">{t.empty}</p>}
      <section className="chart-panel">
        <div className="chart-heading"><h2>{t.chart}</h2><div className="chart-switch" aria-label={t.chart}>
          {([7, 30] as const).map((count) => <button key={count} aria-pressed={days === count} onClick={() => setDays(count)}>{count === 7 ? t.days7 : t.days30}</button>)}
        </div></div>
        <DailyChart daily={stats.daily.slice(-days)} locale={locale} computedAt={Date.parse(stats.computed_at)} />
        <p className="chart-legend">{t.legend}</p>
      </section>
      <div className="stats-grid credits-grid">{card(t.spent, stats.summary.credits_spent, true)}{card(t.gained, stats.summary.credits_gained, true)}</div>
      <p className="stats-notice">{t.note}</p>
    </>}
    {stats?.has_legacy_history && <p className="stats-notice">{t.legacy}</p>}
  </>;
}

function DailyChart({ daily, locale, computedAt }: { daily: DailyBucket[]; locale: Language; computedAt: number }) {
  const t = STRINGS[locale];
  const language = locale === 'de' ? 'de-AT' : 'en-GB';
  const number = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 2 });
  const max = Math.max(1, ...daily.map((day) => day.weekly_consumed ?? 0));
  const date = (timestamp: number) => new Date(timestamp).toLocaleString(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return <div className="daily-chart">
    <div className="chart-scale"><span>{number(max)}</span><span>{t.unit}</span><span>0</span></div>
    <div className="daily-columns" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>
      {daily.map((day, index) => {
        const value = day.weekly_consumed;
        const coverage = day.observed_ms / Math.max(1, Math.min(day.end_at, computedAt) - day.start_at) * 100;
        const description = `${date(day.start_at)} – ${date(day.end_at)}\n${value == null ? t.gap : `${number(value)} ${t.unit}`}\n${t.coverage}: ${number(coverage)} %${day.incomplete ? ` · ${t.incomplete}` : ''}${day.estimated ? ` · ${t.estimated}` : ''}`;
        return <div className="daily-column" key={day.start_at}>
          <div className={`daily-slot${day.incomplete ? ' has-gap' : ''}`} title={description} aria-label={description} role="img" tabIndex={0}>
            {value != null && <div className="daily-fill" style={{ height: `${Math.max(1.5, value / max * 100)}%` }} />}
            {(daily.length <= 7 || value === 0) && <span className="daily-value">{value == null ? '—' : number(value)}</span>}
          </div>
          <span className="daily-date">{daily.length <= 7 || index % 5 === 0 || index === daily.length - 1 ? new Date(day.start_at).toLocaleDateString(language, { day: '2-digit', month: '2-digit' }) : ''}</span>
        </div>;
      })}
    </div>
  </div>;
}
