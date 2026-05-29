import { effectRegistry } from "../../shared/config.js";
import type { TrailEffectId } from "../../shared/types.js";

export type TrailPreset = {
  id: TrailEffectId;
  label: string;
  description: string;
};

const effectDescriptions: Record<TrailEffectId, string> = {
  neonRibbon: "Soft glowing ribbon that follows the recent cursor path.",
  cometTail: "A fast tapered tail with a bright cursor head.",
  prismPulse: "Prismatic pulses that expand along the most recent path.",
  inkBloom: "Soft liquid blobs that merge into an organic, uneven wake.",
  electricArc: "Jagged lightning strokes with deterministic side branches.",
  starWake: "A constellation-like wake of star particles and connecting lines."
};

export const trailPresets: readonly TrailPreset[] = effectRegistry.map((entry) => ({
  id: entry.id,
  label: entry.label,
  description: effectDescriptions[entry.id]
}));
