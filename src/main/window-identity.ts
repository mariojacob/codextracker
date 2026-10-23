import { app, nativeImage, type BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

// Keep this stable: Explorer associates taskbar groups and their cached icons with it.
export const APP_ID = 'com.codextracker.desktop';
let persistentIcon: string | undefined;

/** Windows shell APIs need real files, outside the application's ASAR archive. */
export function iconPath(extension: 'png' | 'ico'): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, 'assets', `icon.${extension}`);
}

export function windowIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(iconPath('png'));
}

/** Explorer retains taskbar resources beyond the lifetime of a portable extraction. */
export async function prepareWindowIdentity(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const data = await fs.readFile(iconPath('ico'));
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const directory = path.join(os.homedir(), '.codex-tracker', 'shell');
    const file = path.join(directory, `CodexTracker-${hash}.ico`);
    await fs.mkdir(directory, { recursive: true });
    try { await fs.writeFile(file, data, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    persistentIcon = file;
  } catch {
    // The real bundled ICO still works while this process is running.
    console.warn('Could not retain the Windows taskbar icon; using bundled icon.');
  }
}

export function setWindowIdentity(win: BrowserWindow): void {
  const image = windowIcon();
  // A portable app runs from a temporary directory. Pin/relaunch the original EXE.
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  if (process.platform === 'win32') win.setAppDetails({
    appId: APP_ID,
    appIconPath: persistentIcon ?? iconPath('ico'),
    appIconIndex: 0,
    ...(app.isPackaged ? { relaunchCommand: `"${executable}"`, relaunchDisplayName: 'CodexTracker' } : {}),
  });
  // Refresh the window icon after shell metadata, including when shown from the tray.
  if (!image.isEmpty()) win.setIcon(image);
}
