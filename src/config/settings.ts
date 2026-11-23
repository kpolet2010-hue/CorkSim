import type { GameAction } from '../input/actions';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface CameraSettings {
  distance: number;
  height: number;
  /** How quickly the camera swings behind the direction of travel (0.2 - 3). */
  sensitivity: number;
  /** Position follow sharpness (higher = tighter). */
  smoothing: number;
  fov: number;
}

export interface AudioSettings {
  master: number;
  effects: number;
  ambience: number;
  muted: boolean;
}

export type KeyBindings = Record<GameAction, string[]>;

export interface GameSettings {
  graphics: GraphicsQuality;
  /** Render resolution scale 0.5 - 1. */
  resolutionScale: number;
  camera: CameraSettings;
  audio: AudioSettings;
  bindings: KeyBindings;
  showFps: boolean;
  landingAssist: boolean;
}

/** Defaults use KeyboardEvent.code so they work on any keyboard layout. */
export const DEFAULT_BINDINGS: KeyBindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  forward: ['KeyW'],
  back: ['KeyS'],
  jump: ['Space'],
  grab1: ['KeyQ'],
  grab2: ['KeyE'],
  grab3: ['ShiftLeft', 'ShiftRight'],
  grab4: ['KeyF'],
  tweakLeft: ['ArrowLeft'],
  tweakRight: ['ArrowRight'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  reset: ['Backspace'],
  camera: ['KeyC'],
};

export const ACTION_LABELS: Record<GameAction, string> = {
  left: 'Carve left / Spin left / Balance',
  right: 'Carve right / Spin right / Balance',
  forward: 'Push & tuck / Frontflip / Nose press',
  back: 'Brake / Backflip / Tail press',
  jump: 'Charge & jump / Pop off rail',
  grab1: 'Grab 1 (Mute)',
  grab2: 'Grab 2 (Safety)',
  grab3: 'Grab 3 (Tail)',
  grab4: 'Grab 4 (Method)',
  tweakLeft: 'Off-axis roll left',
  tweakRight: 'Off-axis roll right',
  pause: 'Pause',
  restart: 'Restart run',
  reset: 'Reset skier in place',
  camera: 'Cycle camera',
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: 'high',
  resolutionScale: 1,
  camera: { distance: 5.2, height: 1.9, sensitivity: 1, smoothing: 7, fov: 62 },
  audio: { master: 0.8, effects: 0.9, ambience: 0.6, muted: false },
  bindings: DEFAULT_BINDINGS,
  showFps: false,
  landingAssist: true,
};

const STORAGE_KEY = 'freeski.settings.v1';

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Merges untrusted stored data onto the defaults, validating every field. */
export function sanitizeSettings(raw: unknown): GameSettings {
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return structuredClone(d);
  const r = raw as Partial<GameSettings>;
  const cam = (r.camera ?? {}) as Partial<CameraSettings>;
  const aud = (r.audio ?? {}) as Partial<AudioSettings>;
  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (r.bindings && typeof r.bindings === 'object') {
    for (const key of Object.keys(bindings) as GameAction[]) {
      const v = (r.bindings as Partial<KeyBindings>)[key];
      if (Array.isArray(v) && v.every((c) => typeof c === 'string')) bindings[key] = v.slice(0, 3);
    }
  }
  return {
    graphics:
      r.graphics === 'low' || r.graphics === 'medium' || r.graphics === 'high' ? r.graphics : d.graphics,
    resolutionScale: clampNum(r.resolutionScale, 0.5, 1, d.resolutionScale),
    camera: {
      distance: clampNum(cam.distance, 3, 10, d.camera.distance),
      height: clampNum(cam.height, 0.8, 4, d.camera.height),
      sensitivity: clampNum(cam.sensitivity, 0.2, 3, d.camera.sensitivity),
      smoothing: clampNum(cam.smoothing, 2, 20, d.camera.smoothing),
      fov: clampNum(cam.fov, 45, 90, d.camera.fov),
    },
    audio: {
      master: clampNum(aud.master, 0, 1, d.audio.master),
      effects: clampNum(aud.effects, 0, 1, d.audio.effects),
      ambience: clampNum(aud.ambience, 0, 1, d.audio.ambience),
      muted: typeof aud.muted === 'boolean' ? aud.muted : d.audio.muted,
    },
    bindings,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
    landingAssist: typeof r.landingAssist === 'boolean' ? r.landingAssist : d.landingAssist,
  };
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}

/** Pretty label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Enter: 'Enter',
    Tab: 'Tab',
  };
  return map[code] ?? code;
}
