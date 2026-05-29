import { clamp } from "../../shared/config.js";
import type { Point } from "../../shared/types.js";

type TimedPoint = Point & {
  timeMs: number;
};

export type CursorFrameSample = Point & {
  timeMs: number;
  delayMs: number;
};

export type CursorFrameInterpolatorOptions = {
  maxBufferedPoints?: number;
  initialInputIntervalMs?: number;
};

const DEFAULT_MAX_BUFFERED_POINTS = 128;
const DEFAULT_INPUT_INTERVAL_MS = 1000 / 240;
const MAX_STATIONARY_GAP_MS = 90;
const MAX_INTERPOLATION_DELAY_MS = 8;
const MAX_EXTRAPOLATION_MS = 28;
const MAX_EXTRAPOLATION_DISTANCE = 34;
const MIN_EXTRAPOLATION_SEGMENT_DISTANCE = 3;
const MIN_EXTRAPOLATION_SPEED = 180;
const SAME_POINT_EPSILON = 0.01;

export class CursorFrameInterpolator {
  private readonly maxBufferedPoints: number;
  private points: TimedPoint[] = [];
  private lastOutput: Point | undefined;
  private inputIntervalMs: number;

  constructor(options: CursorFrameInterpolatorOptions = {}) {
    this.maxBufferedPoints = Math.max(4, Math.round(options.maxBufferedPoints ?? DEFAULT_MAX_BUFFERED_POINTS));
    this.inputIntervalMs = Math.max(1, options.initialInputIntervalMs ?? DEFAULT_INPUT_INTERVAL_MS);
  }

  push(point: Point, timeMs: number): void {
    const latest = this.points.at(-1);
    if (latest && isSamePoint(latest, point)) {
      return;
    }

    const nextTimeMs = latest ? Math.max(latest.timeMs + 0.01, timeMs) : timeMs;
    if (latest) {
      const intervalMs = nextTimeMs - latest.timeMs;
      if (intervalMs <= MAX_STATIONARY_GAP_MS) {
        this.inputIntervalMs += (intervalMs - this.inputIntervalMs) * 0.18;
      } else {
        this.pushBufferedPoint({
          x: latest.x,
          y: latest.y,
          timeMs: Math.max(latest.timeMs + 0.01, nextTimeMs - MAX_INTERPOLATION_DELAY_MS)
        });
      }
    }

    this.points.push({
      ...point,
      timeMs: nextTimeMs
    });

    this.trimToLimit();
  }

  sample(renderTimeMs: number, frameIntervalMs: number): CursorFrameSample | undefined {
    if (this.points.length === 0) {
      return undefined;
    }

    const delayMs = getInterpolationDelayMs(frameIntervalMs, this.inputIntervalMs);
    return this.sampleAt(renderTimeMs - delayMs, delayMs);
  }

  sampleAt(targetTimeMs: number, delayMs = 0): CursorFrameSample | undefined {
    if (this.points.length === 0) {
      return undefined;
    }

    this.dropObsoletePoints(targetTimeMs);

    const point = interpolatePosition(this.points, targetTimeMs);
    if (this.lastOutput && isSamePoint(this.lastOutput, point)) {
      return undefined;
    }

    this.lastOutput = point;
    return {
      ...point,
      delayMs
    };
  }

  clear(): void {
    this.points = [];
    this.lastOutput = undefined;
  }

  private pushBufferedPoint(point: TimedPoint): void {
    this.points.push(point);
    this.trimToLimit();
  }

  private trimToLimit(): void {
    if (this.points.length > this.maxBufferedPoints) {
      this.points = this.points.slice(-this.maxBufferedPoints);
    }
  }

  private dropObsoletePoints(targetTimeMs: number): void {
    let dropCount = 0;
    while (this.points.length - dropCount > 2 && this.points[dropCount + 1].timeMs <= targetTimeMs) {
      dropCount += 1;
    }
    if (dropCount > 0) {
      this.points.splice(0, dropCount);
    }
  }
}

export function getInterpolationDelayMs(frameIntervalMs: number, inputIntervalMs = DEFAULT_INPUT_INTERVAL_MS): number {
  const displayDelayMs = Math.max(1, frameIntervalMs) * 0.45;
  const inputDelayMs = Math.max(1, inputIntervalMs) * 0.75;
  return clamp(Math.min(displayDelayMs, inputDelayMs), 2, MAX_INTERPOLATION_DELAY_MS);
}

function interpolatePosition(points: TimedPoint[], targetTimeMs: number): CursorFrameSample {
  const first = points[0];
  const second = points[1];
  if (!second || targetTimeMs <= first.timeMs) {
    return { x: first.x, y: first.y, timeMs: first.timeMs, delayMs: 0 };
  }

  if (targetTimeMs >= second.timeMs) {
    const elapsedMs = Math.max(1, second.timeMs - first.timeMs);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    const speed = (distance / elapsedMs) * 1000;
    if (distance < MIN_EXTRAPOLATION_SEGMENT_DISTANCE || speed < MIN_EXTRAPOLATION_SPEED) {
      return {
        x: second.x,
        y: second.y,
        timeMs: second.timeMs,
        delayMs: 0
      };
    }

    const leadMs = clamp(targetTimeMs - second.timeMs, 0, MAX_EXTRAPOLATION_MS);
    const leadScale = distance > 0 ? Math.min(leadMs / elapsedMs, MAX_EXTRAPOLATION_DISTANCE / distance) : 0;
    return {
      x: second.x + dx * leadScale,
      y: second.y + dy * leadScale,
      timeMs: second.timeMs + elapsedMs * leadScale,
      delayMs: 0
    };
  }

  const progress = clamp((targetTimeMs - first.timeMs) / (second.timeMs - first.timeMs), 0, 1);
  return {
    x: first.x + (second.x - first.x) * progress,
    y: first.y + (second.y - first.y) * progress,
    timeMs: targetTimeMs,
    delayMs: 0
  };
}

function isSamePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < SAME_POINT_EPSILON && Math.abs(a.y - b.y) < SAME_POINT_EPSILON;
}
