import { clamp } from "../../shared/config.js";
import type { Point } from "../../shared/types.js";
import type { TrailPoint } from "./types.js";

export type CursorSamplerOptions = {
  maxPoints: number;
  minDistance?: number;
  maxSegmentLength?: number;
};

export class CursorSampler {
  private readonly maxPoints: number;
  private readonly minDistance: number;
  private readonly maxSegmentLength: number;
  private points: TrailPoint[] = [];
  private lastInputPoint: Point | undefined;

  constructor(options: CursorSamplerOptions) {
    this.maxPoints = Math.max(2, Math.round(options.maxPoints));
    this.minDistance = options.minDistance ?? 1.2;
    this.maxSegmentLength = Math.max(2, options.maxSegmentLength ?? 6);
  }

  addPoint(point: Point, timeMs: number): TrailPoint | undefined {
    if (this.lastInputPoint && pointDistance(this.lastInputPoint, point) < this.minDistance) {
      return undefined;
    }

    const previous = this.points.at(-1);
    if (!previous) {
      const sampled = makeTrailPoint(point, timeMs, 0);
      this.pushSample(sampled);
      this.lastInputPoint = { ...point };
      return sampled;
    }

    const distance = pointDistance(previous, point);
    if (distance < this.minDistance) {
      return undefined;
    }

    const deltaMs = Math.max(1, timeMs - previous.timeMs);
    const speed = (distance / deltaMs) * 1000;
    const segmentCount = Math.max(1, Math.ceil(distance / this.maxSegmentLength));
    let sampled: TrailPoint | undefined;

    for (let step = 1; step <= segmentCount; step += 1) {
      const ratio = step / segmentCount;
      sampled = makeTrailPoint(
        {
          x: previous.x + (point.x - previous.x) * ratio,
          y: previous.y + (point.y - previous.y) * ratio
        },
        previous.timeMs + deltaMs * ratio,
        speed
      );
      this.pushSample(sampled);
    }

    this.lastInputPoint = { ...point };
    return sampled;
  }

  updateAges(nowMs: number, maxAgeMs: number): void {
    for (let i = this.points.length - 1; i >= 0; i--) {
      const age = Math.max(0, nowMs - this.points[i].timeMs);
      if (age > maxAgeMs) {
        this.points.splice(i, 1);
        continue;
      }
      this.points[i].ageMs = clamp(age, 0, maxAgeMs);
    }
  }

  getPoints(): TrailPoint[] {
    return this.points;
  }

  getLatest(): TrailPoint | undefined {
    const latest = this.points.at(-1);
    return latest ? { ...latest } : undefined;
  }

  clear(): void {
    this.points = [];
    this.lastInputPoint = undefined;
  }

  private pushSample(sample: TrailPoint): void {
    this.points.push(sample);
    if (this.points.length > this.maxPoints) {
      this.points = this.points.slice(-this.maxPoints);
    }
  }
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function makeTrailPoint(point: Point, timeMs: number, speed: number): TrailPoint {
  return {
    x: point.x,
    y: point.y,
    timeMs,
    ageMs: 0,
    speed
  };
}
