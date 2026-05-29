import { clamp } from "../../shared/config.js";
import type { CursorPosition, Point, Rect } from "../../shared/types.js";
import { CursorFrameInterpolator } from "./cursorFrameInterpolator.js";
import { TrailEngine } from "./trailEngine.js";

const INITIAL_FRAME_INTERVAL_MS = 1000 / 75;
const MAX_FRAME_DELTA_MS = 50;
const MAX_CURSOR_EVENT_AGE_MS = 250;
const MAX_CURSOR_EVENT_LEAD_MS = 12;
const UNIX_TIME_THRESHOLD_MS = 1_000_000_000_000;

export class TrailAnimator {
  private readonly cursorInterpolator = new CursorFrameInterpolator();
  private overlayOffset: Point;
  private animationFrameId: number | undefined;
  private lastFrameMs = performance.now();
  private frameIntervalMs = INITIAL_FRAME_INTERVAL_MS;
  private running = false;

  constructor(private readonly engine: TrailEngine, overlayBounds: Rect) {
    this.overlayOffset = {
      x: overlayBounds.x,
      y: overlayBounds.y
    };
  }

  setOverlayBounds(overlayBounds: Rect): void {
    this.overlayOffset = {
      x: overlayBounds.x,
      y: overlayBounds.y
    };
  }

  start(initialCursor: Point): void {
    if (this.running) {
      return;
    }

    const now = performance.now();
    this.lastFrameMs = now;
    this.cursorInterpolator.push(this.toLocalPoint(initialCursor), now);
    this.running = true;
    this.animationFrameId = window.requestAnimationFrame(this.frame);
  }

  pushCursor(position: CursorPosition): void {
    const receivedAtMs = performance.now();
    this.cursorInterpolator.push(
      this.toLocalPoint(position),
      toRendererPerformanceTime(position.timestampMs, receivedAtMs)
    );
  }

  pushLocalCursor(point: Point, timeMs = performance.now()): void {
    this.cursorInterpolator.push(point, timeMs);
  }

  reset(now = performance.now()): void {
    this.cursorInterpolator.clear();
    this.engine.clear();
    this.lastFrameMs = now;
    this.frameIntervalMs = INITIAL_FRAME_INTERVAL_MS;
  }

  stop(): void {
    if (this.animationFrameId !== undefined) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    this.running = false;
    this.reset();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) {
      return;
    }

    const elapsedMs = Math.min(MAX_FRAME_DELTA_MS, Math.max(1, now - this.lastFrameMs));
    this.frameIntervalMs += (elapsedMs - this.frameIntervalMs) * 0.12;
    this.lastFrameMs = now;

    const sample = this.cursorInterpolator.sample(now, this.frameIntervalMs);
    if (sample) {
      this.engine.pushCursor(sample, sample.timeMs);
    }

    this.engine.update(elapsedMs, now);
    this.engine.render();
    this.animationFrameId = window.requestAnimationFrame(this.frame);
  };

  private toLocalPoint(position: Point): Point {
    return {
      x: position.x - this.overlayOffset.x,
      y: position.y - this.overlayOffset.y
    };
  }
}

export function toRendererPerformanceTime(timestampMs: number, receivedAtMs = performance.now()): number {
  if (!Number.isFinite(timestampMs)) {
    return receivedAtMs;
  }

  const localWallClockOffsetMs = Date.now() - receivedAtMs;
  const localTimeMs =
    timestampMs > UNIX_TIME_THRESHOLD_MS
      ? timestampMs - localWallClockOffsetMs
      : timestampMs;

  return clamp(localTimeMs, receivedAtMs - MAX_CURSOR_EVENT_AGE_MS, receivedAtMs + MAX_CURSOR_EVENT_LEAD_MS);
}
