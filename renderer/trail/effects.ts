import { clamp, effectLabels, maxPointAgeMs } from "../../shared/config.js";
import type { TrailConfig, TrailEffectId } from "../../shared/types.js";
import type { TrailEffectPlugin, TrailParticle, TrailPoint } from "./types.js";

export function createEffect(effect: TrailEffectId): TrailEffectPlugin {
  switch (effect) {
    case "particleSpark":
      return createParticleSpark();
    case "cometTail":
      return createCometTail();
    case "smokeTrail":
      return createSmokeTrail();
    case "pixelGhost":
      return createPixelGhost();
    case "fluidBlob":
      return createFluidBlob();
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

function createParticleSpark(): TrailEffectPlugin {
  let particles: TrailParticle[] = [];

  return {
    id: "particleSpark",
    label: effectLabels.particleSpark,
    reset: () => {
      particles = [];
    },
    emit: (point, previous, config) => {
      if (!previous) {
        return;
      }
      const intensity = clamp(point.speed / 1500, 0.15, 1.5);
      const count = Math.max(1, Math.round(3 * intensity));
      for (let i = 0; i < count; i += 1) {
        const angle = Math.atan2(point.y - previous.y, point.x - previous.x) + Math.PI + randomRange(-0.9, 0.9);
        const force = randomRange(55, 180) * intensity;
        particles.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * force,
          vy: Math.sin(angle) * force + randomRange(-30, 30),
          lifeMs: randomRange(320, 680),
          maxLifeMs: 680,
          size: randomRange(2, 5.5) * intensity,
          spin: randomRange(-0.4, 0.4)
        });
      }
      particles = particles.slice(-config.particleCount);
    },
    update: (deltaMs) => {
      particles = updateParticles(particles, deltaMs, 18);
    },
    draw: (ctx, points, config) => {
      drawCometHint(ctx, points, config, 0.28);
      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const particle of particles) {
        const life = particle.lifeMs / particle.maxLifeMs;
        ctx.fillStyle = colorWithAlphaFast(life > 0.55 ? primary : secondary, life * config.opacity);
        ctx.shadowColor = config.color;
        ctx.shadowBlur = 10 * life;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, particle.size * life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };
}

function createSmokeTrail(): TrailEffectPlugin {
  let particles: TrailParticle[] = [];
  let cachedBlob: HTMLCanvasElement | null = null;
  let cachedColor = "";
  let cachedSecondary = "";

  function getBlobCanvas(color: string, secondaryColor: string): HTMLCanvasElement {
    if (cachedBlob && cachedColor === color && cachedSecondary === secondaryColor) {
      return cachedBlob;
    }

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, colorWithAlpha(color, 1));
    gradient.addColorStop(0.7, colorWithAlpha(secondaryColor, 0.35));
    gradient.addColorStop(1, colorWithAlpha(secondaryColor, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();

    cachedBlob = canvas;
    cachedColor = color;
    cachedSecondary = secondaryColor;
    return canvas;
  }

  return {
    id: "smokeTrail",
    label: effectLabels.smokeTrail,
    reset: () => {
      particles = [];
    },
    emit: (point, previous, config) => {
      if (!previous) {
        return;
      }
      const speed = clamp(point.speed / 1200, 0.2, 1);
      particles.push({
        x: point.x + randomRange(-4, 4),
        y: point.y + randomRange(-4, 4),
        vx: randomRange(-16, 16),
        vy: randomRange(-26, 6),
        lifeMs: randomRange(700, 1100),
        maxLifeMs: 1100,
        size: randomRange(10, 24) * speed,
        spin: randomRange(-0.3, 0.3)
      });
      particles = particles.slice(-config.particleCount);
    },
    update: (deltaMs) => {
      particles = updateParticles(particles, deltaMs, 7);
    },
    draw: (ctx, _points, config) => {
      const blobCanvas = getBlobCanvas(config.color, config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      for (const particle of particles) {
        const life = particle.lifeMs / particle.maxLifeMs;
        const radius = particle.size * (0.42 + life * 1.05);
        const alpha = Math.pow(life, 1.35) * config.opacity * 0.3;
        const drawSize = radius * 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(blobCanvas, particle.x - radius, particle.y - radius, drawSize, drawSize);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  };
}

function createPixelGhost(): TrailEffectPlugin {
  let particles: TrailParticle[] = [];

  return {
    id: "pixelGhost",
    label: effectLabels.pixelGhost,
    reset: () => {
      particles = [];
    },
    emit: (point, previous, config) => {
      if (!previous) {
        return;
      }
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const count = Math.max(1, Math.round(distance / 16));
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.round((point.x + randomRange(-9, 9)) / 6) * 6,
          y: Math.round((point.y + randomRange(-9, 9)) / 6) * 6,
          vx: randomRange(-8, 8),
          vy: randomRange(-8, 8),
          lifeMs: randomRange(260, 520),
          maxLifeMs: 520,
          size: randomRange(5, 13),
          spin: randomRange(-0.2, 0.2)
        });
      }
      particles = particles.slice(-config.particleCount);
    },
    update: (deltaMs) => {
      particles = updateParticles(particles, deltaMs, 0);
    },
    draw: (ctx, points, config) => {
      drawCometHint(ctx, points, config, 0.16);
      const primary = parseColor(config.color);
      const secondary = parseColor(config.secondaryColor);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      for (const particle of particles) {
        const life = particle.lifeMs / particle.maxLifeMs;
        ctx.fillStyle = colorWithAlphaFast(life > 0.5 ? primary : secondary, life * config.opacity * 0.85);
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      ctx.restore();
    }
  };
}

function createFluidBlob(): TrailEffectPlugin {
  let cachedBlob: HTMLCanvasElement | null = null;
  let cachedColor = "";
  let cachedSecondary = "";

  function getBlobCanvas(color: string, secondaryColor: string): HTMLCanvasElement {
    if (cachedBlob && cachedColor === color && cachedSecondary === secondaryColor) {
      return cachedBlob;
    }

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, colorWithAlpha(color, 1));
    gradient.addColorStop(0.48, colorWithAlpha(secondaryColor, 0.38));
    gradient.addColorStop(1, colorWithAlpha(secondaryColor, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();

    cachedBlob = canvas;
    cachedColor = color;
    cachedSecondary = secondaryColor;
    return canvas;
  }

  return {
    id: "fluidBlob",
    label: effectLabels.fluidBlob,
    reset: noop,
    emit: noop,
    update: noop,
    draw: (ctx, points, config) => {
      const blobCanvas = getBlobCanvas(config.color, config.secondaryColor);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [index, point] of points.entries()) {
        const life = pointRecency(point, index, points.length);
        const radius = Math.max(3, config.lineWidth * (0.2 + Math.pow(life, 1.35) * 2.05));
        const alpha = Math.pow(life, 1.2) * config.opacity * 0.52;
        const drawSize = radius * 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(blobCanvas, point.x - radius, point.y - radius, drawSize, drawSize);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      drawCursorGlow(ctx, points.at(-1), config);
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

function updateParticles(particles: TrailParticle[], deltaMs: number, drift: number): TrailParticle[] {
  const dt = deltaMs / 1000;
  let write = 0;
  for (let read = 0; read < particles.length; read++) {
    const p = particles[read];
    p.lifeMs -= deltaMs;
    if (p.lifeMs <= 0) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
    p.vy *= 0.985 - drift * dt;
    p.size += p.spin * deltaMs;
    if (write !== read) particles[write] = p;
    write++;
  }
  particles.length = write;
  return particles;
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

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function noop(): void {
  // Intentionally empty for effects that are fully path based.
}
