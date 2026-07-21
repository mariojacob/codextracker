/** Quota, credit and session statistics for the last 30 days. */
import { useCallback, useEffect, useState } from 'react';
import type { Statistics as StatisticsData } from '../../shared/types.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type Locale = 'en' | 'de';

const STRINGS = {
  en: {
    title: 'Statistics', subtitle: 'Last 30 days', refresh: 'Refresh', loading: 'Loading…',
    noData: 'No data yet — start using Codex to see statistics here.', err: 'Failed to compute statistics.',
    avgWeekly: 'Avg weekly left', peakWeekly: 'Peak weekly used', avgSession: 'Avg session left',
    peakSession: 'Peak session used', creditsSpent: 'Credits spent', creditsGained: 'Credits gained',
    sessionsOpened: 'Sessions opened', mostActive: 'Most active day', weeklyTrend: 'Weekly utilization (peak used %)',
    weekday: 'Sessions by weekday', daysTracked: 'days tracked', none: '—',
  },
  de: {
    title: 'Statistik', subtitle: 'Letzte 30 Tage', refresh: 'Aktualisieren', loading: 'Lade…',
    noData: 'Noch keine Daten — nutze Codex, um hier Statistiken zu sehen.', err: 'Statistik konnte nicht berechnet werden.',
    avgWeekly: 'Ø Wöchentlich übrig', peakWeekly: 'Peak Wöchentlich verbraucht', avgSession: 'Ø Sitzung übrig',
    peakSession: 'Peak Sitzung verbraucht', creditsSpent: 'Credits verbraucht', creditsGained: 'Credits erhalten',
    sessionsOpened: 'Sitzungen geöffnet', mostActive: 'Aktivster Tag', weeklyTrend: 'Wöchentliche Auslastung (Peak %)',
    weekday: 'Sitzungen nach Wochentag', daysTracked: 'Tage erfasst', none: '—',
  },
} as const;

export function Statistics() {
  const [locale, setLocale] = useState<Locale>('en');
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const t = STRINGS[locale];
  const weekdays = locale === 'de' ? WEEKDAYS_DE : WEEKDAYS;

  useEffect(() => {
    let active = true;
    void window.codexAPI.getSettings().then((settings) => active && setLocale(settings.language));
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setStats(await window.codexAPI.getStats()); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const header = <Header title={t.title} subtitle={t.subtitle} refresh={t.refresh} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />;
  if (loading) return <div className="stats-window">{header}<div className="stats-loading">{t.loading}</div></div>;
  if (error) return <div className="stats-window">{header}<div className="stats-error">{t.err}: {error}</div></div>;
  if (!stats || stats.summary.days_covered === 0) return <div className="stats-window">{header}<div className="stats-empty">{t.noData}</div></div>;

  const s = stats.summary;
  const pct = (value: number | null) => value == null ? t.none : `${Math.round(value)} %`;
  return (
    <div className="stats-window">
      {header}
      <div className="stats-grid">
        <StatCard label={t.avgWeekly} value={pct(s.avg_weekly_pct_left)} />
        <StatCard label={t.peakWeekly} value={pct(s.peak_weekly_pct_used)} warn={(s.peak_weekly_pct_used ?? 0) >= 80} />
        <StatCard label={t.avgSession} value={pct(s.avg_session_pct_left)} />
        <StatCard label={t.peakSession} value={pct(s.peak_session_pct_used)} warn={(s.peak_session_pct_used ?? 0) >= 80} />
        <StatCard label={t.creditsSpent} value={s.credits_spent.toLocaleString()} />
        <StatCard label={t.creditsGained} value={s.credits_gained.toLocaleString()} />
        <StatCard label={t.sessionsOpened} value={String(s.sessions_opened)} />
        <StatCard label={t.mostActive} value={s.most_active_weekday == null ? t.none : weekdays[s.most_active_weekday]} />
      </div>
      <ChartPanel title={t.weeklyTrend}><WeeklyTrendChart daily={stats.daily} /></ChartPanel>
      <ChartPanel title={t.weekday}><WeekdayChart weekday={stats.weekday} labels={weekdays} /></ChartPanel>
      <div className="stats-footer">{s.days_covered} {t.daysTracked} · {new Date(s.range_end).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US')}</div>
    </div>
  );
}

function Header({ title, subtitle, refresh, refreshing, onRefresh }: { title: string; subtitle: string; refresh: string; refreshing: boolean; onRefresh: () => void }) {
  return <div className="stats-header"><div><h1>{title}</h1><span className="stats-subtitle">{subtitle}</span></div><button className="stats-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? '⟳' : '↻'} {refresh}</button></div>;
}

function StatCard({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className={`stat-card${warn ? ' warn' : ''}`}><span className="stat-label">{label}</span><span className="stat-value">{value}</span></div>;
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="chart-panel"><h3>{title}</h3><div className="chart-body">{children}</div></div>;
}

function WeeklyTrendChart({ daily }: { daily: StatisticsData['daily'] }) {
  const usable = daily.filter((day) => day.weekly_pct_used_min != null);
  if (!usable.length) return <div className="chart-empty">—</div>;
  const points = usable.map((day, index) => [
    (index / Math.max(1, usable.length - 1)) * 580 + 10,
    110 - ((day.weekly_pct_used_min ?? 0) / 100) * 100,
    day,
  ] as const);
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return <svg className="chart-svg" viewBox="0 0 600 120" preserveAspectRatio="none"><path d={`${path} L580,120 L10,120 Z`} className="area"/><path d={path} className="line"/>{points.map(([x, y, day]) => <circle key={day.date} cx={x} cy={y} r="2.5" className="dot"><title>{day.date}: {Math.round(day.weekly_pct_used_min ?? 0)}% used</title></circle>)}</svg>;
}

function WeekdayChart({ weekday, labels }: { weekday: StatisticsData['weekday']; labels: readonly string[] }) {
  const max = Math.max(1, ...weekday.map((day) => day.sessions));
  return <svg className="chart-svg" viewBox="0 0 600 140" preserveAspectRatio="none">{weekday.map((day, index) => { const x = index * (600 / 7) + 10; const width = 600 / 7 - 20; const height = day.sessions / max * 100; return <g key={day.weekday}><rect x={x} y={110 - height} width={width} height={height} rx="2" className={`bar ${day.sessions ? '' : 'dim'}`}><title>{labels[day.weekday]}: {day.sessions}</title></rect><text x={x + width / 2} y={128} textAnchor="middle" className="bar-label">{labels[day.weekday]}</text></g>; })}</svg>;
}
