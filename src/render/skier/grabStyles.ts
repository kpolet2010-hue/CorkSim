import type { GrabDefinition } from '../../tricks/grabs';

/** Orientation of a ski in the body frame (rad): pitch + = nose down, yaw + = tip to the left, roll. */
export interface SkiAttitude {
  pitch: number;
  yaw: number;
  roll: number;
}

/**
 * Visual shaping of one grab. The grabbing hand is placed at `hands[...]` (chest space) and the grabbed
 * ski is solved so its grab point lands exactly in the hand, which keeps every grab readable and lets
 * the hand reach the real ski point of the grab type. Skis not being grabbed are placed by `footOffset`.
 */
export interface GrabStyle {
  /**
   * Body-space home of the palm for each grab target (same order as `GrabDefinition.targets`). Body
   * space has its origin at the foot point (+Y up, +Z forward, +X left).
   */
  hands: [number, number, number][];
  /** Ski attitude, [left, right]. */
  ski: [SkiAttitude, SkiAttitude];
  /** Offset of the ski centre from the neutral air position (body space), [left, right]. */
  footOffset: [[number, number, number], [number, number, number]];
  /** Chest-space target of a free hand, [left, right]. */
  freeHand: [[number, number, number], [number, number, number]];
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;
  neckPitch: number;
  neckYaw: number;
  /** How much the knees tuck (overrides the definition's value when set). */
  tuck?: number;
}

const att = (pitch: number, yaw: number, roll: number): SkiAttitude => ({ pitch, yaw, roll });

/** Hand-tuned styles for the catalogue grabs (see src/tricks/grabs.ts). */
export const GRAB_STYLES: Readonly<Record<string, GrabStyle>> = {
  // Left hand crosses to the outside of the right ski; right ski pulled across, chest turns into it.
  mute: {
    hands: [[-0.12, 0.62, 0.3]],
    ski: [att(0.12, 0.16, -0.12), att(0.18, 0.28, -0.4)],
    footOffset: [
      [0.0, 0.1, 0.04],
      [0, 0, 0],
    ],
    freeHand: [
      [0.5, 0.05, 0.1],
      [-0.52, 0.12, -0.18],
    ],
    spinePitch: 0.45,
    spineYaw: -0.3,
    spineRoll: 0.18,
    neckPitch: 0.25,
    neckYaw: -0.25,
  },
  // Right hand to the outside of the right ski under the boot; tight, compact.
  safety: {
    hands: [[-0.27, 0.56, 0.05]],
    ski: [att(0.05, 0.04, 0.08), att(0.05, -0.05, -0.18)],
    footOffset: [
      [0.0, 0.14, 0.06],
      [0, 0, 0],
    ],
    freeHand: [
      [0.55, 0.08, 0.12],
      [-0.5, 0.0, 0.1],
    ],
    spinePitch: 0.42,
    spineYaw: -0.1,
    spineRoll: 0.15,
    neckPitch: 0.2,
    neckYaw: -0.15,
  },
  // Right hand reaches back to the right tail; skis tipped nose-down, chest twisted back.
  tail: {
    hands: [[-0.26, 0.68, -0.3]],
    ski: [att(0.35, -0.05, 0.05), att(0.7, -0.12, -0.12)],
    footOffset: [
      [0.0, 0.1, -0.1],
      [0, 0, 0],
    ],
    freeHand: [
      [0.45, 0.2, 0.3],
      [-0.45, 0.2, 0.3],
    ],
    spinePitch: 0.12,
    spineYaw: -0.38,
    spineRoll: 0.12,
    neckPitch: 0.1,
    neckYaw: -0.45,
  },
  // Left hand behind the left binding, both skis kicked back and tweaked, back arched.
  method: {
    hands: [[0.28, 0.72, -0.22]],
    ski: [att(0.6, 0.4, 0.45), att(0.55, 0.35, 0.35)],
    footOffset: [
      [0, 0, 0],
      [0.02, 0.16, -0.26],
    ],
    freeHand: [
      [0.5, 0.25, 0.1],
      [-0.45, 0.38, 0.12],
    ],
    spinePitch: -0.05,
    spineYaw: 0.32,
    spineRoll: -0.22,
    neckPitch: -0.05,
    neckYaw: 0.35,
  },
  // Left hand to the inside front of the right ski; knees up, skis rotated tips-down and crossed.
  japan: {
    hands: [[-0.04, 0.62, 0.24]],
    ski: [att(0.55, 0.3, -0.2), att(0.95, 0.55, -0.35)],
    footOffset: [
      [0.0, 0.12, -0.06],
      [0, 0, 0],
    ],
    freeHand: [
      [0.5, 0.1, 0.0],
      [-0.55, 0.15, -0.12],
    ],
    spinePitch: 0.5,
    spineYaw: -0.28,
    spineRoll: 0.12,
    neckPitch: 0.2,
    neckYaw: -0.3,
  },
  // Right hand to the right tip; right ski pulled up nose-high, torso folds forward.
  nose: {
    hands: [[-0.14, 0.92, 0.6]],
    ski: [att(-0.1, 0.0, 0.05), att(-0.85, -0.06, -0.05)],
    footOffset: [
      [0.0, 0.18, -0.05],
      [0, 0, 0],
    ],
    freeHand: [
      [0.55, 0.1, 0.0],
      [-0.5, 0.05, 0.0],
    ],
    spinePitch: 0.6,
    spineYaw: -0.1,
    spineRoll: 0.05,
    neckPitch: 0.0,
    neckYaw: -0.1,
  },
  // Both hands to their own ski in front of the bindings, symmetric, deep tuck.
  truckdriver: {
    hands: [
      [0.2, 0.56, 0.32],
      [-0.2, 0.56, 0.32],
    ],
    ski: [att(0.02, 0.0, 0.12), att(0.02, 0.0, -0.12)],
    footOffset: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    freeHand: [
      [0.5, 0.0, 0.1],
      [-0.5, 0.0, 0.1],
    ],
    spinePitch: 0.5,
    spineYaw: 0,
    spineRoll: 0,
    neckPitch: 0.1,
    neckYaw: 0,
  },
  // Right hand grabs the right ski, left leg kicked forward and out with the ski tweaked.
  luikang: {
    hands: [[-0.27, 0.48, 0.14]],
    ski: [att(-0.4, 0.35, 0.4), att(0.1, -0.05, -0.2)],
    footOffset: [
      [0.14, -0.05, 0.42],
      [0, 0, 0],
    ],
    freeHand: [
      [0.5, 0.25, 0.15],
      [-0.5, 0.1, 0.0],
    ],
    spinePitch: 0.3,
    spineYaw: -0.15,
    spineRoll: 0.18,
    neckPitch: 0.1,
    neckYaw: 0.3,
    tuck: 0.35,
  },
};

const _generic = new Map<string, GrabStyle>();

/** Style for a grab; unknown (future) grabs get a generic style derived from their targets. */
export function grabStyleFor(def: GrabDefinition): GrabStyle {
  const s = GRAB_STYLES[def.id];
  if (s) return s;
  let g = _generic.get(def.id);
  if (g) return g;
  const hands: [number, number, number][] = def.targets.map((t) => {
    const skiSide = t.ski === 'left' ? 1 : -1;
    return [skiSide * 0.2, 0.6, 0.15 + t.along * 0.3];
  });
  const pitchFor = (ski: 'left' | 'right') => {
    const t = def.targets.find((x) => x.ski === ski);
    return t ? -t.along * 0.45 : 0.1;
  };
  g = {
    hands,
    ski: [att(pitchFor('left'), 0, 0), att(pitchFor('right'), 0, 0)],
    footOffset: [
      [0, 0.25, 0],
      [0, 0.25, 0],
    ],
    freeHand: [
      [0.5, 0.05, 0.1],
      [-0.5, 0.05, 0.1],
    ],
    spinePitch: 0.4,
    spineYaw: 0,
    spineRoll: 0,
    neckPitch: 0.15,
    neckYaw: 0,
  };
  _generic.set(def.id, g);
  return g;
}
