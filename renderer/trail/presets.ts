import { effectRegistry } from "../../shared/config.js";
import type { TrailEffectId } from "../../shared/types.js";

export type TrailPreset = {
  id: TrailEffectId;
  label: string;
  description: string;
};

const effectDescriptions: Record<TrailEffectId, string> = {
  neonRibbon: "Soft glowing ribbon that follows the recent cursor path.",
  particleSpark: "Small sparks that scatter from fast pointer movement.",
  cometTail: "A fast tapered tail with a bright cursor head.",
  smokeTrail: "Slow expanding translucent puffs.",
  pixelGhost: "Retro square afterimages with stepped fading.",
  fluidBlob: "Layered luminous blobs that feel like liquid light."
};

export const trailPresets: readonly TrailPreset[] = effectRegistry.map((entry) => ({
  id: entry.id,
  label: entry.label,
  description: effectDescriptions[entry.id]
}));
