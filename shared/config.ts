import type { Rect, TrailConfig, TrailEffectId } from "./types.js";

export const trailEffects: readonly TrailEffectId[] = [
  "neonRibbon",
  "cometTail",
  "prismPulse",
  "inkBloom",
  "electricArc",
  "starWake"
];

export const effectLabels: Record<TrailEffectId, string> = {
  neonRibbon: "霓虹丝带",
  cometTail: "彗星尾巴",
  prismPulse: "棱镜脉冲",
  inkBloom: "墨滴流体",
  electricArc: "闪电裂隙",
  starWake: "星尘星座"
};

export type EffectRegistryEntry = {
  id: TrailEffectId;
  label: string;
};

export const effectRegistry: readonly EffectRegistryEntry[] = trailEffects.map((id) => ({
  id,
  label: effectLabels[id]
}));

export const maxPointAgeMs = 900;

export const defaultConfig: TrailConfig = {
  enabled: true,
  effect: "neonRibbon",
  hotkey: {
    nextEffect: "CommandOrControl+Alt+J",
    toggleEnabled: "CommandOrControl+Alt+K"
  },
  fpsCap: 240,
  opacity: 0.92,
  trailLength: 120,
  particleCount: 120,
  lineWidth: 14,
  color: "#62d6ff",
  secondaryColor: "#c084fc",
  windowSize: {
    width: 960,
    height: 540
  }
};

/** Returns true for exactly "#rrggbb" hex color strings (e.g. "#62d6ff"). */
export function isHexColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 7) {
    return false;
  }
  if (value.charCodeAt(0) !== 35) {
    return false; // must start with #
  }
  for (let i = 1; i < 7; i++) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;       // 0-9
    const isUpperHex = c >= 65 && c <= 70;    // A-F
    const isLowerHex = c >= 97 && c <= 102;   // a-f
    if (!isDigit && !isUpperHex && !isLowerHex) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true for Electron accelerator strings (e.g. "CommandOrControl+Alt+J").
 * Accepts only ASCII letters, digits, and the "+" separator; length 2-64.
 */
export function isAccelerator(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const len = value.length;
  if (len < 2 || len > 64) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    const c = value.charCodeAt(i);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122); // A-Z or a-z
    const isDigit = c >= 48 && c <= 57;                               // 0-9
    const isPlus = c === 43;                                           // +
    if (!isLetter && !isDigit && !isPlus) {
      return false;
    }
  }
  return true;
}

export function mergeConfig(config: Partial<TrailConfig> = {}): TrailConfig {
  const effect = isTrailEffect(config.effect) ? config.effect : defaultConfig.effect;
  const srcHotkey = config.hotkey;

  return {
    ...defaultConfig,
    ...config,
    enabled: typeof config.enabled === "boolean" ? config.enabled : defaultConfig.enabled,
    effect,
    opacity: clampNumber(config.opacity, 0.05, 1, defaultConfig.opacity),
    trailLength: Math.round(clampNumber(config.trailLength, 16, 260, defaultConfig.trailLength)),
    particleCount: Math.round(clampNumber(config.particleCount, 10, 260, defaultConfig.particleCount)),
    lineWidth: clampNumber(config.lineWidth, 2, 44, defaultConfig.lineWidth),
    fpsCap: Math.round(clampNumber(config.fpsCap, 120, 360, defaultConfig.fpsCap)),
    color: isHexColor(config.color) ? config.color : defaultConfig.color,
    secondaryColor: isHexColor(config.secondaryColor) ? config.secondaryColor : defaultConfig.secondaryColor,
    hotkey: {
      nextEffect:
        srcHotkey && isAccelerator(srcHotkey.nextEffect)
          ? srcHotkey.nextEffect
          : defaultConfig.hotkey.nextEffect,
      toggleEnabled:
        srcHotkey && isAccelerator(srcHotkey.toggleEnabled)
          ? srcHotkey.toggleEnabled
          : defaultConfig.hotkey.toggleEnabled
    },
    windowSize: {
      ...defaultConfig.windowSize,
      ...config.windowSize
    }
  };
}

export function nextTrailEffect(current: TrailEffectId): TrailEffectId {
  const index = trailEffects.indexOf(current);
  return trailEffects[(index + 1) % trailEffects.length] ?? trailEffects[0];
}

export function isTrailEffect(value: unknown): value is TrailEffectId {
  return typeof value === "string" && trailEffects.includes(value as TrailEffectId);
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: defaultConfig.windowSize.width, height: defaultConfig.windowSize.height };
  }

  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
}
