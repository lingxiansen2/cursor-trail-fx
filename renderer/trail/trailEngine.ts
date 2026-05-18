import { defaultConfig, maxPointAgeMs } from "../../shared/config.js";
import type { Point, TrailConfig, TrailEffectId } from "../../shared/types.js";
import { CursorSampler } from "./cursorSampler.js";
import { createEffect } from "./effects.js";
import type { TrailEffectPlugin, TrailPoint } from "./types.js";

export class TrailEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sampler: CursorSampler;
  private config: TrailConfig;
  private effect: TrailEffectPlugin;
  private lastPoint: TrailPoint | undefined;

  constructor(private readonly canvas: HTMLCanvasElement, config: TrailConfig = defaultConfig) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("Canvas 2D is required for cursor trail rendering.");
    }

    this.ctx = ctx;
    this.config = config;
    this.sampler = new CursorSampler({
      maxPoints: config.trailLength,
      maxInterpolationGapMs: getInterpolationGapMs(config)
    });
    this.effect = createEffect(config.effect);
  }

  resize(width: number, height: number, pixelRatio = window.devicePixelRatio): void {
    const ratio = Math.max(1, Math.min(2, pixelRatio));
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setConfig(config: TrailConfig): void {
    const effectChanged = config.effect !== this.config.effect;
    this.config = config;
    this.sampler.configure({
      maxPoints: config.trailLength,
      maxInterpolationGapMs: getInterpolationGapMs(config)
    });
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

    const sampled = this.sampler.addPoint(point, timeMs);
    if (!sampled) {
      return;
    }

    this.effect.emit(sampled, this.lastPoint, this.config);
    this.lastPoint = sampled;
  }

  update(deltaMs: number, nowMs: number): void {
    this.sampler.updateAges(nowMs, maxPointAgeMs);
    if (!this.sampler.getLatest()) {
      this.lastPoint = undefined;
    }
    this.effect.update(deltaMs, this.config);
  }

  render(): void {
    this.clearCanvas();
    if (!this.config.enabled) {
      return;
    }

    this.effect.draw(this.ctx, this.sampler.getPoints(), this.config);
  }

  clear(): void {
    this.sampler.clear();
    this.effect.reset();
    this.lastPoint = undefined;
    this.clearCanvas();
  }

  private clearCanvas(): void {
    if (typeof this.ctx.getTransform !== "function") {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const transform = this.ctx.getTransform();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(transform);
  }
}

function getInterpolationGapMs(config: TrailConfig): number {
  return 1000 / Math.max(120, config.fpsCap);
}
