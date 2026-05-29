import { defaultConfig } from "../../shared/config.js";
import type { Point, TrailConfig, TrailEffectId } from "../../shared/types.js";
import { createEffect } from "./effects.js";
import { createTrailRenderer } from "./trailRenderer.js";
import type { TrailRenderer } from "./trailRenderer.js";
import { TrailMotion } from "./trailMotion.js";
import type { TrailEffectPlugin, TrailPoint } from "./types.js";

export class TrailEngine {
  private readonly renderer: TrailRenderer;
  private readonly motion: TrailMotion;
  private config: TrailConfig;
  private effect: TrailEffectPlugin;
  private lastPoint: TrailPoint | undefined;

  constructor(canvas: HTMLCanvasElement, config: TrailConfig = defaultConfig) {
    this.renderer = createTrailRenderer(canvas);
    this.config = config;
    this.motion = new TrailMotion(config);
    this.effect = createEffect(config.effect);
  }

  resize(width: number, height: number, pixelRatio = window.devicePixelRatio): void {
    this.renderer.resize(width, height, pixelRatio);
  }

  setConfig(config: TrailConfig): void {
    const effectChanged = config.effect !== this.config.effect;
    this.config = config;
    this.motion.configure(config);
    if (effectChanged) {
      this.setEffect(config.effect);
    }
  }

  setEffect(effect: TrailEffectId): void {
    this.effect.reset();
    this.lastPoint = undefined;
    this.config = {
      ...this.config,
      effect
    };
    this.effect = createEffect(effect);
  }

  setEnabled(enabled: boolean): void {
    this.config = {
      ...this.config,
      enabled
    };
    if (!enabled) {
      this.clear();
    }
  }

  pushCursor(point: Point, timeMs: number): void {
    if (!this.config.enabled) {
      return;
    }

    const sampled = this.motion.setTarget(point, timeMs);
    this.effect.emit(sampled, this.lastPoint, this.config);
    this.lastPoint = sampled;
  }

  update(deltaMs: number, nowMs: number): void {
    this.motion.update(deltaMs, nowMs, this.config);
    if (!this.motion.getLatest()) {
      this.lastPoint = undefined;
    }
    this.effect.update(deltaMs, this.config);
  }

  render(): void {
    this.renderer.clear();
    if (!this.config.enabled) {
      return;
    }

    this.renderer.draw(this.motion.getPoints(), this.config, this.effect);
  }

  clear(): void {
    this.motion.clear();
    this.effect.reset();
    this.lastPoint = undefined;
    this.renderer.clear();
  }
}
