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
import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import * as path from 'node:path';
import { readCodexAuth } from './codex/auth-reader.js';
import { TokenManager } from './codex/tokens.js';
import { readHistory } from './codex/history.js';
import { statisticsReport } from './providers/statistics-report.js';
import { ProviderHistoryStore, type ProviderMeasurement } from './providers/history.js';
import { RefreshService, CachedSnapshot } from './refresh-service.js';
import { loadSettings, saveSettings, Settings } from './settings.js';
import { showNotification } from './notifications.js';
import { createTray, destroyTray, updateTrayMenu } from './tray.js';
import { IPC } from '../shared/types.js';
import { assertTrustedIpcSender, validateProviderId, validateResetCreditId, validateSettings, validateStatisticsSelection } from './security.js';
import { ProviderService } from './providers/service.js';
import { ProviderFetchError } from './providers/errors.js';
import { PROVIDERS, type ProviderId, type ProviderRegion } from '../shared/providers.js';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let trayEnabled = false;
let tokenManager: TokenManager;
const providerHistory = new ProviderHistoryStore();

function statisticsUpdated(): void {
  if (statsWindow && !statsWindow.isDestroyed()) statsWindow.webContents.send('stats:updated');
}
let refreshService: RefreshService;
let providerService: ProviderService;

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
    if (!(await loadSettings()).codex_enabled) throw new Error('Codex monitoring is disabled.');
    const tokens = await readCodexAuth();
    await tokenManager.setTokens(tokens, 'codex-cli');
    // Kick off an immediate refresh
    void refreshService.refreshNow();
    return { ok: true, email: '' };
  });

  ipcMain.handle(IPC.AUTH_LOGOUT, async (event) => {
    trusted(event);
    await tokenManager.logout();
    refreshService.clearSnapshot();
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
    providerService.updateSettings(settings);
    statisticsUpdated();
    return { ok: true };
  });

  ipcMain.handle(IPC.PROVIDERS_GET, (event) => { trusted(event); return providerService.getSnapshots(); });
  ipcMain.handle(IPC.PROVIDERS_REFRESH, (event, rawId?: unknown) => { trusted(event); return providerService.refresh(rawId === undefined ? undefined : validateProviderId(rawId)); });
  ipcMain.handle(IPC.PROVIDERS_CONNECTIONS, (event) => { trusted(event); return providerService.connections(); });
  const providerAction = (operation: (id: ReturnType<typeof validateProviderId>, value: unknown) => Promise<void>) =>
    async (event: IpcMainInvokeEvent, rawId: unknown, value?: unknown) => {
      trusted(event);
      const id = validateProviderId(rawId);
      try { await operation(id, value); return { ok: true as const, error: null }; }
      catch (error) { return { ok: false as const, error: error instanceof ProviderFetchError ? error.code : 'keyring' }; }
    };
  ipcMain.handle(IPC.PROVIDER_SAVE_CREDENTIAL, providerAction((id, value) => providerService.setCredential(id, value)));
  ipcMain.handle(IPC.PROVIDER_IMPORT_CREDENTIAL, providerAction((id) => providerService.importCredential(id)));
  ipcMain.handle(IPC.PROVIDER_REMOVE_CREDENTIAL, providerAction((id) => providerService.removeCredential(id)));
  ipcMain.handle(IPC.PROVIDER_OPEN_DASHBOARD, async (event, rawId: unknown) => {
    trusted(event);
    const id = validateProviderId(rawId);
    const definition = PROVIDERS.find((provider) => provider.id === id)!;
    const settings = await loadSettings();
    const region = settings.providers.find((provider) => provider.id === id)?.region;
    await shell.openExternal(region === 'china' && definition.chinaDashboard ? definition.chinaDashboard : definition.dashboard);
    return { ok: true };
  });

  ipcMain.handle(IPC.STATS_GET, async (event, rawSelection: unknown) => {
    trusted(event);
    const selection = validateStatisticsSelection(rawSelection);
    const [history, settings] = await Promise.all([readHistory(), loadSettings()]);
    return statisticsReport(selection, settings, refreshService.getSnapshot(), history, providerHistory);
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
        codexEnabled: service.isEnabled(),
        onRefresh: () => { void Promise.allSettled([service.refreshNow(), providerService.refresh()]); },
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
    if (statsWindow && !statsWindow.isDestroyed()) {
      statsWindow.webContents.send('snapshot:updated', snap);
      statisticsUpdated();
    }
  });
}

async function initTray(): Promise<void> {
  // Phase 3: enable tray by default. User can disable via settings.json.
  trayEnabled = true;
  const initialSnap: CachedSnapshot = refreshService.getSnapshot();
  createTray(initialSnap, {
    codexEnabled: (await loadSettings()).codex_enabled,
    onRefresh: () => { void Promise.allSettled([refreshService.refreshNow(), providerService.refresh()]); },
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
  providerService = new ProviderService();
  providerService.on('connection-changed', (id: ProviderId, region: ProviderRegion) => {
    void providerHistory.rotate(id, region).then(statisticsUpdated).catch(() => console.error('Could not update provider history context.'));
  });
  providerService.on('measurement', (measurement: ProviderMeasurement) => {
    void providerHistory.record(measurement).then(statisticsUpdated).catch(() => console.error('Could not save provider history.'));
  });
  providerService.on('updated', (snapshots) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('providers:updated', snapshots);
  });
  wireRefreshToUI(refreshService);

  registerIpcHandlers();

  mainWindow = await createMainWindow();

  // Tray on Windows + macOS (Linux: best-effort, may fail silently)
  await initTray();

  // Start auto-refresh
  await refreshService.start();
  providerService.start(await loadSettings());

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
  providerService.stop();
});
