/**
 * System tray icon with quick actions and a "latest snapshot" submenu.
 * Phase 3 wires this up; defined here so main/index.ts can import.
 */
import { Menu, Tray, nativeImage } from 'electron';
import * as fs from 'node:fs';
import { CachedSnapshot } from './refresh-service.js';
import { iconPath } from './window-identity.js';

let trayInstance: Tray | null = null;
let cachedTrayIcon: Electron.NativeImage | null = null;

function trayIconImage(): Electron.NativeImage {
  if (cachedTrayIcon) return cachedTrayIcon;
  // Prefer the 32x32 ICO we ship in assets/. Fall back to a generated
  // inline PNG if the file is missing (e.g. before make-icon.mjs ran).
  const icoPath = iconPath('ico');
  try {
    if (fs.existsSync(icoPath)) {
      const img = nativeImage.createFromPath(icoPath);
      if (!img.isEmpty()) {
        cachedTrayIcon = img;
        return cachedTrayIcon;
      }
    }
  } catch (err) {
    console.warn('Tray icon load failed, using fallback:', err);
  }
  // Fallback: 16x16 solid green PNG so the tray slot is never empty/transparent.
  const fallback = nativeImage.createFromBuffer(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUklEQVR4nO3OMQ0AIAwAsLkBxxiB' +
    '+BJBmNR9L5ZK7km9dwAAAAAAAAAAAAAAAAAAAAAAAOD/m/4DOg4EjZQk1zwAAAAASUVORK5CYII=',
    'base64'));
  cachedTrayIcon = fallback;
  return cachedTrayIcon;
}

function buildMenu(snap: CachedSnapshot, onRefresh: () => void, onQuit: () => void, onShow: () => void, codexEnabled: boolean): Menu {
  // null = API didn't supply this window this tick; show "—" instead of "100%".
  const sessLabel = snap.session_pct_left != null
    ? `${snap.session_pct_left.toFixed(0)}%`
    : '—';
  const wkLabel = snap.weekly_pct_left != null
    ? `${snap.weekly_pct_left.toFixed(0)}%`
    : '—';
  return Menu.buildFromTemplate([
    { label: 'CodexTracker', enabled: false },
    { type: 'separator' },
    {
      label: !codexEnabled ? 'ChatGPT / Codex disabled' : snap.email ? `ChatGPT / Codex: ${snap.email}` : 'ChatGPT / Codex: Not signed in',
      enabled: false,
    },
    {
      label: snap.plan ? `Plan: ${snap.plan}` : '',
      enabled: false,
      visible: codexEnabled && snap.plan.length > 0,
    },
    { type: 'separator' },
    {
      label: `Session: ${sessLabel} left (${snap.session_reset_in})`,
      enabled: false,
      visible: codexEnabled && snap.session_window_available,
    },
    {
      label: `Weekly: ${wkLabel} left (${snap.weekly_reset_in})`,
      enabled: false,
      visible: codexEnabled,
    },
    {
      label: snap.credits_balance != null
        ? `Credits: ${snap.credits_balance}`
        : 'Credits: —',
      enabled: false,
      visible: codexEnabled,
    },
    {
      label: `Reset credits: ${snap.reset_credits_available}`,
      enabled: false,
      visible: codexEnabled,
    },
    { type: 'separator' },
    { label: 'Refresh now', click: () => onRefresh() },
    { label: 'Show window', click: () => onShow() },
    { type: 'separator' },
    { label: 'Quit', click: () => onQuit() },
  ]);
}

export interface TrayCallbacks {
  codexEnabled: boolean;
  onRefresh: () => void;
  onQuit: () => void;
  onShow: () => void;
}

export function createTray(snap: CachedSnapshot, callbacks: TrayCallbacks): Tray | null {
  if (trayInstance) return trayInstance;
  try {
    trayInstance = new Tray(trayIconImage());
    trayInstance.setToolTip('CodexTracker');
    trayInstance.setContextMenu(buildMenu(snap, callbacks.onRefresh, callbacks.onQuit, callbacks.onShow, callbacks.codexEnabled));
    trayInstance.on('double-click', () => callbacks.onShow());
    return trayInstance;
  } catch (err) {
    console.error('Failed to create tray:', err);
    return null;
  }
}

export function updateTrayMenu(snap: CachedSnapshot, callbacks: TrayCallbacks): void {
  if (!trayInstance) return;
  trayInstance.setContextMenu(buildMenu(snap, callbacks.onRefresh, callbacks.onQuit, callbacks.onShow, callbacks.codexEnabled));
  // null = API didn't supply a window this tick; show "—" instead of "100%".
  const wkLabel = snap.weekly_pct_left != null ? `${snap.weekly_pct_left.toFixed(0)}%` : '—';
  const tooltip = !callbacks.codexEnabled ? 'CodexTracker' : snap.error
    ? `CodexTracker: error`
    : snap.session_window_available
      ? (() => {
          const sessLabel = snap.session_pct_left != null ? `${snap.session_pct_left.toFixed(0)}%` : '—';
          return `CodexTracker: Session ${sessLabel}, Weekly ${wkLabel}`;
        })()
      : `CodexTracker: Weekly ${wkLabel}`;
  trayInstance.setToolTip(tooltip);
}

export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}
