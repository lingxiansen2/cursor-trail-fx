import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray
} from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inputDesktopProbe, type InputDesktopChange } from "./inputDesktop.js";
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

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("enable-gpu-rasterization");

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let config: TrailConfig = defaultConfig;
let enabled = defaultConfig.enabled;
let currentEffect: TrailEffectId = defaultConfig.effect;
let cursorTimer: NodeJS.Timeout | undefined;
let overlayHealthTimer: NodeJS.Timeout | undefined;
let secureDesktopRecoveryTimer: NodeJS.Timeout | undefined;
let secureDesktopWatchdogTimer: NodeJS.Timeout | undefined;
let suspendOverlayTopmostUntil = 0;
const overlayTopmostLevel: Parameters<BrowserWindow["setAlwaysOnTop"]>[1] = "screen-saver";
const overlayTopmostRelativeLevel = 1;
const overlayVisibleOnFullScreen = process.platform !== "win32";
const shellPreviewGuardBandPx = 96;
const shellPreviewSuspendMs = 900;
let isSettingsInteractionActive = false;
let isSecureDesktopSuspended = false;
let secureDesktopSuspendedAt = 0;

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

function getDisplayWorkAreaRects(): Rect[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function getOverlayBounds(): Rect {
  return unionRects(getDisplayWorkAreaRects());
}

function isNearShellPreviewArea(point: Electron.Point): boolean {
  return screen.getAllDisplays().some((display) => {
    const { bounds, workArea } = display;
    const inDisplay =
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height;
    if (!inDisplay) {
      return false;
    }

    const bottomTaskbar = workArea.y + workArea.height < bounds.y + bounds.height;
    const topTaskbar = workArea.y > bounds.y;
    const leftTaskbar = workArea.x > bounds.x;
    const rightTaskbar = workArea.x + workArea.width < bounds.x + bounds.width;

    return (
      (bottomTaskbar && point.y >= workArea.y + workArea.height - shellPreviewGuardBandPx) ||
      (topTaskbar && point.y <= workArea.y + shellPreviewGuardBandPx) ||
      (leftTaskbar && point.x <= workArea.x + shellPreviewGuardBandPx) ||
      (rightTaskbar && point.x >= workArea.x + workArea.width - shellPreviewGuardBandPx)
    );
  });
}

function getCursorSnapshot(): CursorSnapshot {
  return {
    cursor: screen.getCursorScreenPoint(),
    overlayBounds: getOverlayBounds(),
    displays: getDisplayWorkAreaRects(),
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

/**
 * Returns true when the Win32 input desktop is currently held by something
 * other than the user's normal Default desktop (UAC consent prompt, lock
 * screen, screen saver, ...). Calling SetWindowPos / ShowWindow / similar
 * window APIs while this is true risks blocking the main thread until the
 * input desktop returns, so timer-driven reinforcement and cursor sampling
 * must skip Win32 calls in that state.
 *
 * Returns false on non-Windows platforms.
 */
function isInputDesktopForeign(): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  return !inputDesktopProbe.isOnDefault();
}

/**
 * Closes a stale BrowserWindow without holding the main thread on
 * DestroyWindow. hide() is invoked synchronously so the renderer stops
 * producing frames immediately, while destroy() is deferred to the next
 * event-loop tick and wrapped in try/catch so a blocking Win32 call (during
 * UAC, for example) cannot freeze subsequent Electron event handling.
 */
function disposeOverlayWindow(staleWindow: BrowserWindow): void {
  try {
    if (!staleWindow.isDestroyed()) {
      staleWindow.hide();
    }
  } catch (err) {
    console.warn("[overlay] hide failed during dispose:", err);
  }
  setImmediate(() => {
    try {
      if (!staleWindow.isDestroyed()) {
        staleWindow.destroy();
      }
    } catch (err) {
      console.warn("[overlay] destroy failed during dispose:", err);
    }
  });
}

function applyOverlayBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const overlayBounds = getOverlayBounds();
  console.info(`[overlay] bounds ${overlayBounds.x},${overlayBounds.y} ${overlayBounds.width}x${overlayBounds.height}`);
  mainWindow.setBounds(overlayBounds, false);
  reinforceOverlayWindow(false);
  sendCommand({ type: "overlay-bounds-changed", overlayBounds });
}

function raiseOverlayWithoutFocus(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return;
  }

  if (process.platform === "win32") {
    return;
  }

  try {
    mainWindow.moveTop();
  } catch {
    // Ignore platform-specific z-order failures and rely on always-on-top.
  }
}

function reinforceOverlayWindow(forceVisible: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  // Skip every Win32 setter when the input desktop is foreign — these calls
  // can stall the main thread for the entire UAC/lock-screen session.
  if (isInputDesktopForeign()) {
    return;
  }

  if (isSecureDesktopSuspended) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    return;
  }

  if (isSettingsInteractionActive || Date.now() < suspendOverlayTopmostUntil) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    return;
  }

  raiseOverlayWindow(forceVisible);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: overlayVisibleOnFullScreen });
  mainWindow.setSkipTaskbar(true);
  mainWindow.setFocusable(false);
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
}

function raiseOverlayWindow(forceVisible: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  // Re-applying the level fixes cases where Windows reorders a transparent,
  // click-through overlay below the active Explorer/window-manager surface.
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setAlwaysOnTop(true, overlayTopmostLevel, overlayTopmostRelativeLevel);
  if (forceVisible && !mainWindow.isVisible()) {
    mainWindow.showInactive();
  } else if (forceVisible) {
    mainWindow.showInactive();
  }

  if (typeof mainWindow.moveTop === "function") {
    mainWindow.moveTop();
  }
}

function suspendOverlayTopmost(durationMs: number): void {
  suspendOverlayTopmostUntil = Math.max(suspendOverlayTopmostUntil, Date.now() + durationMs);
}

function resumeOverlayTopmost(): void {
  isSettingsInteractionActive = false;
  suspendOverlayTopmostUntil = 0;
  reinforceOverlayWindow(true);
  setTimeout(() => reinforceOverlayWindow(true), 120);
  setTimeout(() => reinforceOverlayWindow(true), 500);
}

function setSettingsInteractionActive(active: boolean): void {
  isSettingsInteractionActive = active;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (active) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    return;
  }

  resumeOverlayTopmost();
}

function startOverlayHealthLoop(): void {
  if (overlayHealthTimer) {
    clearInterval(overlayHealthTimer);
  }

  overlayHealthTimer = setInterval(() => {
    if (Date.now() < suspendOverlayTopmostUntil) {
      return;
    }
    reinforceOverlayWindow(true);
  }, 750);
}

function stopCursorLoop(): void {
  if (cursorTimer) {
    clearTimeout(cursorTimer);
    cursorTimer = undefined;
  }
}

function stopOverlayHealthLoop(): void {
  if (overlayHealthTimer) {
    clearInterval(overlayHealthTimer);
    overlayHealthTimer = undefined;
  }
}

function clearSecureDesktopRecoveryTimer(): void {
  if (secureDesktopRecoveryTimer) {
    clearTimeout(secureDesktopRecoveryTimer);
    secureDesktopRecoveryTimer = undefined;
  }
}

function startSecureDesktopWatchdog(): void {
  if (secureDesktopWatchdogTimer) {
    clearInterval(secureDesktopWatchdogTimer);
  }

  secureDesktopWatchdogTimer = setInterval(() => {
    if (!isSecureDesktopSuspended) {
      return;
    }

    // Probe-driven path (Windows): the input desktop probe is the primary
    // signal — if it reports Default again, the secure desktop session
    // ended. Recover immediately with a short debounce.
    if (process.platform === "win32" && inputDesktopProbe.isOnDefault()) {
      scheduleSecureDesktopRecovery(`watchdog:input-desktop:${inputDesktopProbe.getName()}`, 150);
      return;
    }

    // Legacy heuristic (covers macOS / Linux and a degraded probe on
    // Windows). idleState !== "locked"/"unknown" implies the user is back.
    const idleState = powerMonitor.getSystemIdleState(1);
    const suspendedForMs = Date.now() - secureDesktopSuspendedAt;
    const canRecoverNormally = idleState !== "locked" && idleState !== "unknown";
    const shouldForceRecoverUnknown =
      process.platform === "win32" && idleState === "unknown" && suspendedForMs >= 4000;

    if (canRecoverNormally || shouldForceRecoverUnknown) {
      const reason = shouldForceRecoverUnknown
        ? `watchdog:${idleState}:timeout`
        : `watchdog:${idleState}`;
      scheduleSecureDesktopRecovery(reason, 200);
    }
  }, 750);
}

function stopSecureDesktopWatchdog(): void {
  if (secureDesktopWatchdogTimer) {
    clearInterval(secureDesktopWatchdogTimer);
    secureDesktopWatchdogTimer = undefined;
  }
}

function resetRendererTrail(): void {
  sendCommand({ type: "reset-trail" });
}

function pauseForSecureDesktop(reason: string): void {
  if (isSecureDesktopSuspended) {
    console.info(`[secure-desktop] pause ignored while already suspended: ${reason}`);
    return;
  }

  isSecureDesktopSuspended = true;
  secureDesktopSuspendedAt = Date.now();
  clearSecureDesktopRecoveryTimer();
  startSecureDesktopWatchdog();
  setSettingsInteractionActive(false);
  stopCursorLoop();
  stopOverlayHealthLoop();
  resetRendererTrail();

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try {
      settingsWindow.close();
    } catch (err) {
      console.warn("[secure-desktop] settings close failed:", err);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    const staleWindow = mainWindow;
    mainWindow = undefined;
    disposeOverlayWindow(staleWindow);
  }

  console.info(`[secure-desktop] paused overlay: ${reason}`);
}

async function recreateOverlayWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const staleWindow = mainWindow;
    mainWindow = undefined;
    disposeOverlayWindow(staleWindow);
  }

  await createWindow();
}

async function recoverFromSecureDesktop(reason: string): Promise<void> {
  clearSecureDesktopRecoveryTimer();
  stopSecureDesktopWatchdog();

  if (!app.isReady()) {
    return;
  }

  isSecureDesktopSuspended = false;
  secureDesktopSuspendedAt = 0;
  setSettingsInteractionActive(false);
  globalShortcut.unregisterAll();
  await recreateOverlayWindow();
  applyOverlayBounds();
  reinforceOverlayWindow(true);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
    } else {
      raiseOverlayWithoutFocus();
    }
  }
  registerHotkeys();
  startCursorLoop();
  startOverlayHealthLoop();
  resetRendererTrail();

  console.info(`[secure-desktop] recovered overlay: ${reason}`);
}

function scheduleSecureDesktopRecovery(reason: string, delayMs = 900): void {
  if (!isSecureDesktopSuspended) {
    return;
  }

  clearSecureDesktopRecoveryTimer();
  secureDesktopRecoveryTimer = setTimeout(() => {
    void recoverFromSecureDesktop(reason).catch(console.error);
  }, delayMs);
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
  stopCursorLoop();
  startCursorLoop();
}

function applyNewConfig(nextConfig: TrailConfig): void {
  config = nextConfig;
  currentEffect = nextConfig.effect;
  enabled = nextConfig.enabled;

  // Push the full config first so the renderer updates opacity, lineWidth,
  // color, trailLength, particleCount, secondaryColor, etc. in one shot.
  sendCommand({ type: "config-changed", config: nextConfig });
  sendCommand({ type: "enabled-changed", enabled });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
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
    suspendOverlayTopmost(2000);
    setSettingsInteractionActive(true);
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
  settingsWindow.on("focus", () => {
    setSettingsInteractionActive(true);
    suspendOverlayTopmost(2500);
  });
  settingsWindow.on("show", () => {
    setSettingsInteractionActive(true);
    suspendOverlayTopmost(2500);
  });
  settingsWindow.on("blur", () => {
    suspendOverlayTopmost(1200);
    setTimeout(() => {
      if (!settingsWindow || settingsWindow.isDestroyed() || !settingsWindow.isFocused()) {
        resumeOverlayTopmost();
      }
    }, 160);
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    resumeOverlayTopmost();
  });

  if (isDev) {
    await settingsWindow.loadURL(`${allowedDevServerUrl}/settings.html`);
  } else {
    await settingsWindow.loadFile(join(__dirname, "..", "..", "renderer", "settings.html"));
  }
  setSettingsInteractionActive(true);
  suspendOverlayTopmost(2500);
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
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.setAlwaysOnTop(true, overlayTopmostLevel, overlayTopmostRelativeLevel);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: overlayVisibleOnFullScreen });
  mainWindow.setMenu(null);
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-redirect", (event) => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", () => {
    console.warn("[overlay] renderer process gone");
    scheduleSecureDesktopRecovery("render-process-gone", 300);
  });
  mainWindow.on("show", () => reinforceOverlayWindow(false));
  mainWindow.on("restore", () => reinforceOverlayWindow(false));
  mainWindow.on("hide", () => {
    console.info("[overlay] hide");
    if (isSecureDesktopSuspended) {
      return;
    }
    setTimeout(() => reinforceOverlayWindow(false), 120);
  });
  mainWindow.on("blur", () => {
    console.info("[overlay] blur");
    if (isSecureDesktopSuspended) {
      return;
    }
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isFocused()) {
      suspendOverlayTopmost(1200);
      return;
    }
    setTimeout(() => reinforceOverlayWindow(false), 60);
  });
  mainWindow.on("closed", () => {
    console.info("[overlay] closed");
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => {
    applyOverlayBounds();
    reinforceOverlayWindow(true);
    mainWindow?.setIgnoreMouseEvents(true, { forward: true });
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
    [config.hotkey.toggleEnabled, () => setEnabled(!enabled)]
  ];

  for (const [accelerator, handler] of hotkeys) {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      sendCommand({ type: "hotkey-error", accelerator });
    }
  }
}

function startCursorLoop(): void {
  if (isSecureDesktopSuspended) {
    return;
  }

  const sampleRateHz = Math.max(500, config.fpsCap * 2);
  const intervalMs = Math.max(1, Math.round(1000 / sampleRateHz));
  let expectedTime = performance.now();
  let lastCursor: { x: number; y: number } | undefined;

  function tick(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    // Back off when the input desktop is foreign so we neither sample the
    // cursor nor push IPC into a renderer whose window may be in limbo.
    if (isInputDesktopForeign()) {
      cursorTimer = setTimeout(tick, 250);
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    if (isNearShellPreviewArea(cursor)) {
      suspendOverlayTopmost(shellPreviewSuspendMs);
    }

    if (!lastCursor || cursor.x !== lastCursor.x || cursor.y !== lastCursor.y) {
      lastCursor = cursor;
      const position: CursorPosition = {
        x: cursor.x,
        y: cursor.y,
        timestampMs: performance.timeOrigin + performance.now()
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
    resumeOverlayTopmost();
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

  registerIpc();
  createTray();
  await createWindow();
  registerHotkeys();
  startCursorLoop();
  startOverlayHealthLoop();

  screen.on("display-added", () => {
    applyOverlayBounds();
    setTimeout(() => reinforceOverlayWindow(false), 100);
  });
  screen.on("display-removed", () => {
    applyOverlayBounds();
    setTimeout(() => reinforceOverlayWindow(false), 100);
  });
  screen.on("display-metrics-changed", () => {
    applyOverlayBounds();
    setTimeout(() => reinforceOverlayWindow(false), 100);
  });

  // Input desktop probe — covers UAC consent prompts that powerMonitor
  // never reports. The probe is best-effort: if PowerShell is missing or
  // the child crashes, the rest of the lock-screen / sleep handling keeps
  // working through powerMonitor.
  inputDesktopProbe.on("change", (event: InputDesktopChange) => {
    console.info(`[input-desktop] ${event.from} -> ${event.to}`);
    if (event.to === "Default") {
      scheduleSecureDesktopRecovery(`input-desktop:${event.to}`, 150);
    } else {
      pauseForSecureDesktop(`input-desktop:${event.to}`);
    }
  });
  inputDesktopProbe.start();

  powerMonitor.on("lock-screen", () => {
    pauseForSecureDesktop("lock-screen");
  });
  powerMonitor.on("suspend", () => {
    pauseForSecureDesktop("suspend");
  });
  powerMonitor.on("unlock-screen", () => {
    scheduleSecureDesktopRecovery("unlock-screen");
  });
  powerMonitor.on("resume", () => {
    scheduleSecureDesktopRecovery("resume", 1200);
  });
  powerMonitor.on("user-did-resign-active", () => {
    pauseForSecureDesktop("user-did-resign-active");
  });
  powerMonitor.on("user-did-become-active", () => {
    scheduleSecureDesktopRecovery("user-did-become-active", 700);
  });

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
  stopCursorLoop();
  stopOverlayHealthLoop();
  clearSecureDesktopRecoveryTimer();
  stopSecureDesktopWatchdog();
  inputDesktopProbe.stop();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep tray controls and global shortcuts alive after accidental window close.
});
