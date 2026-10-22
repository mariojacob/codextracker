import { PROVIDERS, type ProviderAmount, type ProviderSnapshot } from '../../shared/providers.js';
import { weeklyBudget } from '../../shared/quota.js';
import { makeRelativeFormatter, useLocale } from '../i18n.js';
import { useNow } from '../hooks/useNow.js';
import { Section } from './Section.js';
import { useState, type ReactNode } from 'react';
import { moduleOrder, type ModuleId } from '../../shared/modules.js';

interface Props {
  snapshots: ProviderSnapshot[];
  error: boolean;
  codex?: ((controls: ReactNode) => ReactNode) | null;
  order: ModuleId[];
  onMove: (source: ModuleId, target: ModuleId) => Promise<void>;
  saving: boolean;
}

export function ProviderCards({ snapshots, error, codex, order, onMove, saving }: Props) {
  const { t } = useLocale();
  const [dragging, setDragging] = useState<ModuleId | null>(null);
  const [dropTarget, setDropTarget] = useState<ModuleId | null>(null);
  const visible = moduleOrder(order).filter((id) => id === 'codex' ? !!codex : snapshots.some((snapshot) => snapshot.id === id));
  const category = (id: ModuleId) => id === 'codex' ? 'subscription' : PROVIDERS.find((provider) => provider.id === id)!.category;
  function clearDrag() { setDragging(null); setDropTarget(null); }
  return <>
    {error && <div className="error-banner">{t('providers.loadError')}</div>}
    {visible.map((id, index) => {
      const name = id === 'codex' ? 'ChatGPT / Codex' : PROVIDERS.find((provider) => provider.id === id)!.name;
      const controls = visible.length > 1 && <div className="module-order-controls">
        <span className="module-drag-handle" draggable={!saving} title={t('modules.drag', { name })} aria-hidden="true"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            setDragging(id);
          }} onDragEnd={clearDrag}>⠿</span>
        <button type="button" className="icon-btn" disabled={saving || index === 0}
          title={t('modules.up', { name })} aria-label={t('modules.up', { name })}
          onClick={() => void onMove(id, visible[index - 1])}>↑</button>
        <button type="button" className="icon-btn" disabled={saving || index === visible.length - 1}
          title={t('modules.down', { name })} aria-label={t('modules.down', { name })}
          onClick={() => void onMove(id, visible[index + 1])}>↓</button>
      </div>;
      const dropPosition = dragging && visible.indexOf(dragging) < index ? 'after' : 'before';
      return <div className={`module-slot${dragging === id ? ' module-dragging' : ''}${dropTarget === id ? ` module-drop-${dropPosition}` : ''}`} key={id}
        aria-busy={saving}
        onDragOver={(event) => {
          if (!saving && dragging && dragging !== id && visible.includes(dragging)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget(id);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!saving && dragging && visible.includes(dragging)) void onMove(dragging, id);
          clearDrag();
        }}>
        {(index === 0 || category(visible[index - 1]) !== category(id)) &&
          <h2 className="provider-group-title">{t(`providers.category.${category(id)}`)}</h2>}
        {id === 'codex' ? codex?.(controls) : <ProviderCard snapshot={snapshots.find((snapshot) => snapshot.id === id)!} controls={controls} />}
      </div>;
    })}
  </>;
}

function ProviderCard({ snapshot, controls }: { snapshot: ProviderSnapshot; controls: ReactNode }) {
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
    <div className="provider-card-head"><h3>{definition.name}</h3>{snapshot.plan && <span className="header-plan">{snapshot.plan}</span>}{controls}</div>
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
