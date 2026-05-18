import { describe, expect, it, vi, beforeEach } from "vitest";
import { defaultConfig, effectRegistry, isTrailEffect, maxPointAgeMs, mergeConfig, nextTrailEffect, trailEffects } from "../shared/config.js";
import { CursorSampler } from "../renderer/trail/cursorSampler.js";
import { createEffect } from "../renderer/trail/effects.js";
import { trailPresets } from "../renderer/trail/presets.js";

describe("effect registry", () => {
  it("contains an entry for every effect id", () => {
    expect(effectRegistry.map((e) => e.id)).toEqual([...trailEffects]);
    expect(effectRegistry.every((e) => isTrailEffect(e.id))).toBe(true);
  });

  it("exposes labels for all effects", () => {
    for (const entry of effectRegistry) {
      expect(entry.label).toBeDefined();
      expect(typeof entry.label).toBe("string");
    }
  });
});

describe("maxPointAgeMs", () => {
  it("is exported as a positive number", () => {
    expect(maxPointAgeMs).toBe(900);
  });
});

describe("createEffect", () => {
  it("creates a valid plugin for each effect id", () => {
    for (const effectId of trailEffects) {
      const plugin = createEffect(effectId);
      expect(plugin.id).toBe(effectId);
      expect(plugin.label).toBeDefined();
      expect(typeof plugin.reset).toBe("function");
      expect(typeof plugin.emit).toBe("function");
      expect(typeof plugin.update).toBe("function");
      expect(typeof plugin.draw).toBe("function");
    }
  });

  it("returns neonRibbon for unknown effect", () => {
    const plugin = createEffect("unknown" as any);
    expect(plugin.id).toBe("neonRibbon");
  });

  it("resets without throwing", () => {
    for (const effectId of trailEffects) {
      const plugin = createEffect(effectId);
      expect(() => plugin.reset()).not.toThrow();
    }
  });
});

describe("TrailEngine", () => {
  function createMockCanvas() {
    const canvas = {
      width: 1920,
      height: 1080,
      style: { width: "", height: "" }
    } as HTMLCanvasElement;

    const ctx = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn()
      })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn()
      })),
      globalCompositeOperation: "",
      shadowColor: "",
      shadowBlur: 0,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      lineJoin: "round",
      lineCap: "round"
    } as any;

    (canvas as any).getContext = () => ctx;
    return { canvas, ctx };
  }

  it("initializes without throwing", async () => {
    const { TrailEngine } = await import("../renderer/trail/trailEngine.js");
    const { canvas } = createMockCanvas();
    expect(() => new TrailEngine(canvas)).not.toThrow();
  });

  it("clears lastPoint on setEffect", async () => {
    const { TrailEngine } = await import("../renderer/trail/trailEngine.js");
    const { canvas } = createMockCanvas();
    const engine = new TrailEngine(canvas);
    engine.pushCursor({ x: 0, y: 0 }, 0);
    engine.pushCursor({ x: 10, y: 0 }, 10);
    engine.setEffect("prismPulse");
    engine.pushCursor({ x: 20, y: 0 }, 20);
    expect(() => engine.render()).not.toThrow();
  });

  it("clears all state on clear()", async () => {
    const { TrailEngine } = await import("../renderer/trail/trailEngine.js");
    const { canvas, ctx } = createMockCanvas();
    const engine = new TrailEngine(canvas);
    engine.pushCursor({ x: 0, y: 0 }, 0);
    engine.pushCursor({ x: 10, y: 0 }, 10);
    engine.clear();
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("resizes canvas with correct dimensions", async () => {
    const { TrailEngine } = await import("../renderer/trail/trailEngine.js");
    const { canvas } = createMockCanvas();
    const engine = new TrailEngine(canvas);
    engine.resize(800, 600, 2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe("800px");
    expect(canvas.style.height).toBe("600px");
  });

  it("toggles enabled state", async () => {
    const { TrailEngine } = await import("../renderer/trail/trailEngine.js");
    const { canvas, ctx } = createMockCanvas();
    const engine = new TrailEngine(canvas);
    engine.setEnabled(false);
    engine.pushCursor({ x: 0, y: 0 }, 0);
    engine.render();
    expect(ctx.clearRect).toHaveBeenCalled();
  });
});

describe("presets consistency", () => {
  it("presets match registry", () => {
    expect(trailPresets.map((p) => p.id)).toEqual([...trailEffects]);
  });

  it("all presets have descriptions", () => {
    for (const preset of trailPresets) {
      expect(preset.description).toBeDefined();
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});
