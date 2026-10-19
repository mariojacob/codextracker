/**
 * History storage: appends one snapshot per refresh to a rolling 30-day
 * JSONL file. Records fresh API measurements for observed consumption.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistorySnapshot } from '../../shared/types.js';

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
  // Retain by age: a fast refresh interval must not truncate the 30-day window.
  const cutoff = Date.now() - MAX_DAYS * 86400 * 1000;
  const recent = lines.filter((line) => {
    try { return Date.parse(JSON.parse(line).timestamp) >= cutoff; }
    catch { return false; }
  });
  if (recent.length === lines.length) return;
  const trimmed = recent.join('\n') + '\n';
  await fs.writeFile(file, trimmed, 'utf-8');
}
