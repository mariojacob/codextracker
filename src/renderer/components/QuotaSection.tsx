import { activeManualReset, manualResetBudget, manualResetMarker, type ManualReset, type ResetWindow } from '../../shared/manual-reset.js';
import { expiryUrgency, resetExpiryMarkers, weeklyBudget } from '../../shared/quota.js';
import type { ResetCreditEntry } from '../../shared/types.js';
import { useNow } from '../hooks/useNow.js';
import { makeRelativeFormatter, useLocale } from '../i18n.js';
import { Section } from './Section.js';

export function QuotaSection({ quota, manualReset, allowBudget = true, credits = [], showUnavailable = false }: {
  quota: ResetWindow; manualReset?: ManualReset; allowBudget?: boolean; credits?: ResetCreditEntry[]; showUnavailable?: boolean;
}) {
  const { t, locale } = useLocale();
  const now = useNow();
  const number = (n: number) => n.toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 1 });
  const date = (at: number) => new Date(at).toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const relative = makeRelativeFormatter(locale);
  const when = (at: number | null) => at == null ? '—' : `${date(at)} · ${relative(at - now)}`;
  const pending = activeManualReset(manualReset, quota.id, now);
  const manual = pending && manualReset.enabled ? manualReset : undefined;
  const left = quota.used_percent == null ? null : 100 - quota.used_percent;
  const budget = !allowBudget ? null : manual ? manualResetBudget(left, manual, now) : weeklyBudget(left, quota.reset_at, quota.window_seconds, now);
  const marker = manualResetMarker(manualReset, quota, now);
  const markerLabel = pending ? `${t('manual.title')}: ${when(manualReset.reset_at)}` : '';
  const expiryMarkers = resetExpiryMarkers(credits, quota.reset_at, quota.window_seconds, now).flatMap(({ credit, expiresAt, pct }) => {
    if (manual) {
      if (expiresAt <= manual.start_at || expiresAt > manual.reset_at) return [];
      pct = manual.start_used_percent + (100 - manual.start_used_percent) * (expiresAt - manual.start_at) / (manual.reset_at - manual.start_at);
    }
    return [{ id: credit.id, pct, urgency: expiryUrgency(expiresAt, now),
      label: t('credits.expiryMarker', { name: credit.title || credit.id.slice(0, 12), when: when(expiresAt) }) }];
  });
  const usage = left == null ? '—' : t('quota.usage', { used: number(100 - left), left: number(left) });
  return <Section title={quota.label} hint={usage} progressLabel={usage} pct={quota.used_percent}
    warn={left != null && left < 30} err={left != null && left < 10}
    currentDay={budget?.day} timeMarker={budget?.elapsedPct}
    segmentEnds={budget && 'segmentEnds' in budget ? budget.segmentEnds as number[] : undefined}
    markerLabel={budget ? t('budget.marker', { pct: number(budget.elapsedPct) }) : undefined}
    manualMarker={marker == null ? undefined : { pct: marker, label: markerLabel }}
    expiryMarkers={budget ? expiryMarkers : []}
    meta={[{ label: t(manual ? 'manual.title' : 'meta.reset'), value: when(manual?.reset_at ?? quota.reset_at), muted: true },
      { label: budget ? t(manual ? 'manual.day' : 'budget.day', { day: budget.day }) : t('meta.left'),
        value: budget ? t('budget.target', { pct: number(budget.targetPct) }) : left == null ? '—' : `${number(left)} %` }]}>
    {budget ? <div className={`budget-info${budget.over > 0 ? ' warn' : ''}`} title={t(manual ? 'manual.budgetNote' : 'budget.note')}>
      <div>{t('budget.available', { when: date(budget.dayEnd), n: number(budget.available) })}</div>
      {budget.over > 0 && <div className="budget-over">{t('budget.over', { n: number(budget.over) })}</div>}
      <div className="budget-legend"><span className="legend-tick" />{t('budget.marker', { pct: number(budget.elapsedPct) })}</div>
      {!!expiryMarkers.length && <div className="budget-legend"><span className="legend-expiry" />{t('credits.expiryLegend')}</div>}
    </div> : showUnavailable ? <div className="budget-unavailable">{t('budget.unavailable')}</div> : null}
    {marker != null && <div className="budget-legend"><span className="legend-manual" />{markerLabel}</div>}
  </Section>;
}
