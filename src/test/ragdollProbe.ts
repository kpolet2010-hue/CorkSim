import { Quaternion, Vector3 } from 'three';
import type { CrashConfig, RagdollJointRange } from '../config/physicsConfig';
import { quaternionToRotationVector } from '../core/math';
import { RAGDOLL_SEGMENT_INFO, SEG, __test, type RagdollView } from '../physics/Ragdoll';

/** Test helpers that measure a ragdoll view (joint separation, joint angles, limit violations). */

const _v = new Vector3();
const _q = new Quaternion();
const _sw = new Quaternion();
const _tw = new Quaternion();
const _rv = new Vector3();

/** Largest distance between a joint's anchor on the parent and the child segment origin (m). */
export function maxJointSeparation(view: RagdollView): number {
  let worst = 0;
  for (let i = 1; i < view.segments.length; i++) {
    const info = RAGDOLL_SEGMENT_INFO[i];
    const p = view.segments[info.parent];
    const c = view.segments[i];
    _v.set(info.origin.x, info.origin.y, info.origin.z).applyQuaternion(p.quaternion).add(p.position);
    worst = Math.max(worst, _v.distanceTo(c.position));
  }
  return worst;
}

/** Relative rotation of segment `child` in its parent's frame. */
export function relativeRotation(view: RagdollView, child: number, out: Quaternion): Quaternion {
  const info = RAGDOLL_SEGMENT_INFO[child];
  out.copy(view.segments[info.parent].quaternion).invert().multiply(view.segments[child].quaternion);
  if (out.w < 0) out.set(-out.x, -out.y, -out.z, -out.w);
  return out;
}

/** Signed hinge angle about +X (knee) or -X (elbow) (rad). */
export function hingeAngle(view: RagdollView, child: number, axisSign: number): number {
  relativeRotation(view, child, _q);
  return axisSign * 2 * Math.atan2(_q.x, _q.w);
}

/**
 * How far (rad) a ball joint is outside its range (0 = inside), measured like the Rapier solver enforces
 * it: each imaginary component of the relative quaternion against [sin(min/2), sin(max/2)], converted
 * back to an angle.
 */
export function ballLimitExcess(view: RagdollView, child: number, range: RagdollJointRange): number {
  const r = __test.mirrorRange(range, RAGDOLL_SEGMENT_INFO[child].side);
  relativeRotation(view, child, _q);
  const axis = (s: number, min: number, max: number) =>
    Math.max(0, 2 * Math.asin(Math.min(1, s)) - max, min - 2 * Math.asin(Math.max(-1, s)));
  return Math.max(
    axis(_q.x, r.swingXMin, r.swingXMax),
    axis(_q.y, r.twistMin, r.twistMax),
    axis(_q.z, r.swingZMin, r.swingZMax),
  );
}

/**
 * Excess (rad) of a ball joint that uses our own soft limit, in that limit's parametrization: swing ellipse
 * (swing rotation vector X/Z, separate extents per quadrant) plus the twist about the bone axis.
 */
export function softBallLimitExcess(view: RagdollView, child: number, range: RagdollJointRange): number {
  const r = __test.mirrorRange(range, RAGDOLL_SEGMENT_INFO[child].side);
  relativeRotation(view, child, _q);
  const twist = __test.swingTwistY(_q, _sw, _tw);
  quaternionToRotationVector(_sw, _rv);
  const ax = _rv.x >= 0 ? r.swingXMax : -r.swingXMin;
  const az = _rv.z >= 0 ? r.swingZMax : -r.swingZMin;
  const e = Math.sqrt((_rv.x / ax) ** 2 + (_rv.z / az) ** 2);
  const swing = e > 1 ? Math.hypot(_rv.x, _rv.z) * (1 - 1 / e) : 0;
  return Math.max(swing, twist - r.twistMax, r.twistMin - twist, 0);
}

export interface LimitReport {
  knee: number;
  elbow: number;
  ball: number;
}

/** Worst limit excess over all joints (rad). Hinges: below 0 or above the max. */
export function limitExcess(view: RagdollView, cfg: CrashConfig): LimitReport {
  let knee = 0;
  let elbow = 0;
  for (const s of [SEG.shinL, SEG.shinR]) {
    const a = hingeAngle(view, s, 1);
    knee = Math.max(knee, -a, a - cfg.kneeMax);
  }
  for (const s of [SEG.forearmL, SEG.forearmR]) {
    const a = hingeAngle(view, s, -1);
    elbow = Math.max(elbow, -a, a - cfg.elbowMax);
  }
  let ball = 0;
  const sl = cfg.solverLimits;
  const measure = (seg: number, range: RagdollJointRange, solver: boolean) =>
    solver ? ballLimitExcess(view, seg, range) : softBallLimitExcess(view, seg, range);
  ball = Math.max(ball, measure(SEG.chest, cfg.waist, sl.waist));
  ball = Math.max(ball, measure(SEG.head, cfg.neck, sl.neck));
  ball = Math.max(ball, measure(SEG.upperArmL, cfg.shoulder, sl.shoulder));
  ball = Math.max(ball, measure(SEG.upperArmR, cfg.shoulder, sl.shoulder));
  ball = Math.max(ball, measure(SEG.thighL, cfg.hip, sl.hip));
  ball = Math.max(ball, measure(SEG.thighR, cfg.hip, sl.hip));
  return { knee, elbow, ball };
}

/** A segment axis (local x/y/z unit vector) in world space. */
export function segmentAxis(view: RagdollView, seg: number, axis: 'x' | 'y' | 'z', out: Vector3): Vector3 {
  out.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  return out.applyQuaternion(view.segments[seg].quaternion);
}
