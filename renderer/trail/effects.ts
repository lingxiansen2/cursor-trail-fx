import { clamp, effectLabels, maxPointAgeMs } from "../../shared/config.js";
import type { TrailConfig, TrailEffectId } from "../../shared/types.js";
import type { TrailEffectPlugin, TrailPoint } from "./types.js";

export function createEffect(effect: TrailEffectId): TrailEffectPlugin {
  switch (effect) {
    case "cometTail":
      return createCometTail();
    case "prismPulse":
      return createPrismPulse();
    case "neonRibbon":
    default:
      return createNeonRibbon();
  }
}

function createNeonRibbon(): TrailEffectPlugin {
  return {
    id: "neonRibbon",
    label: effectLabels.neonRibbon,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      const white = { r: 255, g: 255, b: 255 };

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, points, {
        color: secondary,
        width: config.lineWidth * 2.2,
        alpha: config.opacity * 0.24,
        shadowBlur: 28
      });
      drawFadingPathFast(ctx, points, {
        color: primary,
        width: config.lineWidth,
        alpha: config.opacity * 0.8,
        shadowBlur: 18
      });
      drawFadingPathFast(ctx, points, {
        color: white,
        width: Math.max(2, config.lineWidth * 0.22),
        alpha: config.opacity * 0.82,
        shadowBlur: 4
      });
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config);
    }
  };
}

function createCometTail(): TrailEffectPlugin {
  return {
    id: "cometTail",
    label: effectLabels.cometTail,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, points, {
        color: secondary,
        width: config.lineWidth * 1.55,
        alpha: config.opacity * 0.35,
        shadowBlur: 24
      });
      drawFadingPathFast(ctx, points, {
        color: primary,
        width: config.lineWidth * 0.82,
        alpha: config.opacity * 0.9,
        shadowBlur: 18
      });
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 1.25);
    }
  };
}

function createPrismPulse(): TrailEffectPlugin {
  return {
    id: "prismPulse",
    label: effectLabels.prismPulse,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [index, point] of points.entries()) {
        const life = pointRecency(point, index, points.length);
        if (life < 0.08) {
          continue;
        }
        const radius = Math.max(2.5, config.lineWidth * (0.16 + life * 0.68));
        ctx.strokeStyle = colorWithAlphaFast(index % 2 === 0 ? primary : secondary, life * config.opacity * 0.48);
        ctx.lineWidth = Math.max(1, config.lineWidth * 0.18);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawFadingPathFast(ctx, points, {
        color: primary,
        width: config.lineWidth * 0.52,
        alpha: config.opacity * 0.52,
        shadowBlur: 10
      });
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 0.95);
    }
  };
}
function drawFadingPath(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  options: { color: string; width: number; alpha: number; shadowBlur: number }
): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = options.color;

  const samples = createSmoothSamples(points);
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    const recency = clamp((from.recency + to.recency * 1.35) / 2.35, 0, 1);
    const width = Math.max(0.7, options.width * (0.08 + Math.pow(recency, 1.35) * 0.98));
    const alpha = options.alpha * (0.04 + Math.pow(recency, 1.45) * 0.96);

    ctx.strokeStyle = colorWithAlpha(options.color, alpha);
    ctx.lineWidth = width;
    ctx.shadowBlur = options.shadowBlur * recency;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function drawFadingPathFast(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  options: { color: ParsedColor; width: number; alpha: number; shadowBlur: number }
): void {
  const samples = createSmoothSamples(points);
  if (samples.length < 2) return;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = `rgb(${options.color.r} ${options.color.g} ${options.color.b})`;
  ctx.shadowBlur = options.shadowBlur;
  ctx.lineWidth = options.width;

  // Render in fixed buckets along the path parameter instead of a single
  // spatial linear gradient.  A linear gradient from first→last projects
  // each pixel onto that axis, so any segment that deviates from the
  // first→last direction (sharp turns, vertical strokes after horizontal
  // movement) gets an incorrect alpha and can disappear entirely.
  // Bucket rendering avoids spatial projection: each bucket is one stroke
  // call with a uniform alpha derived from the midpoint recency value.
  const BUCKETS = 16;
  const n = samples.length;

  for (let b = 0; b < BUCKETS; b++) {
    const iStart = Math.round((b / BUCKETS) * (n - 1));
    const iEnd = Math.round(((b + 1) / BUCKETS) * (n - 1));
    if (iStart >= iEnd) continue;

    const iMid = Math.round((iStart + iEnd) / 2);
    const recency = samples[iMid].recency;
    const alpha = options.alpha * (0.04 + Math.pow(recency, 1.45) * 0.96);

    ctx.strokeStyle = colorWithAlphaFast(options.color, alpha);
    ctx.beginPath();
    ctx.moveTo(samples[iStart].x, samples[iStart].y);
    for (let i = iStart + 1; i <= iEnd; i++) {
      ctx.lineTo(samples[i].x, samples[i].y);
    }
    ctx.stroke();
  }
}

function drawCometHint(ctx: CanvasRenderingContext2D, points: TrailPoint[], config: TrailConfig, alphaScale: number): void {
  if (points.length < 2) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawFadingPath(ctx, points, {
    color: config.color,
    width: config.lineWidth * 0.6,
    alpha: config.opacity * alphaScale,
    shadowBlur: 12
  });
  ctx.restore();
}

function pointRecency(point: TrailPoint, index: number, pointCount: number): number {
  const ageRecency = 1 - clamp(point.ageMs / maxPointAgeMs, 0, 1);
  const orderRecency = pointCount <= 1 ? 1 : index / (pointCount - 1);
  return clamp(Math.pow(ageRecency, 1.2) * (0.05 + Math.pow(orderRecency, 1.25) * 0.95), 0, 1);
}

function createSmoothSamples(points: TrailPoint[]): Array<TrailPoint & { recency: number }> {
  if (points.length <= 2) {
    return points.map((point, index) => ({
      ...point,
      recency: pointRecency(point, index, points.length)
    }));
  }

  const samples: Array<TrailPoint & { recency: number }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(2, Math.ceil(distance / 4));

    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const point = catmullRom(p0, p1, p2, p3, t);
      const recencyFrom = pointRecency(p1, index, points.length);
      const recencyTo = pointRecency(p2, index + 1, points.length);
      samples.push({
        ...point,
        timeMs: p1.timeMs + (p2.timeMs - p1.timeMs) * t,
        ageMs: p1.ageMs + (p2.ageMs - p1.ageMs) * t,
        speed: p1.speed + (p2.speed - p1.speed) * t,
        recency: recencyFrom + (recencyTo - recencyFrom) * t
      });
    }
  }

  return samples;
}

function catmullRom(p0: TrailPoint, p1: TrailPoint, p2: TrailPoint, p3: TrailPoint, t: number): Pick<TrailPoint, "x" | "y"> {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

function drawCursorGlow(
  ctx: CanvasRenderingContext2D,
  point: TrailPoint | undefined,
  config: TrailConfig,
  scale = 1
): void {
  if (!point) {
    return;
  }

  const radius = config.lineWidth * 1.2 * scale;
  const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  gradient.addColorStop(0, colorWithAlpha("#ffffff", config.opacity * 0.9));
  gradient.addColorStop(0.32, colorWithAlpha(config.color, config.opacity * 0.45));
  gradient.addColorStop(1, colorWithAlpha(config.secondaryColor, 0));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

type ParsedColor = { r: number; g: number; b: number };

function parseColor(color: string): ParsedColor {
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function colorWithAlphaFast(parsed: ParsedColor, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  return `rgb(${parsed.r} ${parsed.g} ${parsed.b} / ${a.toFixed(2)})`;
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalizedAlpha = clamp(alpha, 0, 1);
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgb(${red} ${green} ${blue} / ${normalizedAlpha})`;
  }
  return color;
}

function noop(): void {
  // Intentionally empty for effects that are fully path based.
}
