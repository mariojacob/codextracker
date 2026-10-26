import { Section } from './Section.js';
import { useLocale, makeRelativeFormatter } from '../i18n.js';
import { useNow } from '../hooks/useNow.js';
import { availableResetCredits, creditExpiry, expiryUrgency } from '../../shared/quota.js';
import { ManualResetControl, type SaveManualReset } from './ManualResetControl.js';
import { QuotaSection } from './QuotaSection.js';
import { bankedResetPlan, type ManualReset, type ResetWindow } from '../../shared/manual-reset.js';
import type { CachedSnapshot, Language } from '../../shared/types.js';

function absolute(timestamp: number | null | undefined, locale: Language): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function Cards({ snapshot, manualReset, bankedBudget = false, onManualReset, saving }: {
  snapshot: CachedSnapshot | null; manualReset?: ManualReset; bankedBudget?: boolean; onManualReset: SaveManualReset; saving: boolean;
}) {
  const { t, locale } = useLocale();
  const now = useNow();
  const number = (n: number) => n.toLocaleString(locale === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 1 });
  const relative = makeRelativeFormatter(locale);
  const resetLabel = (timestamp: number | null | undefined) => timestamp == null ? '—' : `${absolute(timestamp, locale)} · ${relative(timestamp - now)}`;
  const windows: ResetWindow[] = [
    { id: 'weekly', label: t('section.weekly'), used_percent: snapshot?.weekly_pct_left == null ? null : 100 - snapshot.weekly_pct_left,
      reset_at: snapshot?.weekly_reset_at ?? null, window_seconds: snapshot?.weekly_window_seconds ?? null },
    ...(snapshot?.session_window_available ? [{ id: 'session', label: t('section.session'), used_percent: snapshot.session_pct_left == null ? null : 100 - snapshot.session_pct_left,
      reset_at: snapshot.session_reset_at, window_seconds: 18_000 }] : []),
  ];
  const credits = availableResetCredits(snapshot?.reset_credit_details ?? [], now);
  const nextExpiry = credits.map(creditExpiry).find((expiry) => expiry != null) ?? null;
  const nextUrgency = expiryUrgency(nextExpiry, now);
  const bankedPlan = bankedBudget ? bankedResetPlan(windows[0], credits, now) : undefined;
  return <>
    {snapshot?.error && <div className="error-banner">{snapshot.error}</div>}
    <ManualResetControl windows={windows} value={manualReset} onSave={onManualReset} disabled={saving}
      bankedReset={{ selected: bankedBudget, resetAt: nextExpiry }} />
    {windows.slice().reverse().map((quota) => <QuotaSection key={quota.id} quota={quota} manualReset={bankedBudget ? bankedPlan : manualReset}
      planningLabel={bankedBudget ? t('banked.deadline') : undefined} budgetNote={bankedBudget ? t('banked.budgetNote') : undefined}
      credits={quota.id === 'weekly' ? credits : []} showUnavailable={quota.id === 'weekly'} />)}

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
