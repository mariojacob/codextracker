import { PROVIDERS, type ProviderAmount, type ProviderSnapshot } from '../../shared/providers.js';
import { weeklyBudget } from '../../shared/quota.js';
import { makeRelativeFormatter, useLocale } from '../i18n.js';
import { useNow } from '../hooks/useNow.js';
import { Section } from './Section.js';

export function ProviderCards({ snapshots, error, codex }: { snapshots: ProviderSnapshot[]; error: boolean; codex?: ReactNode }) {
  const { t } = useLocale();
  return <>
    {error && <div className="error-banner">{t('providers.loadError')}</div>}
    {(['subscription', 'api'] as const).map((category) => {
      const providers = snapshots.filter((snapshot) => PROVIDERS.find((provider) => provider.id === snapshot.id)?.category === category);
      if (!providers.length && !(category === 'subscription' && codex)) return null;
      return <div className="provider-category" key={category}>
        <h2 className="provider-group-title">{t(`providers.category.${category}`)}</h2>
        {category === 'subscription' && codex}
        {providers.map((snapshot) => <ProviderCard key={snapshot.id} snapshot={snapshot} />)}
      </div>;
    })}
  </>;
}

function ProviderCard({ snapshot }: { snapshot: ProviderSnapshot }) {
  const { t, locale } = useLocale();
  const now = useNow();
  const definition = PROVIDERS.find((provider) => provider.id === snapshot.id)!;
  const language = locale === 'de' ? 'de-AT' : 'en-GB';
  const number = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 1 });
  const relative = makeRelativeFormatter(locale);
  const date = (value: number) => new Date(value).toLocaleString(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const label = (value: string) => value.split(' · ').map((part) => {
    const key = `providers.window.${part}`;
    return t(key) === key ? part : t(key);
  }).join(' · ');
  function amountValue(row: ProviderAmount) {
    if (/^[A-Z]{3}$/.test(row.currency)) return new Intl.NumberFormat(language, { style: 'currency', currency: row.currency }).format(row.value);
    return `${row.value.toLocaleString(language, { maximumFractionDigits: 2 })} ${row.currency === 'points' ? t('providers.points') : row.currency}`;
  }
  return <section className={`provider-card provider-${snapshot.id}${snapshot.state === 'error' ? ' provider-stale' : ''}`}>
    <div className="provider-card-head"><h3>{definition.name}</h3>{snapshot.plan && <span className="header-plan">{snapshot.plan}</span>}</div>
    {snapshot.state === 'loading' && <p className="provider-note" role="status">{t('providers.loading')}</p>}
    {snapshot.error && <p className="provider-error" role="status">{t(`providers.error.${snapshot.error}`)}</p>}
    {snapshot.error && snapshot.fetched_at && <p className="provider-note">{t('providers.stale')}</p>}
    {snapshot.warnings?.map((warning) => <p className="provider-error" key={warning}>{t(`providers.warning.${warning}`)}</p>)}
    {snapshot.windows.map((window) => {
      const budget = snapshot.state === 'ready' && !snapshot.warnings?.includes('monthly_exhausted') ? weeklyBudget(100 - window.used_percent, window.reset_at, window.window_seconds, now) : null;
      const usage = t('quota.usage', { used: number(window.used_percent), left: number(100 - window.used_percent) });
      return <Section key={window.id} title={label(window.label)} hint={usage} progressLabel={usage} pct={window.used_percent}
        warn={window.used_percent > 70} err={window.used_percent > 90} currentDay={budget?.day} timeMarker={budget?.elapsedPct}
        markerLabel={budget ? t('budget.marker', { pct: number(budget.elapsedPct) }) : undefined}
        meta={[{ label: t('meta.reset'), value: window.reset_at == null ? '—' : `${date(window.reset_at)} · ${relative(window.reset_at - now)}`, muted: true },
          { label: budget ? t('budget.day', { day: budget.day }) : t('meta.left'), value: budget ? t('budget.target', { pct: number(budget.targetPct) }) : `${number(100 - window.used_percent)} %` }]}>
        {budget && <div className={`budget-info${budget.over > 0 ? ' warn' : ''}`}>
          <div>{t('budget.available', { when: date(budget.dayEnd), n: number(budget.available) })}</div>
          {budget.over > 0 && <div>{t('budget.over', { n: number(budget.over) })}</div>}
        </div>}
      </Section>;
    })}
    {!!snapshot.amounts.length && <dl className="provider-amounts">{snapshot.amounts.map((row, index) => <div key={`${row.kind}-${row.currency}-${index}`}>
      <dt>{t(`providers.amount.${row.kind}`)}{row.period && <small>{t(`providers.period.${row.period}`)}</small>}</dt>
      <dd>{amountValue(row)}{row.partial && <small className="provider-error">{t('providers.partial')}</small>}</dd>
    </div>)}</dl>}
    {snapshot.id === 'xai' && !!snapshot.amounts.length && <p className="provider-note">{t('providers.postedNote')}</p>}
    <div className="provider-card-footer"><span>{snapshot.fetched_at ? `${t('app.footer.updated')} ${date(Date.parse(snapshot.fetched_at))}` : ''}</span>
      <button className="btn-tiny" onClick={() => void window.codexAPI.openProviderDashboard(snapshot.id)}>{t('providers.dashboard')}</button></div>
  </section>;
}
import type { ReactNode } from 'react';
