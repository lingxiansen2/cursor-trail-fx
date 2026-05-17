import type { Point, TrailConfig, TrailEffectId } from "../../shared/types.js";

export type TrailPoint = Point & {
  timeMs: number;
  ageMs: number;
  speed: number;
};

export type TrailParticle = Point & {
  vx: number;
  vy: number;
  lifeMs: number;
  maxLifeMs: number;
  size: number;
  spin: number;
};

export type TrailEffectPlugin = {
  id: TrailEffectId;
  label: string;
  reset: () => void;
  emit: (point: TrailPoint, previous: TrailPoint | undefined, config: TrailConfig) => void;
  update: (deltaMs: number, config: TrailConfig) => void;
  draw: (ctx: CanvasRenderingContext2D, points: TrailPoint[], config: TrailConfig) => void;
};
