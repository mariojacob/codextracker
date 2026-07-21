/**
 * History storage: appends one snapshot per refresh to a rolling 30-day
 * JSONL file. Used by the Sparkline cards in Phase 4.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistorySnapshot, RateWindow } from '../../shared/types.js';

export type { HistorySnapshot };

function historyPath(): string {
  return path.join(os.homedir(), '.codex-tracker', 'history.jsonl');
}

const MAX_DAYS = 30;

export async function appendSnapshot(snap: HistorySnapshot): Promise<void> {
  const file = historyPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(snap) + '\n', 'utf-8');
  await pruneIfNeeded();
}

/** Read recent snapshots (oldest first). Stops at MAX_DAYS. */
export async function readHistory(): Promise<HistorySnapshot[]> {
  const file = historyPath();
  let lines: string[];
  try {
    const raw = await fs.readFile(file, 'utf-8');
    lines = raw.split('\n').filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }

  const cutoff = Date.now() - MAX_DAYS * 86400 * 1000;
  const out: HistorySnapshot[] = [];
  for (const line of lines) {
    try {
      const snap = JSON.parse(line) as HistorySnapshot;
      if (Date.parse(snap.timestamp) >= cutoff) {
        out.push(snap);
      }
    } catch {
      // Skip malformed lines (e.g. partial writes)
    }
  }
  return out;
}

async function pruneIfNeeded(): Promise<void> {
  // Cheap: just read and rewrite. 30 days of data at 1 refresh/minute
  // is ~43k lines, which is small. If perf becomes an issue, switch to
  // a size-based check.
  const file = historyPath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    return;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 50000) return; // Plenty of headroom, skip rewrite
  // Keep last 80% of lines
  const keep = Math.floor(lines.length * 0.8);
  const trimmed = lines.slice(lines.length - keep).join('\n') + '\n';
  await fs.writeFile(file, trimmed, 'utf-8');
}

/** Pull `pct_left` from a window with graceful fallback. */
export function windowPctLeft(w: RateWindow | null | undefined): number {
  if (!w || typeof w.used_percent !== 'number') return 100;
  return Math.max(0, 100 - w.used_percent);
}
