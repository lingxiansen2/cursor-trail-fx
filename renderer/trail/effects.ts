import { clamp, effectLabels, maxPointAgeMs } from "../../shared/config.js";
import type { Point, TrailConfig, TrailEffectId } from "../../shared/types.js";
import type { TrailEffectPlugin, TrailPoint } from "./types.js";

type SmoothTrailSample = TrailPoint & {
  recency: number;
};

export function createEffect(effect: TrailEffectId): TrailEffectPlugin {
  switch (effect) {
    case "cometTail":
      return createCometTail();
    case "prismPulse":
      return createPrismPulse();
    case "inkBloom":
      return createInkBloom();
    case "electricArc":
      return createElectricArc();
    case "starWake":
      return createStarWake();
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
      const samples = createSmoothSamples(points);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, samples, {
        color: secondary,
        width: config.lineWidth * 4.3,
        alpha: config.opacity * 0.2,
        shadowBlur: 34
      });
      drawFadingPathFast(ctx, samples, {
        color: primary,
        width: config.lineWidth * 2.05,
        alpha: config.opacity * 0.42,
        shadowBlur: 24
      });
      drawFadingPathFast(ctx, samples, {
        color: primary,
        width: config.lineWidth * 0.86,
        alpha: config.opacity * 0.92,
        shadowBlur: 16
      });
      drawFadingPathFast(ctx, samples, {
        color: white,
        width: Math.max(2, config.lineWidth * 0.18),
        alpha: config.opacity * 0.9,
        shadowBlur: 6
      });
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 1.05);
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
      const samples = createSmoothSamples(points);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, samples, {
        color: secondary,
        width: config.lineWidth * 1.12,
        alpha: config.opacity * 0.22,
        shadowBlur: 18
      });
      drawFadingPathFast(ctx, samples, {
        color: primary,
        width: config.lineWidth * 0.46,
        alpha: config.opacity * 0.98,
        shadowBlur: 12
      });
      drawCometSparks(ctx, points, primary, secondary, config);
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 1.75);
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
      const samples = createSmoothSamples(points);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, samples, {
        color: secondary,
        width: config.lineWidth * 0.28,
        alpha: config.opacity * 0.42,
        shadowBlur: 6
      });
      drawPrismAngularPath(ctx, points, primary, secondary, config);
      drawPrismPulses(ctx, points, primary, secondary, config);
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 0.78);
    }
  };
}

function createInkBloom(): TrailEffectPlugin {
  return {
    id: "inkBloom",
    label: effectLabels.inkBloom,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config, 1.35);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      const samples = createSmoothSamples(points);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawFadingPathFast(ctx, samples, {
        color: secondary,
        width: config.lineWidth * 2.6,
        alpha: config.opacity * 0.16,
        shadowBlur: 20
      });
      drawInkBlobs(ctx, points, primary, secondary, config);
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 1.5);
    }
  };
}

function createElectricArc(): TrailEffectPlugin {
  return {
    id: "electricArc",
    label: effectLabels.electricArc,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config, 0.9);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawElectricMain(ctx, points, primary, secondary, config);
      drawElectricBranches(ctx, points, primary, secondary, config);
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 0.82);
    }
  };
}

function createStarWake(): TrailEffectPlugin {
  return {
    id: "starWake",
    label: effectLabels.starWake,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      if (points.length < 2) {
        drawCursorGlow(ctx, points.at(-1), config, 1);
        return;
      }

      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawStarConnections(ctx, points, primary, config);
      drawStarParticles(ctx, points, primary, secondary, config);
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config, 1.1);
    }
  };
}

function drawCometSparks(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(2, Math.floor(points.length / 28));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const life = pointRecency(point, index, points.length);
    if (life < 0.12) {
      continue;
    }

    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const len = Math.hypot(dx, dy) || 1;
    const normalX = -dy / len;
    const normalY = dx / len;
    const scatter = config.lineWidth * (0.8 + (index % 5) * 0.35) * (1 - life * 0.25);
    const side = index % 2 === 0 ? 1 : -1;
    const x = point.x + normalX * scatter * side;
    const y = point.y + normalY * scatter * side;
    const radius = Math.max(1.2, config.lineWidth * (0.08 + life * 0.18));

    ctx.fillStyle = colorWithAlphaFast(index % 3 === 0 ? secondary : primary, config.opacity * life * 0.7);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPrismAngularPath(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(2, Math.floor(points.length / 16));
  const anchors = points.filter((_point, index) => index % stride === 0);
  if (anchors.length < 2) {
    return;
  }

  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.shadowBlur = 18;
  ctx.lineWidth = Math.max(1.5, config.lineWidth * 0.22);
  ctx.beginPath();
  ctx.moveTo(anchors[0].x, anchors[0].y);
  for (let index = 1; index < anchors.length; index += 1) {
    ctx.lineTo(anchors[index].x, anchors[index].y);
  }
  ctx.strokeStyle = colorWithAlphaFast(primary, config.opacity * 0.72);
  ctx.shadowColor = `rgb(${secondary.r} ${secondary.g} ${secondary.b})`;
  ctx.stroke();
}

function drawPrismPulses(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(2, Math.floor(points.length / 18));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const life = pointRecency(point, index, points.length);
    if (life < 0.1) {
      continue;
    }

    const radius = Math.max(3, config.lineWidth * (0.22 + life * 0.9));
    const sides = index % 2 === 0 ? 3 : 4;
    ctx.lineWidth = Math.max(1, config.lineWidth * 0.12);
    ctx.shadowBlur = 12 * life;
    ctx.shadowColor = `rgb(${primary.r} ${primary.g} ${primary.b})`;
    ctx.strokeStyle = colorWithAlphaFast(index % 2 === 0 ? primary : secondary, life * config.opacity * 0.7);
    drawPolygonStroke(ctx, point.x, point.y, radius, sides, index * 0.37);

    ctx.fillStyle = colorWithAlphaFast(index % 2 === 0 ? secondary : primary, life * config.opacity * 0.16);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPolygonStroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number
): void {
  ctx.beginPath();
  for (let side = 0; side <= sides; side += 1) {
    const angle = rotation + (side / sides) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (side === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

function drawInkBlobs(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(1, Math.floor(points.length / 44));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const life = pointRecency(point, index, points.length);
    if (life < 0.08) {
      continue;
    }

    const wobble = Math.sin(index * 1.73) * 0.5 + Math.cos(index * 0.61) * 0.5;
    const radius = config.lineWidth * (0.42 + life * 1.48 + Math.abs(wobble) * 0.38);
    const color = index % 4 === 0 ? secondary : primary;
    ctx.fillStyle = colorWithAlphaFast(color, config.opacity * life * 0.34);
    ctx.shadowColor = `rgb(${color.r} ${color.g} ${color.b})`;
    ctx.shadowBlur = radius * 0.72;
    ctx.beginPath();
    ctx.ellipse(
      point.x + Math.sin(index * 0.91) * radius * 0.18,
      point.y + Math.cos(index * 1.17) * radius * 0.18,
      radius * (1.15 + wobble * 0.16),
      radius * (0.68 - wobble * 0.08),
      wobble * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawElectricMain(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const anchors = createJaggedAnchors(points, config.lineWidth * 0.72, 2);
  if (anchors.length < 2) {
    return;
  }

  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.shadowColor = `rgb(${secondary.r} ${secondary.g} ${secondary.b})`;
  ctx.shadowBlur = 28;
  ctx.lineWidth = Math.max(2, config.lineWidth * 0.34);
  ctx.strokeStyle = colorWithAlphaFast(secondary, config.opacity * 0.42);
  strokePolyline(ctx, anchors);

  ctx.shadowColor = `rgb(${primary.r} ${primary.g} ${primary.b})`;
  ctx.shadowBlur = 10;
  ctx.lineWidth = Math.max(1.2, config.lineWidth * 0.13);
  ctx.strokeStyle = colorWithAlphaFast({ r: 255, g: 255, b: 255 }, config.opacity * 0.9);
  strokePolyline(ctx, anchors);
}

function drawElectricBranches(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(3, Math.floor(points.length / 18));
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(1, config.lineWidth * 0.08);
  ctx.shadowBlur = 12;
  for (let index = stride; index < points.length - 1; index += stride) {
    const point = points[index];
    const life = pointRecency(point, index, points.length);
    if (life < 0.18) {
      continue;
    }

    const previous = points[index - 1];
    const next = points[index + 1];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const len = Math.hypot(dx, dy) || 1;
    const side = index % 2 === 0 ? 1 : -1;
    const normalX = (-dy / len) * side;
    const normalY = (dx / len) * side;
    const length = config.lineWidth * (1.6 + life * 2.7);
    const midX = point.x + normalX * length * 0.48 + dx / len * length * 0.18;
    const midY = point.y + normalY * length * 0.48 + dy / len * length * 0.18;
    const endX = point.x + normalX * length;
    const endY = point.y + normalY * length;
    const color = index % 3 === 0 ? secondary : primary;
    ctx.strokeStyle = colorWithAlphaFast(color, config.opacity * life * 0.62);
    ctx.shadowColor = `rgb(${color.r} ${color.g} ${color.b})`;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(midX, midY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
}

function drawStarConnections(ctx: CanvasRenderingContext2D, points: TrailPoint[], primary: ParsedColor, config: TrailConfig): void {
  const stride = Math.max(2, Math.floor(points.length / 24));
  const anchors = points.filter((_point, index) => index % stride === 0);
  if (anchors.length < 2) {
    return;
  }

  ctx.lineWidth = Math.max(0.8, config.lineWidth * 0.08);
  ctx.shadowBlur = 8;
  ctx.shadowColor = `rgb(${primary.r} ${primary.g} ${primary.b})`;
  ctx.strokeStyle = colorWithAlphaFast(primary, config.opacity * 0.28);
  for (let index = 1; index < anchors.length; index += 1) {
    const from = anchors[index - 1];
    const to = anchors[index];
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (index > 1 && index % 3 === 0) {
      const branch = anchors[index - 2];
      ctx.beginPath();
      ctx.moveTo(branch.x, branch.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }
}

function drawStarParticles(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  primary: ParsedColor,
  secondary: ParsedColor,
  config: TrailConfig
): void {
  const stride = Math.max(2, Math.floor(points.length / 34));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const life = pointRecency(point, index, points.length);
    if (life < 0.1) {
      continue;
    }

    const color = index % 2 === 0 ? primary : secondary;
    const radius = Math.max(2.2, config.lineWidth * (0.11 + life * 0.24));
    ctx.fillStyle = colorWithAlphaFast(color, config.opacity * life * 0.78);
    ctx.shadowColor = `rgb(${color.r} ${color.g} ${color.b})`;
    ctx.shadowBlur = 18 * life;
    drawStar(ctx, point.x, point.y, radius * 2.4, radius, 5, index * 0.31);
  }
}

function createJaggedAnchors(points: TrailPoint[], amplitude: number, stride: number): Point[] {
  const anchors: Point[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const len = Math.hypot(dx, dy) || 1;
    const normalX = -dy / len;
    const normalY = dx / len;
    const jitter = Math.sin(index * 2.41) * amplitude * (0.25 + pointRecency(point, index, points.length) * 0.75);
    anchors.push({
      x: point.x + normalX * jitter,
      y: point.y + normalY * jitter
    });
  }
  return anchors;
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.stroke();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  rotation: number
): void {
  ctx.beginPath();
  for (let index = 0; index <= points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + (index / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.fill();
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
  samples: SmoothTrailSample[],
  options: { color: ParsedColor; width: number; alpha: number; shadowBlur: number }
): void {
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
  const BUCKETS = 10;
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

function createSmoothSamples(points: TrailPoint[]): SmoothTrailSample[] {
  if (points.length <= 2) {
    return points.map((point, index) => ({
      ...point,
      recency: pointRecency(point, index, points.length)
    }));
  }

  const samples: SmoothTrailSample[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.min(8, Math.ceil(distance / 8)));

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
