import { clamp, maxPointAgeMs } from "../../shared/config.js";
import type { Point, TrailConfig } from "../../shared/types.js";
import type { TrailPoint } from "./types.js";

const MIN_MOTION_POINTS = 12;
const MAX_MOTION_POINTS = 72;
const HEAD_FOLLOW_PER_SECOND = 180;
const TAIL_FOLLOW_PER_SECOND = 34;
const IDLE_CLEAR_DISTANCE = 0.75;
const MOVEMENT_EPSILON = 0.35;

export class TrailMotion {
  private points: TrailPoint[] = [];
  private drawablePoints: TrailPoint[] = [];
  private target: Point | undefined;
  private lastTarget: Point | undefined;
  private lastTargetTimeMs = 0;
  private lastMovementMs = 0;
  private targetSpeed = 0;

  constructor(config: TrailConfig) {
    this.configure(config);
  }

  configure(config: TrailConfig): void {
    this.ensurePointCount(getMotionPointCount(config));
  }

  setTarget(point: Point, timeMs: number): TrailPoint {
    if (this.lastTarget) {
      const distance = pointDistance(this.lastTarget, point);
      const elapsedMs = Math.max(1, timeMs - this.lastTargetTimeMs);
      this.targetSpeed = (distance / elapsedMs) * 1000;
      if (distance >= MOVEMENT_EPSILON) {
        this.lastMovementMs = timeMs;
      }
    } else {
      this.lastMovementMs = timeMs;
    }

    this.target = { ...point };
    this.lastTarget = { ...point };
    this.lastTargetTimeMs = timeMs;

    if (this.points.length === 0) {
      this.initializePoints(point, timeMs, getMotionPointCountFallback());
    }

    return {
      ...point,
      ageMs: 0,
      timeMs,
      speed: this.targetSpeed
    };
  }

  update(deltaMs: number, nowMs: number, config: TrailConfig): void {
    if (!this.target) {
      this.drawablePoints = [];
      return;
    }

    this.ensurePointCount(getMotionPointCount(config));
    if (this.points.length === 0) {
      this.initializePoints(this.target, nowMs, getMotionPointCount(config));
    }

    const normalizedDeltaSeconds = clamp(deltaMs, 1, 50) / 1000;
    this.moveHead(normalizedDeltaSeconds, nowMs);
    this.moveTail(normalizedDeltaSeconds, nowMs);

    if (nowMs - this.lastMovementMs > maxPointAgeMs && this.getChainDistance() < IDLE_CLEAR_DISTANCE) {
      this.clear();
      return;
    }

    this.drawablePoints = this.createDrawablePoints(nowMs);
  }

  getPoints(): TrailPoint[] {
    return this.drawablePoints;
  }

  getLatest(): TrailPoint | undefined {
    const latest = this.drawablePoints.at(-1);
    return latest ? { ...latest } : undefined;
  }

  clear(): void {
    this.points = [];
    this.drawablePoints = [];
    this.target = undefined;
    this.lastTarget = undefined;
    this.lastTargetTimeMs = 0;
    this.lastMovementMs = 0;
    this.targetSpeed = 0;
  }

  private initializePoints(point: Point, timeMs: number, count: number): void {
    this.points = Array.from({ length: count }, () => ({
      ...point,
      ageMs: 0,
      timeMs,
      speed: 0
    }));
    this.drawablePoints = this.createDrawablePoints(timeMs);
  }

  private ensurePointCount(count: number): void {
    if (this.points.length === count) {
      return;
    }

    if (this.points.length === 0) {
      return;
    }

    const anchor = this.points.at(-1) ?? this.points[0];
    if (this.points.length < count) {
      while (this.points.length < count) {
        this.points.push({ ...anchor });
      }
      return;
    }

    this.points = this.points.slice(0, count);
  }

  private moveHead(deltaSeconds: number, nowMs: number): void {
    const head = this.points[0];
    const target = this.target;
    if (!head || !target) {
      return;
    }

    const follow = frameRateIndependentFollow(HEAD_FOLLOW_PER_SECOND, deltaSeconds);
    head.x += (target.x - head.x) * follow;
    head.y += (target.y - head.y) * follow;
    if (pointDistance(head, target) < 0.02) {
      head.x = target.x;
      head.y = target.y;
    }
    head.timeMs = nowMs;
    head.ageMs = 0;
    head.speed = this.targetSpeed;
  }

  private moveTail(deltaSeconds: number, nowMs: number): void {
    for (let index = 1; index < this.points.length; index += 1) {
      const previous = this.points[index - 1];
      const point = this.points[index];
      const followScale = 1 - (index / Math.max(1, this.points.length - 1)) * 0.35;
      const follow = frameRateIndependentFollow(TAIL_FOLLOW_PER_SECOND * followScale, deltaSeconds);
      point.x += (previous.x - point.x) * follow;
      point.y += (previous.y - point.y) * follow;
      point.timeMs = nowMs;
      point.speed = previous.speed;
    }
  }

  private createDrawablePoints(nowMs: number): TrailPoint[] {
    if (this.points.length === 0) {
      return [];
    }

    const idleAgeMs = clamp(nowMs - this.lastMovementMs, 0, maxPointAgeMs);
    const maxIndex = Math.max(1, this.points.length - 1);
    return this.points
      .map((point, index) => {
        const tailRatio = index / maxIndex;
        const ageMs = clamp(idleAgeMs + tailRatio * maxPointAgeMs * 0.68, 0, maxPointAgeMs);
        return {
          x: point.x,
          y: point.y,
          ageMs,
          timeMs: nowMs - ageMs,
          speed: point.speed
        };
      })
      .reverse();
  }

  private getChainDistance(): number {
    let distance = 0;
    for (let index = 1; index < this.points.length; index += 1) {
      distance += pointDistance(this.points[index - 1], this.points[index]);
    }
    return distance;
  }
}

export function getMotionPointCount(config: TrailConfig): number {
  return Math.round(clamp(config.trailLength * 0.5, MIN_MOTION_POINTS, MAX_MOTION_POINTS));
}

function getMotionPointCountFallback(): number {
  return Math.round((MIN_MOTION_POINTS + MAX_MOTION_POINTS) / 2);
}

function frameRateIndependentFollow(ratePerSecond: number, deltaSeconds: number): number {
  return 1 - Math.exp(-ratePerSecond * deltaSeconds);
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
