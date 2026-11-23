import { RAD2DEG } from '../core/math';
import type { CompletedGrab } from './GrabSystem';

export type TrickCategory = 'straight' | 'spin' | 'flip' | 'offaxis';
export type OffAxisType = 'cork' | 'bio' | 'misty' | 'rodeo';

/** Everything recognised about one aerial manoeuvre. */
export interface AirTrick {
  category: TrickCategory;
  /** Spin rounded to a multiple of 180 (deg). For off-axis tricks this is the total rotation. */
  spinDegrees: number;
  /** Raw (unrounded) rotation used for the rounding (deg). */
  rawDegrees: number;
  direction: 'left' | 'right' | null;
  flips: number;
  flipDirection: 'front' | 'back' | 'side' | null;
  offAxisType: OffAxisType | null;
  /** Axis tilt from vertical (deg). */
  axisTiltDeg: number;
  switchTakeoff: boolean;
  grabs: CompletedGrab[];
  airTime: number;
  /** Signature used to detect repetition (grabs excluded). */
  signature: string;
  name: string;
}

export interface RotationSummary {
  /** Rotation about world up (rad, + = left). */
  spin: number;
  /** Rotation about takeoff left axis (rad, + = front). */
  pitch: number;
  /** Rotation about takeoff forward axis (rad). */
  roll: number;
  inversions: number;
  airTime: number;
  switchTakeoff: boolean;
}

export interface RecognitionConfig {
  /** Axis tilt below which a rotation is a flat spin (deg). */
  flatSpinMaxTilt: number;
  /** Axis tilt above which a rotation is a flip (deg). */
  flipMinTilt: number;
  /** Spin component above which a "flip" becomes off-axis (deg). */
  flipMaxSpin: number;
  /** Minimum rotation to count a spin at all (deg). */
  minSpin: number;
  /** Minimum rotation for a flip (deg). */
  minFlip: number;
}

export const DEFAULT_RECOGNITION_CONFIG: RecognitionConfig = {
  flatSpinMaxTilt: 28,
  flipMinTilt: 68,
  flipMaxSpin: 120,
  minSpin: 135,
  minFlip: 270,
};

/** Rounds to the nearest multiple of `step`. */
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Freestyle shorthand used for off-axis tricks: 540 → 5, 720 → 7, 1080 → 10, 1440 → 14. */
export function shortSpinName(deg: number): string {
  return String(Math.floor(deg / 100));
}

/**
 * Classifies accumulated rotation into a named trick. Recognition is purely based on the measured
 * rotation (axis and magnitude) and inversion count, never on which keys were pressed.
 */
export function recognizeAirTrick(
  rot: RotationSummary,
  grabs: CompletedGrab[],
  cfg: RecognitionConfig = DEFAULT_RECOGNITION_CONFIG,
): AirTrick {
  const spinDeg = rot.spin * RAD2DEG;
  const pitchDeg = rot.pitch * RAD2DEG;
  const rollDeg = rot.roll * RAD2DEG;
  const horizontal = Math.hypot(pitchDeg, rollDeg);
  const total = Math.hypot(spinDeg, horizontal);
  const tilt = total > 1e-6 ? Math.atan2(horizontal, Math.abs(spinDeg)) * RAD2DEG : 0;
  const direction = spinDeg > 0 ? 'left' : 'right';

  let category: TrickCategory = 'straight';
  let spinDegrees = 0;
  let rawDegrees = 0;
  let flips = 0;
  let flipDirection: AirTrick['flipDirection'] = null;
  let offAxisType: OffAxisType | null = null;

  if (rot.inversions === 0) {
    // Never inverted: a spin. Count the vertical rotation (total rotation if the axis was tilted).
    rawDegrees = tilt < cfg.flatSpinMaxTilt ? Math.abs(spinDeg) : total;
    if (rawDegrees >= cfg.minSpin) {
      category = 'spin';
      spinDegrees = Math.max(180, roundTo(rawDegrees, 180));
    }
  } else if (tilt >= cfg.flipMinTilt && Math.abs(spinDeg) < cfg.flipMaxSpin) {
    rawDegrees = horizontal;
    if (horizontal >= cfg.minFlip || rot.inversions > 0) {
      category = 'flip';
      flips = Math.max(rot.inversions, Math.round(horizontal / 360));
      flips = Math.max(1, flips);
      if (Math.abs(pitchDeg) >= Math.abs(rollDeg)) flipDirection = pitchDeg > 0 ? 'front' : 'back';
      else flipDirection = 'side';
    }
  } else {
    category = 'offaxis';
    rawDegrees = total;
    spinDegrees = Math.max(360, roundTo(total, 180));
    flips = Math.max(1, rot.inversions);
    if (Math.abs(rollDeg) >= Math.abs(pitchDeg)) offAxisType = 'cork';
    else if (pitchDeg > 0) offAxisType = 'misty';
    else offAxisType = tilt > 55 ? 'rodeo' : 'bio';
  }

  const signature = `${category}:${spinDegrees}:${flips}:${flipDirection ?? ''}:${offAxisType ?? ''}:${rot.switchTakeoff ? 's' : 'f'}`;
  const trick: AirTrick = {
    category,
    spinDegrees,
    rawDegrees,
    direction: category === 'spin' || category === 'offaxis' ? direction : null,
    flips,
    flipDirection,
    offAxisType,
    axisTiltDeg: tilt,
    switchTakeoff: rot.switchTakeoff,
    grabs: grabs.map((g) => ({ ...g })),
    airTime: rot.airTime,
    signature,
    name: '',
  };
  trick.name = formatAirTrickName(trick);
  return trick;
}

const MULTIPLIER_WORDS = ['', '', 'Double', 'Triple', 'Quad', 'Quint'];

export function formatAirTrickName(t: AirTrick): string {
  const parts: string[] = [];
  if (t.switchTakeoff && t.category !== 'straight') parts.push('Switch');
  switch (t.category) {
    case 'straight':
      parts.push(t.grabs.length > 0 ? '' : 'Straight Air');
      break;
    case 'spin':
      parts.push(t.direction === 'left' ? 'Left' : 'Right', String(t.spinDegrees));
      break;
    case 'flip': {
      const mult = MULTIPLIER_WORDS[Math.min(t.flips, MULTIPLIER_WORDS.length - 1)];
      if (mult) parts.push(mult);
      parts.push(
        t.flipDirection === 'front' ? 'Frontflip' : t.flipDirection === 'back' ? 'Backflip' : 'Side Flip',
      );
      break;
    }
    case 'offaxis': {
      const mult = MULTIPLIER_WORDS[Math.min(t.flips, MULTIPLIER_WORDS.length - 1)];
      parts.push(t.direction === 'left' ? 'Left' : 'Right');
      if (mult) parts.push(mult);
      const typeName =
        t.offAxisType === 'cork'
          ? 'Cork'
          : t.offAxisType === 'bio'
            ? 'Bio'
            : t.offAxisType === 'misty'
              ? 'Misty'
              : 'Rodeo';
      parts.push(`${typeName} ${shortSpinName(t.spinDegrees)}`);
      break;
    }
  }
  for (const g of t.grabs) parts.push(g.name);
  return parts.filter((p) => p.length > 0).join(' ');
}
