import { defaultConfig, effectLabels, isTrailEffect, mergeConfig, nextTrailEffect } from "../shared/config.js";
import type { CursorPosition, CursorSnapshot, Point, Rect, TrailConfig, TrailEffectId, TrailRuntimeApi } from "../shared/types.js";
import { TrailEngine } from "./trail/trailEngine.js";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}
const appRoot = app;

function createBrowserPreviewApi(): TrailRuntimeApi {
  let interactive = true;
  let enabled = defaultConfig.enabled;
  let effect = defaultConfig.effect;
  let cursor: Point = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  };
  const cursorListeners = new Set<(position: CursorPosition) => void>();
  const snapshotListeners = new Set<(snapshot: CursorSnapshot) => void>();
  const commandListeners = new Set<Parameters<TrailRuntimeApi["onCommand"]>[0]>();

  window.addEventListener("pointermove", (event) => {
    cursor = { x: event.clientX, y: event.clientY };
    const position: CursorPosition = {
      x: event.clientX,
      y: event.clientY,
      timestampMs: Date.now()
    };
    cursorListeners.forEach((listener) => listener(position));
  });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "j") {
      effect = nextTrailEffect(effect);
      commandListeners.forEach((listener) => listener({ type: "effect-changed", effect }));
      return;
    }

    if (key === "k") {
      enabled = !enabled;
      commandListeners.forEach((listener) => listener({ type: "enabled-changed", enabled }));
      return;
    }

    if (key === "p") {
      interactive = !interactive;
      commandListeners.forEach((listener) => listener({ type: "interactive-changed", interactive }));
    }
  });

  function makeSnapshot(): CursorSnapshot {
    const overlayBounds: Rect = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
    return {
      cursor,
      overlayBounds,
      displays: [overlayBounds],
      interactive,
      enabled,
      effect
    };
  }

  return {
    getConfig: async () => defaultConfig,
    getCursorSnapshot: async () => makeSnapshot(),
    setInteractive: async (nextInteractive) => {
      interactive = nextInteractive;
      commandListeners.forEach((listener) => listener({ type: "interactive-changed", interactive }));
    },
    setEnabled: async (nextEnabled) => {
      enabled = nextEnabled;
      commandListeners.forEach((listener) => listener({ type: "enabled-changed", enabled }));
    },
    setEffect: async (nextEffect) => {
      if (!isTrailEffect(nextEffect)) {
        return;
      }
      effect = nextEffect;
      commandListeners.forEach((listener) => listener({ type: "effect-changed", effect }));
    },
    nextEffect: async () => {
      effect = nextTrailEffect(effect);
      commandListeners.forEach((listener) => listener({ type: "effect-changed", effect }));
      return effect;
    },
    onCommand: (callback) => {
      commandListeners.add(callback);
      return () => commandListeners.delete(callback);
    },
    onCursor: (callback) => {
      snapshotListeners.add(callback);
      return () => snapshotListeners.delete(callback);
    },
    onCursorPosition: (callback) => {
      cursorListeners.add(callback);
      return () => cursorListeners.delete(callback);
    }
  };
}

const runtime = window.trailApi ?? createBrowserPreviewApi();

function renderShell(config: TrailConfig): {
  canvas: HTMLCanvasElement;
  badge: HTMLDivElement;
} {
  appRoot.innerHTML = `
    <section class="trail-stage" aria-live="polite">
      <canvas class="trail-canvas" aria-label="Cursor trail effects canvas"></canvas>
      <div class="mode-badge" aria-hidden="true"></div>
    </section>
  `;

  const canvas = appRoot.querySelector<HTMLCanvasElement>(".trail-canvas");
  const badge = appRoot.querySelector<HTMLDivElement>(".mode-badge");

  if (!canvas || !badge) {
    throw new Error("Failed to create trail DOM");
  }

  badge.textContent = `${effectLabels[config.effect]} · ${config.enabled ? "on" : "off"}`;
  return { canvas, badge };
}

function toLocalPoint(position: CursorPosition, overlayX: number, overlayY: number): Point {
  return {
    x: position.x - overlayX,
    y: position.y - overlayY
  };
}

function showBadge(badge: HTMLDivElement, text: string, warning = false): void {
  badge.textContent = text;
  badge.classList.toggle("mode-badge-warning", warning);
  badge.classList.add("mode-badge-visible");
  window.setTimeout(() => badge.classList.remove("mode-badge-visible"), 1100);
}

async function bootstrap(): Promise<void> {
  let config = mergeConfig(await runtime.getConfig());
  let cursorSnapshot = await runtime.getCursorSnapshot();
  const shell = renderShell(config);
  const engine = new TrailEngine(shell.canvas, config);
  let lastFrame = performance.now();

  function resize(): void {
    engine.resize(window.innerWidth, window.innerHeight);
  }

  resize();
  window.addEventListener("resize", resize);

  const disposeCommand = runtime.onCommand((command) => {
    if (command.type === "config-changed") {
      config = mergeConfig(command.config);
      engine.setConfig(config);
      showBadge(shell.badge, `Sampling: ${config.fpsCap}Hz`);
      return;
    }

    if (command.type === "effect-changed") {
      config = mergeConfig({ ...config, effect: command.effect });
      engine.setEffect(command.effect);
      showBadge(shell.badge, `Effect: ${effectLabels[command.effect]}`);
      return;
    }

    if (command.type === "enabled-changed") {
      config = mergeConfig({ ...config, enabled: command.enabled });
      engine.setEnabled(command.enabled);
      showBadge(shell.badge, command.enabled ? "Trail on" : "Trail off");
      return;
    }

    if (command.type === "interactive-changed") {
      showBadge(shell.badge, command.interactive ? "Interactive" : "Click-through");
      return;
    }

    if (command.type === "overlay-bounds-changed") {
      cursorSnapshot = {
        ...cursorSnapshot,
        overlayBounds: command.overlayBounds
      };
      overlayOffset.x = command.overlayBounds.x;
      overlayOffset.y = command.overlayBounds.y;
      resize();
      return;
    }

    if (command.type === "hotkey-error") {
      showBadge(shell.badge, `Hotkey unavailable: ${command.accelerator}`, true);
      return;
    }

    if (command.type === "reset-trail") {
      engine.clear();
      lastFrame = performance.now();
    }
  });

  const overlayOffset = { x: cursorSnapshot.overlayBounds.x, y: cursorSnapshot.overlayBounds.y };

  const disposeCursor = runtime.onCursorPosition((position) => {
    engine.pushCursor(toLocalPoint(position, overlayOffset.x, overlayOffset.y), performance.now());
  });

  window.addEventListener("beforeunload", () => {
    disposeCommand();
    disposeCursor();
    window.removeEventListener("resize", resize);
    engine.clear();
  });

  function frame(now: number): void {
    const deltaMs = Math.min(50, now - lastFrame);
    lastFrame = now;
    engine.update(deltaMs, now);
    engine.render();
    window.requestAnimationFrame(frame);
  }

  const initialPoint: CursorPosition = {
    x: cursorSnapshot.cursor.x,
    y: cursorSnapshot.cursor.y,
    timestampMs: performance.now()
  };
  engine.pushCursor(toLocalPoint(initialPoint, overlayOffset.x, overlayOffset.y), initialPoint.timestampMs);
  window.requestAnimationFrame(frame);
}

bootstrap().catch((error) => {
  appRoot.textContent = error instanceof Error ? error.message : "Failed to start cursor trail effects.";
});
