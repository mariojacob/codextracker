/**
 * Main process entry point.
 *
 * Responsibilities:
 *  - Create and manage the main BrowserWindow
 *  - Create and manage the statistics BrowserWindow (separate process entry)
 *  - Manage the system tray (Phase 3)
 *  - Set up IPC handlers that the renderer calls via the preload bridge
 *  - Drive the auto-refresh loop via RefreshService
 *  - Save and restore the user's last selected plan/email from /wham/usage
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, session } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import * as path from 'node:path';
import { readCodexAuth } from './codex/auth-reader.js';
import { TokenManager } from './codex/tokens.js';
import { readHistory } from './codex/history.js';
import { computeStatistics } from './codex/stats.js';
import { RefreshService, CachedSnapshot } from './refresh-service.js';
import { loadSettings, saveSettings, Settings } from './settings.js';
import { showNotification } from './notifications.js';
import { createTray, destroyTray, updateTrayMenu } from './tray.js';
import { IPC } from '../shared/types.js';
import { assertTrustedIpcSender, validateResetCreditId, validateSettings } from './security.js';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let trayEnabled = false;
let tokenManager: TokenManager;
let refreshService: RefreshService;

app.enableSandbox();

function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

async function createMainWindow(): Promise<BrowserWindow> {
  const icoPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
  const windowIcon = nativeImage.createFromPath(icoPath);
  const win = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 380,
    minHeight: 540,
    title: 'CodexTracker',
    backgroundColor: '#0f0f10',
    autoHideMenuBar: true,
    icon: windowIcon.isEmpty() ? undefined : icoPath,
    show: false, // Show after ready-to-show to avoid white flash
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  hardenWebContents(win.webContents);

  // Taskbar/Alt-Tab should show our icon, not the Electron default.
  if (!windowIcon.isEmpty()) {
    win.setIcon(windowIcon);
  }
  app.setAppUserModelId('com.codextracker.app');

  win.once('ready-to-show', () => {
    win.show();
  });

  if (process.env.NODE_ENV === 'development' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
  }

  win.on('close', (e) => {
    // Phase 3: minimize to tray instead of quitting.
    if (trayEnabled) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

async function createStatsWindow(): Promise<BrowserWindow> {
  const icoPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
  const windowIcon = nativeImage.createFromPath(icoPath);
  const win = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'CodexTracker — Statistics',
    backgroundColor: '#0f0f10',
    autoHideMenuBar: true,
    icon: windowIcon.isEmpty() ? undefined : icoPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  hardenWebContents(win.webContents);
  if (!windowIcon.isEmpty()) {
    win.setIcon(windowIcon);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  if (process.env.NODE_ENV === 'development' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // In dev, Vite serves each HTML entry at its filename path.
    await win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}stats.html`);
  } else {
    await win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'stats.html'));
  }

  win.on('closed', () => {
    if (statsWindow === win) statsWindow = null;
  });

  return win;
}

/** Open the stats window, or focus the existing one if already open. */
async function openStatsWindow(): Promise<void> {
  if (statsWindow && !statsWindow.isDestroyed()) {
    if (statsWindow.isMinimized()) statsWindow.restore();
    statsWindow.show();
    statsWindow.focus();
    return;
  }
  statsWindow = await createStatsWindow();
}

function registerIpcHandlers(): void {
  const trusted = (event: IpcMainInvokeEvent): void => {
    assertTrustedIpcSender(event, [mainWindow, statsWindow]);
  };

  ipcMain.handle(IPC.APP_PING, (event) => {
    trusted(event);
    return { pong: true, version: app.getVersion() };
  });

  ipcMain.handle(IPC.AUTH_STATUS, async (event) => {
    trusted(event);
    return tokenManager.getStatus();
  });

  ipcMain.handle(IPC.AUTH_IMPORT_CODEX, async (event) => {
    trusted(event);
    const tokens = await readCodexAuth();
    await tokenManager.setTokens(tokens, 'codex-cli');
    // Kick off an immediate refresh
    void refreshService.refreshNow();
    return { ok: true, email: '' };
  });

  ipcMain.handle(IPC.AUTH_LOGOUT, async (event) => {
    trusted(event);
    await tokenManager.logout();
    return { ok: true };
  });

  ipcMain.handle(IPC.USAGE_FETCH, async (event) => {
    trusted(event);
    return refreshService.refreshNow();
  });

  ipcMain.handle(IPC.RESET_CREDITS_FETCH, async (event) => {
    trusted(event);
    return refreshService.refreshNow();
  });

  ipcMain.handle(IPC.RESET_REDEEM, async (event, creditId: unknown) => {
    trusted(event);
    const id = validateResetCreditId(
      creditId,
      refreshService.getSnapshot().reset_credit_details.map((credit) => credit.id),
    );
    return refreshService.redeemCredit(id);
  });

  ipcMain.handle(IPC.HISTORY_GET, async (event) => {
    trusted(event);
    return readHistory();
  });

  ipcMain.handle(IPC.SETTINGS_GET, async (event) => {
    trusted(event);
    return loadSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (event, settings: Settings) => {
    trusted(event);
    settings = validateSettings(settings);
    await saveSettings(settings);
    refreshService.updateSettings(settings);
    return { ok: true };
  });

  ipcMain.handle(IPC.STATS_GET, async (event) => {
    trusted(event);
    const history = await readHistory();
    return computeStatistics(history);
  });

  ipcMain.handle(IPC.WINDOW_OPEN_STATS, async (event) => {
    trusted(event);
    await openStatsWindow();
    return { ok: true };
  });

  ipcMain.handle(IPC.WINDOW_MINIMIZE, (event) => {
    trusted(event);
    mainWindow?.minimize();
  });

  ipcMain.handle(IPC.WINDOW_QUIT, (event) => {
    trusted(event);
    trayEnabled = false;
    destroyTray();
    app.quit();
  });
}

function wireRefreshToUI(service: RefreshService): void {
  service.on('updated', (snap: CachedSnapshot) => {
    if (trayEnabled) {
      updateTrayMenu(snap, {
        onRefresh: () => service.refreshNow(),
        onQuit: () => {
          trayEnabled = false;
          destroyTray();
          app.quit();
        },
        onShow: () => mainWindow?.show(),
      });
    }
    // Push to renderer via IPC (broadcast to all windows)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('snapshot:updated', snap);
    }
  });
}

async function initTray(): Promise<void> {
  // Phase 3: enable tray by default. User can disable via settings.json.
  trayEnabled = true;
  const initialSnap: CachedSnapshot = refreshService.getSnapshot();
  createTray(initialSnap, {
    onRefresh: () => refreshService.refreshNow(),
    onQuit: () => {
      trayEnabled = false;
      destroyTray();
      app.quit();
    },
    onShow: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
  });
}

app.whenReady().then(async () => {
  // Hide default menu bar on Windows/Linux
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  tokenManager = new TokenManager();
  await tokenManager.ready();
  refreshService = new RefreshService(tokenManager);
  wireRefreshToUI(refreshService);

  registerIpcHandlers();

  mainWindow = await createMainWindow();

  // Tray on Windows + macOS (Linux: best-effort, may fail silently)
  await initTray();

  // Start auto-refresh
  await refreshService.start();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!trayEnabled) {
      app.quit();
    }
    // If tray is enabled, keep the app alive in the background.
  }
});

app.on('before-quit', () => {
  trayEnabled = false;
  destroyTray();
  refreshService.stop();
});
