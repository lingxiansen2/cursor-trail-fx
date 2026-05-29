export type Point = {
  x: number;
  y: number;
};

export type CursorPosition = Point & {
  timestampMs: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Rect = Point & Size;

export type TrailEffectId =
  | "neonRibbon"
  | "cometTail"
  | "prismPulse"
  | "inkBloom"
  | "electricArc"
  | "starWake";

export type HotkeyConfig = {
  nextEffect: string;
  toggleEnabled: string;
};

export type TrailConfig = {
  enabled: boolean;
  effect: TrailEffectId;
  hotkey: HotkeyConfig;
  fpsCap: number;
  opacity: number;
  trailLength: number;
  particleCount: number;
  lineWidth: number;
  color: string;
  secondaryColor: string;
  windowSize: Size;
};

export type CursorSnapshot = {
  cursor: Point;
  overlayBounds: Rect;
  displays: Rect[];
  enabled: boolean;
  effect: TrailEffectId;
};

export type TrailCommand =
  | {
      type: "effect-changed";
      effect: TrailEffectId;
    }
  | {
      type: "enabled-changed";
      enabled: boolean;
    }
  | {
      type: "config-changed";
      config: TrailConfig;
    }
  | {
      type: "overlay-bounds-changed";
      overlayBounds: Rect;
    }
  | {
      type: "hotkey-error";
      accelerator: string;
    }
  | {
      type: "cursor-position";
      position: CursorPosition;
    }
  | {
      type: "reset-trail";
    };

export type TrailRuntimeApi = {
  getConfig: () => Promise<TrailConfig>;
  getCursorSnapshot: () => Promise<CursorSnapshot>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setEffect: (effect: TrailEffectId) => Promise<void>;
  nextEffect: () => Promise<TrailEffectId>;
  onCommand: (callback: (command: TrailCommand) => void) => () => void;
  onCursor: (callback: (snapshot: CursorSnapshot) => void) => () => void;
  onCursorPosition: (callback: (position: CursorPosition) => void) => () => void;
};

declare global {
  interface Window {
    trailApi?: TrailRuntimeApi;
    settingsApi?: {
      getData: () => Promise<{ config: Record<string, unknown>; effects: Array<{ id: string; label: string }>; autoLaunch: boolean }>;
      save: (config: Record<string, unknown>, autoLaunch: boolean) => Promise<boolean>;
      openUserData: () => Promise<void>;
      close: () => void;
    };
  }
}
