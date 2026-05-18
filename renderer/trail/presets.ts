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
  prismPulse: "Prismatic pulses that expand along the most recent path."
};

export const trailPresets: readonly TrailPreset[] = effectRegistry.map((entry) => ({
  id: entry.id,
  label: entry.label,
  description: effectDescriptions[entry.id]
}));
