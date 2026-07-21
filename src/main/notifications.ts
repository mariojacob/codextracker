/**
 * Wraps Electron's Notification API for cross-platform toasts.
 * Phase 5 will hook this into the auto-refresh loop.
 */
import { Notification, nativeImage } from 'electron';
import * as path from 'node:path';

export function showNotification(opts: {
  title: string;
  body: string;
  silent?: boolean;
}): void {
  if (!Notification.isSupported()) {
    // Headless / Linux without libnotify: fall back to console
    console.log(`[Notification] ${opts.title}: ${opts.body}`);
    return;
  }
  const n = new Notification({
    title: opts.title,
    body: opts.body,
    silent: opts.silent ?? false,
    // Use bundled app icon if available; Electron falls back to default
    icon: undefined,
  });
  n.show();
}

/**
 * Tracks which notifications have already been shown in the current
 * "session" (process lifetime), so we don't spam the user every 60s
 * when their session is below threshold.
 */
class NotifDeduper {
  private sent = new Set<string>();

  /** Returns true if we should send this notification. */
  shouldSend(key: string): boolean {
    if (this.sent.has(key)) return false;
    this.sent.add(key);
    return true;
  }

  /** Call when a value recovers above the threshold (so we re-fire next time). */
  reset(key: string): void {
    this.sent.delete(key);
  }

  resetAll(): void {
    this.sent.clear();
  }
}

export const notifDeduper = new NotifDeduper();
