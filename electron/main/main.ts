import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray
} from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  effectLabels,
  isTrailEffect,
  mergeConfig,
  nextTrailEffect,
  trailEffects,
  unionRects
} from "../../shared/config.js";
import type {
  CursorPosition,
  CursorSnapshot,
  Rect,
  TrailCommand,
  TrailConfig,
  TrailEffectId
} from "../../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let config: TrailConfig = defaultConfig;
let enabled = defaultConfig.enabled;
let currentEffect: TrailEffectId = defaultConfig.effect;
let interactive = !defaultConfig.clickThroughDefault;
let cursorTimer: NodeJS.Timeout | undefined;

const allowedDevServerUrl = "http://127.0.0.1:5173";
const isDev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL === allowedDevServerUrl;

function getUserConfigPath(): string {
  return join(app.getPath("userData"), "config.json");
}

async function loadConfig(): Promise<TrailConfig> {
  try {
    const raw = await readFile(getUserConfigPath(), "utf8");
    return mergeConfig(JSON.parse(raw) as Partial<TrailConfig>);
  } catch {
    try {
      const raw = await readFile(join(app.getAppPath(), "config", "default.json"), "utf8");
      return mergeConfig(JSON.parse(raw) as Partial<TrailConfig>);
    } catch {
      return defaultConfig;
    }
  }
}

async function saveConfig(nextConfig: TrailConfig): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(getUserConfigPath(), JSON.stringify(nextConfig, null, 2), "utf8");
}

function getDisplayRects(): Rect[] {
  return screen.getAllDisplays().map((display) => display.bounds);
}

function getOverlayBounds(): Rect {
  return unionRects(getDisplayRects());
}

function getCursorSnapshot(): CursorSnapshot {
  return {
    cursor: screen.getCursorScreenPoint(),
    overlayBounds: getOverlayBounds(),
    displays: getDisplayRects(),
    interactive,
    enabled,
    effect: currentEffect
  };
}

function sendCommand(command: TrailCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("trail:command", command);
  }
}

function getAllowedRendererUrls(): string[] {
  if (isDev) {
    return [allowedDevServerUrl + "/", allowedDevServerUrl];
  }
  const appPath = app.getAppPath().replace(/\\/g, "/");
  const rendererBase = `file:///${appPath}/dist/renderer/`;
  return [rendererBase];
}

function normalizeUrlForTrust(url: string): string {
  try {
    return decodeURI(url).replace(/\\/g, "/");
  } catch {
    return url.replace(/\\/g, "/");
  }
}

function isTrustedSender(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const normalizedUrl = normalizeUrlForTrust(url);
  const allowed = getAllowedRendererUrls().map(normalizeUrlForTrust);
  return allowed.some((base) => normalizedUrl === base || normalizedUrl.startsWith(base));
}

function getAssetPath(fileName: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "assets", fileName);
  }
  return join(app.getAppPath(), "assets", fileName);
}

function applyOverlayBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const overlayBounds = getOverlayBounds();
  mainWindow.setBounds(overlayBounds, false);
  sendCommand({ type: "overlay-bounds-changed", overlayBounds });
}

function setInteractive(nextInteractive: boolean): void {
  interactive = nextInteractive;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }
  sendCommand({ type: "interactive-changed", interactive });
  updateTrayMenu();
}

function setEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
  config = { ...config, enabled };
  void saveConfig(config).catch(console.error);
  sendCommand({ type: "enabled-changed", enabled });
  updateTrayMenu();
}

function setEffect(effect: TrailEffectId): void {
  currentEffect = effect;
  config = { ...config, effect };
  void saveConfig(config).catch(console.error);
  sendCommand({ type: "effect-changed", effect });
  updateTrayMenu();
}

function switchToNextEffect(): TrailEffectId {
  const effect = nextTrailEffect(currentEffect);
  setEffect(effect);
  return effect;
}

function restartCursorLoop(): void {
  if (cursorTimer) {
    clearTimeout(cursorTimer);
    cursorTimer = undefined;
  }
  startCursorLoop();
}

function applyNewConfig(nextConfig: TrailConfig): void {
  config = nextConfig;
  currentEffect = nextConfig.effect;
  enabled = nextConfig.enabled;
  interactive = !nextConfig.clickThroughDefault;

  // Push the full config first so the renderer updates opacity, lineWidth,
  // color, trailLength, particleCount, secondaryColor, etc. in one shot.
  sendCommand({ type: "config-changed", config: nextConfig });
  sendCommand({ type: "enabled-changed", enabled });
  sendCommand({ type: "interactive-changed", interactive });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  globalShortcut.unregisterAll();
  registerHotkeys();
  restartCursorLoop();
  updateTrayMenu();
}

function createTrayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(getAssetPath("icon.ico"));
  if (!image.isEmpty()) {
    return image.resize({ width: 32, height: 32 });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="#111827"/>
    <path d="M7 21c5-12 12 2 18-10" fill="none" stroke="#62d6ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M8 23c6-9 10 3 17-7" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" opacity=".85"/>
    <circle cx="25" cy="11" r="3" fill="#f8fafc"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }

  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: enabled ? "状态：特效已开启" : "状态：特效已关闭", enabled: false },
      { label: `当前效果：${effectLabels[currentEffect]}`, enabled: false },
      { type: "separator" },
      {
        label: enabled ? "关闭光标特效" : "开启光标特效",
        accelerator: config.hotkey.toggleEnabled,
        click: () => setEnabled(!enabled)
      },
      {
        label: "切换下一个效果",
        accelerator: config.hotkey.nextEffect,
        click: switchToNextEffect
      },
      {
        label: "选择效果",
        submenu: trailEffects.map((effect) => ({
          label: effectLabels[effect],
          type: "radio" as const,
          checked: effect === currentEffect,
          click: () => setEffect(effect)
        }))
      },
      {
        label: interactive ? "启用穿透模式" : "退出穿透模式",
        accelerator: config.hotkey.toggleInteractive,
        click: () => setInteractive(!interactive)
      },
      { type: "separator" },
      {
        label: "设置...",
        click: () => {
          openSettingsWindow().catch(console.error);
        }
      },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: autoLaunch,
        click: () => {
          app.setLoginItemSettings({ openAtLogin: !autoLaunch });
          updateTrayMenu();
        }
      },
      { type: "separator" },
      { label: "退出", role: "quit" }
    ])
  );
}

function createTray(): void {
  tray = new Tray(createTrayImage());
  tray.setToolTip("Cursor Trail FX");
  tray.on("double-click", () => {
    openSettingsWindow().catch(console.error);
  });
  updateTrayMenu();
}

async function openSettingsWindow(): Promise<void> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 540,
    height: 680,
    minWidth: 420,
    minHeight: 520,
    title: "Cursor Trail FX 设置",
    resizable: true,
    maximizable: false,
    minimizable: true,
    skipTaskbar: false,
    frame: true,
    transparent: false,
    hasShadow: true,
    backgroundColor: "#0f172a",
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "settings.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  settingsWindow.webContents.on("will-redirect", (event) => event.preventDefault());
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });

  if (isDev) {
    await settingsWindow.loadURL(`${allowedDevServerUrl}/settings.html`);
  } else {
    await settingsWindow.loadFile(join(__dirname, "..", "..", "renderer", "settings.html"));
  }
}

async function createWindow(): Promise<void> {
  const overlayBounds = getOverlayBounds();
  mainWindow = new BrowserWindow({
    x: overlayBounds.x,
    y: overlayBounds.y,
    width: overlayBounds.width,
    height: overlayBounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    backgroundColor: "#00000000",
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenu(null);
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-redirect", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => {
    applyOverlayBounds();
    mainWindow?.showInactive();
    setInteractive(!config.clickThroughDefault);
  });

  if (isDev) {
    await mainWindow.loadURL(allowedDevServerUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, "..", "..", "renderer", "index.html"));
  }
}

function registerHotkeys(): void {
  const hotkeys: Array<[string, () => void]> = [
    [config.hotkey.nextEffect, switchToNextEffect],
    [config.hotkey.toggleEnabled, () => setEnabled(!enabled)],
    [config.hotkey.toggleInteractive, () => setInteractive(!interactive)]
  ];

  for (const [accelerator, handler] of hotkeys) {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      sendCommand({ type: "hotkey-error", accelerator });
    }
  }
}

function startCursorLoop(): void {
  const intervalMs = Math.max(4, Math.round(1000 / config.fpsCap));
  let expectedTime = performance.now();
  let lastCursor: { x: number; y: number } | undefined;

  function tick(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    if (!lastCursor || cursor.x !== lastCursor.x || cursor.y !== lastCursor.y) {
      lastCursor = cursor;
      const position: CursorPosition = {
        x: cursor.x,
        y: cursor.y,
        timestampMs: Date.now()
      };
      mainWindow.webContents.send("trail:cursor-position", position);
    }

    const now = performance.now();
    expectedTime += intervalMs;
    cursorTimer = setTimeout(tick, Math.max(0, expectedTime - now));
  }

  cursorTimer = setTimeout(tick, intervalMs);
}

function registerIpc(): void {
  ipcMain.handle("trail:get-config", (event) =>
    isTrustedSender(event.senderFrame?.url) ? config : defaultConfig
  );
  ipcMain.handle("trail:get-cursor-snapshot", (event) =>
    isTrustedSender(event.senderFrame?.url) ? getCursorSnapshot() : undefined
  );
  ipcMain.handle("trail:set-interactive", (event, nextInteractive: boolean) => {
    if (!isTrustedSender(event.senderFrame?.url) || typeof nextInteractive !== "boolean") {
      return;
    }
    setInteractive(nextInteractive);
  });
  ipcMain.handle("trail:set-enabled", (event, nextEnabled: boolean) => {
    if (!isTrustedSender(event.senderFrame?.url) || typeof nextEnabled !== "boolean") {
      return;
    }
    setEnabled(nextEnabled);
  });
  ipcMain.handle("trail:set-effect", (event, effect: TrailEffectId) => {
    if (!isTrustedSender(event.senderFrame?.url) || !isTrailEffect(effect)) {
      return;
    }
    setEffect(effect);
  });
  ipcMain.handle("trail:next-effect", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      return currentEffect;
    }
    return switchToNextEffect();
  });

  ipcMain.handle("settings:get-data", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      return null;
    }
    return {
      config,
      effects: trailEffects.map((id) => ({ id, label: effectLabels[id] })),
      autoLaunch: app.getLoginItemSettings().openAtLogin
    };
  });
  ipcMain.handle("settings:save", async (event, nextConfig: Partial<TrailConfig>, autoLaunch: boolean) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      return false;
    }

    const merged = mergeConfig({ ...config, ...nextConfig });
    await saveConfig(merged);
    applyNewConfig(merged);
    app.setLoginItemSettings({ openAtLogin: Boolean(autoLaunch) });
    return true;
  });
  ipcMain.handle("settings:open-user-data", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      return;
    }
    shell.openPath(app.getPath("userData"));
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("dev.cursor.trail-fx");

  config = await loadConfig();
  enabled = config.enabled;
  currentEffect = config.effect;
  interactive = !config.clickThroughDefault;

  registerIpc();
  createTray();
  await createWindow();
  registerHotkeys();
  startCursorLoop();

  screen.on("display-added", applyOverlayBounds);
  screen.on("display-removed", applyOverlayBounds);
  screen.on("display-metrics-changed", applyOverlayBounds);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });

  app.on("second-instance", () => {
    openSettingsWindow().catch(console.error);
  });
});

app.on("will-quit", () => {
  if (cursorTimer) {
    clearTimeout(cursorTimer);
  }
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep tray controls and global shortcuts alive after accidental window close.
});
