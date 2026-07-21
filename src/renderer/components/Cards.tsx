/**
 * Renders the primary metric sections.
 *   1) Session          (left + reset timer) — hidden when 5h limit disabled
 *   2) Weekly           (left + reset timer + sparkline)
 *   3) Reset Forecast   (external 48h reset likelihood + recent changes)
 *   4) Limit-Reset Credits (count + next expiry + sub-list + session bars)
 *   5) Credits          (balance + recent trend)
 *
 * Each is a flat Section, no Card borders, no large headline percentages.
 * All visible strings come from the i18n dictionary.
 */
import { useMemo } from 'react';
import { Section } from './Section.js';
import { useCodexData } from '../hooks/useCodexData.js';
import { useLocale, makeRelativeFormatter } from '../i18n.js';
import type { ForecastSnapshot, ResetCreditEntry } from '../../shared/types.js';

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function nextExpiringCredit(credits: ResetCreditEntry[]): ResetCreditEntry | null {
  const now = Date.now();
  return (
    credits
      .filter((c) => c.status === 'available' && c.expires_at)
      .filter((c) => Date.parse(c.expires_at!) > now)
      .sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!))[0] ?? null
  );
}

/** Absolute time formatted short: "Mo 04.07. 23:45" (de) or "Su 07/04 23:45" (en). */
function fmtAbsolute(epochMs: number | null | undefined, locale: 'en' | 'de'): string {
  if (epochMs == null || isNaN(epochMs)) return '—';
  const d = new Date(epochMs);
  if (locale === 'de') {
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
    const day = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${wd} ${day}.${mo}. ${hh}:${mm}`;
  }
  // en: Sun 07/04 23:45
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${wd} ${mo}/${day} ${hh}:${mm}`;
}

/** Combined: "Mo 04.07. 23:45 · in 2 Std. 30 Min." */
function fmtResetCombo(
  epochMs: number | null | undefined,
  relative: string,
  locale: 'en' | 'de',
): string {
  if (relative === '—' || relative === 'abgelaufen' || relative === 'expired') return relative;
  return `${fmtAbsolute(epochMs, locale)} · ${relative}`;
}

export function Cards() {
  const { t, locale } = useLocale();
  const { snapshot } = useCodexData();

  const sessPct = snapshot?.session_pct_left ?? null;
  const wkPct = snapshot?.weekly_pct_left ?? null;
  const sessWarn = sessPct != null && sessPct < 30;
  const sessErr = sessPct != null && sessPct < 10;
  const wkWarn = wkPct != null && wkPct < 30;
  const wkErr = wkPct != null && wkPct < 10;
  const forecast = snapshot?.forecast ?? null;
  const forecastScore = forecast?.score ?? null;
  const forecastErr = snapshot?.forecast_error ?? null;

  const formatRelative = useMemo(() => makeRelativeFormatter(locale), [locale]);

  return (
    <>
      {snapshot?.error && <div className="error-banner">{snapshot.error}</div>}

      {snapshot?.session_window_available && (
        <Section
          title={t('section.session')}
          hint={snapshot?.session_reset_at ? fmtAbsolute(snapshot.session_reset_at, locale) : '—'}
          pct={sessPct}
          warn={sessWarn}
          err={sessErr}
          meta={[
            {
              label: t('meta.left'),
              value: sessPct == null ? '—' : `${Math.round(sessPct)} %`,
            },
            {
              label: t('meta.reset'),
              value: fmtResetCombo(snapshot?.session_reset_at, snapshot?.session_reset_in ?? '—', locale),
              muted: true,
            },
          ]}
        />
      )}

      <Section
        title={t('section.weekly')}
        hint={snapshot?.weekly_reset_at ? fmtAbsolute(snapshot.weekly_reset_at, locale) : '—'}
        pct={wkPct}
        warn={wkWarn}
        err={wkErr}
        meta={[
          {
            label: t('meta.left'),
            value: wkPct == null ? '—' : `${Math.round(wkPct)} %`,
          },
          {
            label: t('meta.reset'),
            value: fmtResetCombo(snapshot?.weekly_reset_at, snapshot?.weekly_reset_in ?? '—', locale),
            muted: true,
          },
        ]}
      />

      <ForecastSection
        forecast={forecast}
        forecastErr={forecastErr}
        score={forecastScore}
      />

      <Section
        title={t('section.resetCredits')}
        hint={
          snapshot?.reset_credits_available != null
            ? t('hint.available', { n: snapshot.reset_credits_available })
            : '—'
        }
        meta={[
          {
            label: t('meta.nextExpiry'),
            value: (() => {
              const next = nextExpiringCredit(snapshot?.reset_credit_details ?? []);
              if (!next?.expires_at) return '—';
              const ms = Date.parse(next.expires_at) - Date.now();
              const rel = formatRelative(ms);
              return fmtResetCombo(Date.parse(next.expires_at), rel, locale);
            })(),
          },
          { label: t('meta.plan'), value: snapshot?.plan || '—', muted: true },
        ]}
      >
        {snapshot?.reset_credit_details && snapshot.reset_credit_details.length > 0 && (
          <ResetCreditList
            credits={snapshot.reset_credit_details}
            formatRelative={formatRelative}
            locale={locale}
          />
        )}
      </Section>

      <Section
        title={t('section.credits')}
        hint={
          snapshot?.credits_balance != null
            ? t('hint.tokens', { n: fmtCount(snapshot.credits_balance) })
            : '—'
        }
        meta={[
          { label: t('meta.balance'), value: snapshot?.credits_balance != null ? fmtCount(snapshot.credits_balance) : '—', muted: true },
          { label: t('meta.plan'), value: snapshot?.plan || '—', muted: true },
        ]}
        noDivider
      />
    </>
  );
}

function ResetCreditList({
  credits,
  formatRelative,
  locale,
}: {
  credits: ResetCreditEntry[];
  formatRelative: (ms: number) => string;
  locale: 'en' | 'de';
}) {
  const { t } = useLocale();
  const now = Date.now();
  const available = credits.filter(
    (c) => c.status === 'available' && (!c.expires_at || Date.parse(c.expires_at) > now),
  );

  if (available.length === 0) return null;

  return (
    <div className="credits-list">
      {available.map((c) => {
        const ts = c.expires_at ? Date.parse(c.expires_at) : NaN;
        const rel = !isNaN(ts) ? formatRelative(ts - now) : '';
        return (
          <div className="credit-row" key={c.id}>
            <span className="credit-row-title">{c.title || c.id.slice(0, 12)}</span>
            {c.expires_at && !isNaN(ts) && (
              <span
                className="credit-row-meta"
                title={t('hint.expiresAt', { when: fmtAbsolute(ts, locale) })}
              >
                {fmtAbsolute(ts, locale)} · {rel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * ForecastSection: external "will Codex reset?" signal from
 * willcodexquotareset.com. Shows the score (0..100) plus the top few
 * recent score changes. Hidden entirely until the first successful fetch.
 */
function ForecastSection({
  forecast,
  forecastErr,
  score,
}: {
  forecast: ForecastSnapshot | null;
  forecastErr: string | null;
  score: number | null;
}) {
  const { t, locale } = useLocale();
  const haveData = score != null;

  if (!haveData && !forecastErr) {
    // Don't render anything until the first fetch lands — avoids an
    // empty section flickering on app start.
    return null;
  }

  const warn = score != null && score >= 48 && score < 72;
  const err = score != null && score >= 72;
  const sinceDays = forecast?.days_since_reset ?? null;
  const sinceLabel =
    sinceDays == null
      ? '—'
      : sinceDays === 0
        ? t('time.expired') === 'abgelaufen' ? 'heute' : 'today'
        : locale === 'de'
          ? `vor ${sinceDays} T.`
          : `${sinceDays}d ago`;
  const metaRight = forecast?.reset_announced
    ? t('meta.forecastAnnounced')
    : t('meta.forecastHorizon');

  return (
    <Section
      title={t('section.forecast')}
      hint={t('meta.forecastHorizon')}
      pct={score}
      warn={warn}
      err={err}
      meta={[
        {
          label: t('meta.forecastScore'),
          value: score == null ? '—' : `${Math.round(score)} %`,
        },
        {
          label: t('meta.forecastSince'),
          value: sinceLabel,
          muted: true,
        },
      ]}
    >
      {forecast?.reset_announced && (
        <div className="forecast-banner announced">{metaRight}</div>
      )}
      {forecast && forecast.recent_changes.length > 0 && (
        <ForecastChanges changes={forecast.recent_changes} />
      )}
      {forecastErr && !haveData && (
        <div className="forecast-banner error">
          {t('meta.forecastUnavailable')} · {forecastErr}
        </div>
      )}
    </Section>
  );
}

function ForecastChanges({
  changes,
}: {
  changes: ForecastSnapshot['recent_changes'];
}) {
  return (
    <div className="forecast-changes">
      {changes.map((c, i) => {
        const sign = c.delta > 0 ? '+' : '';
        return (
          <div className="forecast-change-row" key={`${c.at}-${i}`}>
            <span className={`forecast-change-delta ${c.delta > 0 ? 'pos' : 'neg'}`}>
              {sign}
              {c.delta}
            </span>
            <span className="forecast-change-label">{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}
