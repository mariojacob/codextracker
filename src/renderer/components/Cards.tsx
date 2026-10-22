import { Section } from './Section.js';
import { useLocale, makeRelativeFormatter } from '../i18n.js';
import { useNow } from '../hooks/useNow.js';
import { availableResetCredits, creditExpiry, expiryUrgency, resetExpiryMarkers, weeklyBudget } from '../../shared/quota.js';
import type { CachedSnapshot, Language } from '../../shared/types.js';

function absolute(timestamp: number | null | undefined, locale: Language): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function Cards({ snapshot }: { snapshot: CachedSnapshot | null }) {
  const { t, locale } = useLocale();
  const now = useNow();
  const number = (n: number) => n.toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 1 });
  const relative = makeRelativeFormatter(locale);
  const resetLabel = (timestamp: number | null | undefined) => timestamp == null ? '—' : `${absolute(timestamp, locale)} · ${relative(timestamp - now)}`;
  const usage = (left: number | null | undefined) => left == null ? '—' : t('quota.usage', { used: number(100 - left), left: number(left) });
  const session = snapshot?.session_pct_left;
  const weekly = snapshot?.weekly_pct_left;
  const budget = weeklyBudget(weekly, snapshot?.weekly_reset_at, snapshot?.weekly_window_seconds, now);
  const credits = availableResetCredits(snapshot?.reset_credit_details ?? [], now);
  const nextExpiry = credits.map(creditExpiry).find((expiry) => expiry != null) ?? null;
  const nextUrgency = expiryUrgency(nextExpiry, now);
  const expiryMarkers = resetExpiryMarkers(credits, snapshot?.weekly_reset_at, snapshot?.weekly_window_seconds, now)
    .map(({ credit, expiresAt, pct }) => ({
      id: credit.id, pct, urgency: expiryUrgency(expiresAt, now),
      label: t('credits.expiryMarker', { name: credit.title || credit.id.slice(0, 12), when: resetLabel(expiresAt) }),
    }));
  return <>
    {snapshot?.error && <div className="error-banner">{snapshot.error}</div>}
    {snapshot?.session_window_available && <Section
      title={t('section.session')} hint={usage(session)} progressLabel={usage(session)}
      pct={session == null ? null : 100 - session} warn={session != null && session < 30} err={session != null && session < 10}
      meta={[{ label: t('meta.reset'), value: resetLabel(snapshot.session_reset_at), muted: true },
        { label: t('meta.left'), value: session == null ? '—' : `${number(session)} %` }]} />}

    <Section title={t('section.weekly')} hint={usage(weekly)} progressLabel={usage(weekly)}
      pct={weekly == null ? null : 100 - weekly} warn={weekly != null && weekly < 30} err={weekly != null && weekly < 10}
      currentDay={budget?.day} timeMarker={budget?.elapsedPct}
      expiryMarkers={budget ? expiryMarkers : []}
      markerLabel={budget ? t('budget.marker', { pct: number(budget.elapsedPct) }) : undefined}
      meta={[{ label: t('meta.reset'), value: resetLabel(snapshot?.weekly_reset_at), muted: true },
        { label: budget ? t('budget.day', { day: budget.day }) : t('meta.left'), value: budget ? t('budget.target', { pct: number(budget.targetPct) }) : weekly == null ? '—' : `${number(weekly)} %` }]}>
      {budget ? <div className={`budget-info${budget.over > 0 ? ' warn' : ''}`} title={t('budget.note')}>
        <div>{t('budget.available', { when: absolute(budget.dayEnd, locale), n: number(budget.available) })}</div>
        {budget.over > 0 && <div className="budget-over">{t('budget.over', { n: number(budget.over) })}</div>}
        <div className="budget-legend"><span className="legend-tick" />{t('budget.marker', { pct: number(budget.elapsedPct) })}</div>
        {!!expiryMarkers.length && <div className="budget-legend"><span className="legend-expiry" />{t('credits.expiryLegend')}</div>}
      </div> : <div className="budget-unavailable">{t('budget.unavailable')}</div>}
    </Section>

    <Section title={t('section.resetCredits')} hint={snapshot ? t('hint.available', { n: credits.length }) : '—'}
      meta={[{ label: t('meta.nextExpiry'), value: <span className={`expiry-${nextUrgency}`}>{nextExpiry == null ? (credits.length ? t('credits.unknownExpiry') : '—') : resetLabel(nextExpiry)}</span> },
        { label: t('meta.plan'), value: snapshot?.plan || '—', muted: true }]}>
      {!!credits.length && <div className="credits-list">{credits.map((credit) => {
        const expiry = creditExpiry(credit);
        const urgency = expiryUrgency(expiry, now);
        return <div className={`credit-row expiry-${urgency}`} key={credit.id}>
          <span className="credit-row-title">{credit.title || credit.id.slice(0, 12)}
            {(urgency === 'warn' || urgency === 'err') && <strong className="expiry-badge">{t(urgency === 'err' ? 'credits.urgent' : 'credits.soon')}</strong>}
          </span>
          <span className="credit-row-meta">{expiry == null ? t('credits.unknownExpiry') : resetLabel(expiry)}</span>
        </div>;
      })}</div>}
    </Section>

    <Section title={t('section.credits')}
      hint={snapshot?.credits_balance == null ? '—' : t('hint.creditBalance', { n: number(snapshot.credits_balance) })}
      meta={[{ label: t('meta.balance'), value: snapshot?.credits_balance == null ? '—' : number(snapshot.credits_balance) },
        { label: t('meta.plan'), value: snapshot?.plan || '—', muted: true }]} noDivider />
  </>;
}
