import { Quaternion, Vector3 } from 'three';
import type { RagdollSegmentKind } from '../config/physicsConfig';
import type { RagdollView } from '../physics/Ragdoll';
import { BODY } from '../player/bodyDimensions';
import type { PlayerController } from '../player/PlayerController';
import type { CameraBodyFrame, CameraTarget } from './CameraController';

/**
 * Extreme points of each segment kind in the segment's local frame (+Y up the bone, +Z forward), on top of
 * the segment origin (its joint): helmet top, hands, feet and both ski tips. Boot lean is ignored (a few
 * cm at the ski tips, covered by the framing margin).
 */
const skiY = -BODY.shin + BODY.skiOffsetY;
const EXTREMES: Readonly<Record<RagdollSegmentKind, readonly (readonly [number, number, number])[]>> = {
  pelvis: [],
  chest: [[0, BODY.chest.y, 0]],
  head: [[0, BODY.head.y + 0.13, 0]],
  upperArm: [],
  forearm: [[0, -(BODY.forearm + 0.08), 0]],
  thigh: [],
  shin: [
    [0, -BODY.shin, 0],
    [0, skiY, BODY.skiOffsetZ + BODY.skiLength / 2],
    [0, skiY, BODY.skiOffsetZ - BODY.skiLength / 2],
  ],
};

/** Approximate segment masses (kg) for the centre-of-mass velocity (see CRASH_REDESIGN.md §2.1). */
const MASS: Readonly<Record<RagdollSegmentKind, number>> = {
  pelvis: 11,
  chest: 22,
  head: 5.5,
  upperArm: 2.2,
  forearm: 1.8,
  thigh: 9,
  shin: 6.5,
};

const _p = new Vector3();
const _q = new Quaternion();
const _o = new Vector3();
const _min = new Vector3();
const _max = new Vector3();
const _pts: Vector3[] = [];

/**
 * Bounding box (centre, and half sizes when `out.halfExtents` exists), bounding sphere around the box
 * centre (radius to the farthest extreme point) and mass-weighted velocity of the ragdoll, interpolated
 * between the last two fixed steps with `alpha` (1 = latest step). Pure read of the view. Writes into and
 * returns `out`.
 */
export function computeBodyFrame(
  view: Pick<RagdollView, 'segments' | 'info'>,
  alpha: number,
  out: CameraBodyFrame,
): CameraBodyFrame {
  let n = 0;
  const push = (v: Vector3) => {
    if (n >= _pts.length) _pts.push(new Vector3());
    _pts[n++].copy(v);
  };
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  out.velocity.set(0, 0, 0);
  let mass = 0;
  for (let i = 0; i < view.segments.length; i++) {
    const seg = view.segments[i];
    const kind = view.info[i].kind;
    _o.lerpVectors(seg.prevPosition, seg.position, alpha);
    _q.slerpQuaternions(seg.prevQuaternion, seg.quaternion, alpha);
    push(_o);
    for (const e of EXTREMES[kind]) push(_p.set(e[0], e[1], e[2]).applyQuaternion(_q).add(_o));
    const m = MASS[kind];
    out.velocity.addScaledVector(seg.velocity, m);
    mass += m;
  }
  if (mass > 0) out.velocity.multiplyScalar(1 / mass);
  for (let i = 0; i < n; i++) {
    _min.min(_pts[i]);
    _max.max(_pts[i]);
  }
  out.centre.addVectors(_min, _max).multiplyScalar(0.5);
  if (out.halfExtents) out.halfExtents.subVectors(_max, _min).multiplyScalar(0.5);
  let r2 = 0;
  for (let i = 0; i < n; i++) r2 = Math.max(r2, _pts[i].distanceToSquared(out.centre));
  out.radius = Math.sqrt(r2);
  return out;
}

const _frame: CameraBodyFrame = {
  centre: new Vector3(),
  radius: 0,
  halfExtents: new Vector3(),
  velocity: new Vector3(),
};

/**
 * Builds the camera input from the (read-only) simulation state. `skierPosition` is the interpolated visual
 * position so the camera follows exactly what is drawn; `alpha` is the fixed-step interpolation factor used
 * for the crash ragdoll's segments (defaults to the latest step). Owned by camera/gameplay.
 */
export function buildCameraTarget(player: PlayerController, skierPosition: Vector3, alpha = 1): CameraTarget {
  const b = player.body;
  const crashed = player.state === 'CRASHED';
  const ragdoll = crashed ? player.ragdoll : null;
  return {
    position: skierPosition,
    velocity: b.velocity,
    heading: b.heading,
    airborne: player.state === 'AIRBORNE',
    grinding: player.state === 'RAIL_GRINDING',
    crashed,
    landingPoint: player.impact.valid ? player.impact.point : null,
    body: ragdoll ? computeBodyFrame(ragdoll, alpha, _frame) : null,
  };
}
