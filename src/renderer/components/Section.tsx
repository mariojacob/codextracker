/**
 * Section: a compact, borderless row used for each metric in the main view.
 *
 * Layout:
 *   [Title (left) .............. Hint (right)]
 *   [==== thin bar ====]                       (optional)
 *   [Label / value ]   [Label / value]
 *
 * Replaces the old "Card" component — same data, denser visual.
 */
import { ReactNode } from 'react';

export interface MetaPair {
  label: string;
  value: ReactNode;
  /** Render value in muted text color (no bold). */
  muted?: boolean;
}

interface Props {
  title: string;
  /** Optional right-aligned hint on the title row (e.g. an absolute counter). */
  hint?: ReactNode;
  /** 0..100 — when null/undefined the bar is omitted. */
  pct?: number | null;
  /** Visual state for the bar. */
  warn?: boolean;
  err?: boolean;
  /** Position of the red "depleted-threshold" marker on the bar, in 0..100. */
  depletedAt?: number | null;
  /** Two-column meta line under the bar. */
  meta?: [MetaPair, MetaPair];
  /** Bottom area for arbitrary content (e.g. reset-credit sub-rows). */
  children?: ReactNode;
  /** Hide the bottom divider for the last section in a list. */
  noDivider?: boolean;
}

export function Section({
  title,
  hint,
  pct,
  warn,
  err,
  depletedAt,
  meta,
  children,
  noDivider,
}: Props) {
  const stateClass = err ? 'err' : warn ? 'warn' : '';
  const fillPct = pct == null ? null : Math.max(0, Math.min(100, pct));

  return (
    <section className={`section${noDivider ? ' no-divider' : ''}`}>
      <div className="section-head">
        <span className="section-title">{title}</span>
        {hint != null && <span className="section-head-hint">{hint}</span>}
      </div>

      {fillPct != null && (
        <div
          className="bar"
          style={depletedAt != null ? ({ '--depleted': `${Math.max(0, Math.min(100, depletedAt))}` } as React.CSSProperties) : undefined}
        >
          <div className={`bar-fill ${stateClass}`} style={{ width: `${fillPct}%` }} />
        </div>
      )}

      {meta && (
        <div className="section-grid">
          <div>
            <span className="grid-label">{meta[0].label}</span>
            <span className={`grid-value${meta[0].muted ? ' muted' : ''}`}>{meta[0].value}</span>
          </div>
          <div>
            <span className="grid-label">{meta[1].label}</span>
            <span className={`grid-value${meta[1].muted ? ' muted' : ''}`}>{meta[1].value}</span>
          </div>
        </div>
      )}

      {children}
    </section>
  );
}
