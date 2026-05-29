import { describe, expect, it } from "vitest";
import { defaultConfig, isTrailEffect, mergeConfig, nextTrailEffect, trailEffects, unionRects } from "../shared/config.js";
import { CursorFrameInterpolator, getInterpolationDelayMs } from "../renderer/trail/cursorFrameInterpolator.js";
import { CursorSampler } from "../renderer/trail/cursorSampler.js";
import { trailPresets } from "../renderer/trail/presets.js";
import { getMotionPointCount, TrailMotion } from "../renderer/trail/trailMotion.js";

describe("trail config", () => {
  it("normalizes invalid config values", () => {
    const merged = mergeConfig({
      effect: "not-real",
      opacity: 9,
      trailLength: 999,
      particleCount: -1,
      fpsCap: 5
    } as unknown as Partial<typeof defaultConfig>);

    expect(merged.effect).toBe(defaultConfig.effect);
    expect(merged.opacity).toBe(1);
    expect(merged.trailLength).toBe(260);
    expect(merged.particleCount).toBe(10);
    expect(merged.fpsCap).toBe(120);
  });

  it("cycles through configured effects", () => {
    expect(nextTrailEffect("neonRibbon")).toBe("cometTail");
    expect(nextTrailEffect(trailEffects.at(-1) ?? "prismPulse")).toBe(trailEffects[0]);
  });

  it("exposes a preset for every effect id", () => {
    expect(trailPresets.map((preset) => preset.id)).toEqual([...trailEffects]);
    expect(trailPresets.every((preset) => isTrailEffect(preset.id))).toBe(true);
  });
});

describe("desktop geometry", () => {
  it("unions multiple display rectangles", () => {
    expect(
      unionRects([
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: -1280, y: 120, width: 1280, height: 720 }
      ])
    ).toEqual({
      x: -1280,
      y: 0,
      width: 3200,
      height: 1080
    });
  });
});

describe("CursorSampler", () => {
  it("records cursor speed and limits point count", () => {
    const sampler = new CursorSampler({
      maxPoints: 3,
      minDistance: 0,
      maxSegmentLength: 999,
      maxInterpolationGapMs: 999
    });
    sampler.addPoint({ x: 0, y: 0 }, 0);
    sampler.addPoint({ x: 10, y: 0 }, 10);
    sampler.addPoint({ x: 20, y: 0 }, 20);
    sampler.addPoint({ x: 30, y: 0 }, 30);

    const points = sampler.getPoints();
    expect(points).toHaveLength(3);
    expect(points[0].x).toBe(10);
    expect(points[0].speed).toBe(1000);
  });

  it("filters tiny pointer movements", () => {
    const sampler = new CursorSampler({ maxPoints: 10, minDistance: 4 });
    expect(sampler.addPoint({ x: 10, y: 10 }, 0)).toBeDefined();
    expect(sampler.addPoint({ x: 12, y: 10 }, 16)).toBeUndefined();
    expect(sampler.getPoints()).toHaveLength(1);
  });

  it("adds interpolated points for fast pointer jumps", () => {
    const sampler = new CursorSampler({ maxPoints: 20, minDistance: 0, maxSegmentLength: 5 });
    sampler.addPoint({ x: 0, y: 0 }, 0);
    sampler.addPoint({ x: 20, y: 0 }, 20);

    const points = sampler.getPoints();
    expect(points.map((point) => point.x)).toEqual([0, 5, 10, 15, 20]);
    expect(points.at(-1)?.speed).toBe(1000);
  });

  it("adds time-based interpolation points when raw sampling is too sparse", () => {
    const sampler = new CursorSampler({
      maxPoints: 20,
      minDistance: 0,
      maxSegmentLength: 999,
      maxInterpolationGapMs: 5
    });
    sampler.addPoint({ x: 0, y: 0 }, 0);
    sampler.addPoint({ x: 20, y: 0 }, 20);

    const points = sampler.getPoints();
    expect(points.map((point) => point.x)).toEqual([0, 5, 10, 15, 20]);
  });

  it("ages and expires stale points", () => {
    const sampler = new CursorSampler({ maxPoints: 10, minDistance: 0 });
    sampler.addPoint({ x: 0, y: 0 }, 0);
    sampler.addPoint({ x: 10, y: 0 }, 100);
    sampler.updateAges(1000, 500);

    expect(sampler.getPoints()).toHaveLength(0);
  });

  it("does not recreate a static cursor point after the trail expires", () => {
    const sampler = new CursorSampler({ maxPoints: 10, minDistance: 1 });
    sampler.addPoint({ x: 10, y: 10 }, 0);
    sampler.updateAges(1000, 500);

    expect(sampler.getPoints()).toHaveLength(0);
    expect(sampler.addPoint({ x: 10, y: 10 }, 1008)).toBeUndefined();
    expect(sampler.getPoints()).toHaveLength(0);
  });
});

describe("CursorFrameInterpolator", () => {
  it("interpolates buffered high-frequency samples at display time", () => {
    const interpolator = new CursorFrameInterpolator();
    interpolator.push({ x: 0, y: 0 }, 0);
    interpolator.push({ x: 20, y: 0 }, 20);

    expect(interpolator.sampleAt(8)).toMatchObject({ x: 8, y: 0, timeMs: 8 });
    expect(interpolator.sampleAt(14)).toMatchObject({ x: 14, y: 0, timeMs: 14 });
  });

  it("does not emit repeated positions once movement has settled", () => {
    const interpolator = new CursorFrameInterpolator();
    interpolator.push({ x: 15, y: 4 }, 0);

    expect(interpolator.sample(20, 1000 / 75)).toMatchObject({ x: 15, y: 4 });
    expect(interpolator.sample(40, 1000 / 75)).toBeUndefined();
  });

  it("bridges long stationary gaps before a new movement segment", () => {
    const interpolator = new CursorFrameInterpolator();
    interpolator.push({ x: 0, y: 0 }, 0);
    interpolator.push({ x: 100, y: 0 }, 1000);

    expect(interpolator.sampleAt(992)).toMatchObject({ x: 0, y: 0, timeMs: 992 });
    expect(interpolator.sampleAt(996)).toMatchObject({ x: 50, y: 0, timeMs: 996 });
  });

  it("predicts just beyond the newest cursor sample instead of holding stale input", () => {
    const interpolator = new CursorFrameInterpolator();
    interpolator.push({ x: 0, y: 0 }, 0);
    interpolator.push({ x: 20, y: 0 }, 10);

    expect(interpolator.sampleAt(15)).toMatchObject({ x: 30, y: 0, timeMs: 15 });
  });

  it("does not extrapolate tiny slow movements beyond the newest sample", () => {
    const interpolator = new CursorFrameInterpolator();
    interpolator.push({ x: 100, y: 100 }, 0);
    interpolator.push({ x: 101, y: 100 }, 20);

    expect(interpolator.sampleAt(32)).toMatchObject({ x: 101, y: 100, timeMs: 20 });
  });

  it("uses bounded frame-relative buffering for low-refresh displays", () => {
    expect(getInterpolationDelayMs(1000 / 240, 1000 / 240)).toBe(2);
    expect(getInterpolationDelayMs(1000 / 75, 1000 / 240)).toBeCloseTo(3.1, 1);
    expect(getInterpolationDelayMs(1000 / 75, 16)).toBeCloseTo(6, 1);
  });
});

describe("TrailMotion", () => {
  it("uses a bounded follower point count derived from trailLength", () => {
    expect(getMotionPointCount({ ...defaultConfig, trailLength: 16 })).toBe(12);
    expect(getMotionPointCount({ ...defaultConfig, trailLength: 120 })).toBe(60);
    expect(getMotionPointCount({ ...defaultConfig, trailLength: 260 })).toBe(72);
  });

  it("advances a smooth follower chain every frame", () => {
    const motion = new TrailMotion(defaultConfig);
    motion.setTarget({ x: 0, y: 0 }, 0);
    motion.update(16, 16, defaultConfig);
    motion.setTarget({ x: 100, y: 0 }, 20);
    motion.update(16, 36, defaultConfig);

    const points = motion.getPoints();
    expect(points).toHaveLength(getMotionPointCount(defaultConfig));
    expect(points.at(-1)?.x).toBeGreaterThan(points[0].x);
    expect(points.at(-1)?.ageMs).toBeLessThan(points[0].ageMs);
  });
});
