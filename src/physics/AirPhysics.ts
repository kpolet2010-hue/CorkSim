import { Quaternion, Vector3 } from 'three';
import type { AirConfig, SkiPhysicsConfig } from '../config/physicsConfig';
import {
  clamp,
  clampLength,
  dampFactor,
  integrateOrientation,
  quaternionFromForwardUp,
  quaternionToRotationVector,
  sanitizeQuaternion,
} from '../core/math';
import { createSurfaceSample, type SurfaceField } from '../park/SurfaceField';
import type { SkierBody } from '../player/SkierBody';

/** Rotation intent while airborne. Each axis in -1..1. */
export interface AirControl {
  /** + = spin left (counter-clockwise seen from above the skier's head). */
  spin: number;
  /** + = frontflip, - = backflip. */
  flip: number;
  /** + = roll left (off-axis tilt), - = roll right. */
  roll: number;
}

export interface ImpactPrediction {
  valid: boolean;
  time: number;
  point: Vector3;
  normal: Vector3;
}

export function createImpactPrediction(): ImpactPrediction {
  return { valid: false, time: 0, point: new Vector3(), normal: new Vector3(0, 1, 0) };
}

const _qInv = new Quaternion();
const _local = new Vector3();
const _probe = new Vector3();
const _sample = createSurfaceSample();
const _fwd = new Vector3();
const _dir = new Vector3();
const _target = new Quaternion();
const _err = new Quaternion();
const _errVec = new Vector3();
const _desired = new Vector3();

function controlAxis(
  current: number,
  input: number,
  accel: number,
  maxRate: number,
  damping: number,
  dt: number,
): number {
  if (input === 0) return current * Math.exp(-damping * dt);
  let next = current + input * accel * dt;
  // Only clamp in the direction the player is pushing so existing momentum is preserved.
  if (Math.abs(next) > maxRate && Math.sign(next) === Math.sign(input)) {
    next = Math.sign(next) * Math.max(maxRate, Math.abs(current) * Math.exp(-damping * dt));
  }
  return next;
}

const _spinAxis = new Vector3();
const _flipAxis = new Vector3();
const _rollAxis = new Vector3();

function applyAxis(
  w: Vector3,
  axis: Vector3,
  input: number,
  accel: number,
  maxRate: number,
  damping: number,
  dt: number,
): void {
  const c = w.dot(axis);
  const next = controlAxis(c, input, accel, maxRate, damping, dt);
  w.addScaledVector(axis, next - c);
}

/**
 * Airborne dynamics. The skier is a free rigid body under gravity and drag. Player input applies angular
 * acceleration about the body's flip (left) and roll (forward) axes, and about a spin axis that is the
 * world vertical while the skier is upright (flat spins) blending into the body's own up axis as the body
 * tilts. Combining inputs therefore produces a genuinely tilted rotation axis (corks, bios, mistys) rather
 * than canned animations. Releasing input lets the rotation coast down (body opening up).
 */
export function stepAir(
  body: SkierBody,
  control: AirControl,
  physics: SkiPhysicsConfig,
  air: AirConfig,
  dt: number,
): void {
  const v = body.velocity;
  // Linear motion.
  const vMag = v.length();
  v.y -= physics.gravity * dt;
  v.addScaledVector(v, (-0.5 * physics.airDensity * physics.dragAreaUpright * vMag * dt) / physics.mass);
  clampLength(v, physics.maxSpeed);
  body.position.addScaledVector(v, dt);

  // Angular motion.
  const q = body.orientation;
  _flipAxis.set(1, 0, 0).applyQuaternion(q);
  _rollAxis.set(0, 0, 1).applyQuaternion(q);
  _spinAxis.set(0, 1, 0).applyQuaternion(q);
  const w = body.angularVelocity;
  const spin = clamp(control.spin, -1, 1);
  const flip = clamp(control.flip, -1, 1);
  const roll = clamp(control.roll, -1, 1);
  if (spin !== 0 && (flip !== 0 || roll !== 0)) {
    // Off-axis: spin + flip/roll accelerates rotation about an axis tilted by offAxisTilt from the body's
    // up axis towards the flip/roll direction (corks, bios, mistys). Rotation not about that axis is bled
    // off so the body converges onto the tilted axis.
    // Base spin axis is horizon-referenced while upright (like a flat spin), body-referenced once tilted.
    const tilt = air.offAxisTilt;
    const uprightness = clamp((_spinAxis.y - 0.45) / 0.45, 0, 1);
    _spinAxis.lerp(_local.set(0, 1, 0), uprightness * 0.85).normalize();
    // Tilt direction from the flip/roll input in the body frame, made perpendicular to the base axis.
    _local.set(flip, 0, roll).normalize().applyQuaternion(q);
    _local.addScaledVector(_spinAxis, -_local.dot(_spinAxis));
    if (_local.lengthSq() < 1e-6) _local.copy(_rollAxis);
    _local
      .normalize()
      .multiplyScalar(Math.sin(tilt))
      .addScaledVector(_spinAxis, Math.sign(spin) * Math.cos(tilt))
      .normalize();
    const along = w.dot(_local);
    _flipAxis
      .copy(w)
      .addScaledVector(_local, -along)
      .multiplyScalar(Math.exp(-air.spinDamping * dt));
    const next = controlAxis(along, 1, air.spinAcceleration, air.maxSpinRate, air.spinDamping, dt);
    w.copy(_flipAxis).addScaledVector(_local, next);
  } else {
    if (flip === 0 && roll === 0) {
      // Pure spin: rotate about the world vertical while upright (flat spin).
      const uprightness = clamp((_spinAxis.y - 0.45) / 0.45, 0, 1);
      _spinAxis.lerp(_local.set(0, 1, 0), uprightness * 0.85).normalize();
    }
    applyAxis(w, _spinAxis, spin, air.spinAcceleration, air.maxSpinRate, air.spinDamping, dt);
    applyAxis(w, _flipAxis, flip, air.flipAcceleration, air.maxFlipRate, air.flipDamping, dt);
    applyAxis(w, _rollAxis, roll, air.rollAcceleration, air.maxRollRate, air.rollDamping, dt);
  }
  clampLength(w, air.maxAngularSpeed);
  integrateOrientation(q, w, dt);
  body.grounded = false;
}

/**
 * Predicts where the ballistic trajectory meets the snow (ignores drag; only used for assistance,
 * camera framing and HUD hints). Coarse forward stepping followed by bisection refinement.
 */
export function predictImpact(
  body: SkierBody,
  surface: SurfaceField,
  gravity: number,
  out: ImpactPrediction,
  maxTime = 3,
): ImpactPrediction {
  const p = body.position;
  const v = body.velocity;
  const step = 0.05;
  let prevT = 0;
  out.valid = false;
  for (let t = step; t <= maxTime; t += step) {
    _probe.set(p.x + v.x * t, p.y + v.y * t - 0.5 * gravity * t * t, p.z + v.z * t);
    if (_probe.y <= surface.height(_probe.x, _probe.z)) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        const y = p.y + v.y * mid - 0.5 * gravity * mid * mid;
        const x = p.x + v.x * mid;
        const z = p.z + v.z * mid;
        if (y <= surface.height(x, z)) hi = mid;
        else lo = mid;
      }
      out.time = hi;
      out.point.set(p.x + v.x * hi, 0, p.z + v.z * hi);
      surface.sample(out.point.x, out.point.z, _sample);
      out.point.y = _sample.height;
      out.normal.copy(_sample.normal);
      out.valid = true;
      return out;
    }
    prevT = t;
  }
  return out;
}

/**
 * Landing "spotting" assist: when the player is not rotating and the predicted impact is close, gently
 * steer the angular velocity so the skis align with the landing slope and the direction of travel.
 * This is gameplay assistance that keeps controls accessible; it only engages within a limited error cone
 * so under/over-rotated tricks still land sketchy or crash.
 */
export function applyLandingAssist(
  body: SkierBody,
  impact: ImpactPrediction,
  control: AirControl,
  air: AirConfig,
  dt: number,
): boolean {
  if (air.landingAssist <= 0 || !impact.valid || impact.time > air.landingAssistWindow) return false;
  if (control.spin !== 0 || control.flip !== 0 || control.roll !== 0) return false;
  // Forward candidate = travel direction projected on the landing plane; choose forward or switch.
  _dir.copy(body.velocity).addScaledVector(impact.normal, -body.velocity.dot(impact.normal));
  if (_dir.lengthSq() < 0.25) return false;
  _dir.normalize();
  _fwd.set(0, 0, 1).applyQuaternion(body.orientation);
  if (_fwd.dot(_dir) < 0) _dir.negate();
  quaternionFromForwardUp(_dir, impact.normal, _target);
  _err.copy(_target).multiply(_qInv.copy(body.orientation).invert());
  sanitizeQuaternion(_err);
  quaternionToRotationVector(_err, _errVec);
  const errAngle = _errVec.length();
  if (errAngle > air.landingAssistMaxError) return false;
  _desired.copy(_errVec).divideScalar(Math.max(impact.time, 0.1));
  body.angularVelocity.lerp(_desired, dampFactor(air.landingAssist, dt));
  return true;
}

const _bodyUp = new Vector3();
const _axisErr = new Vector3();
const _nonYaw = new Vector3();

/**
 * Natural in-air posture: a skier constantly adjusts hips and arms to keep the skis level with the
 * expected landing. With no flip/roll input and no significant flip momentum we drive only the pitch/roll
 * part of the angular velocity so the body up vector tracks `targetUp`. The spin axis is never touched.
 */
export function applyAirPosture(
  body: SkierBody,
  targetUp: Vector3,
  control: AirControl,
  strength: number,
  dt: number,
): boolean {
  if (strength <= 0 || control.flip !== 0 || control.roll !== 0) return false;
  _bodyUp.set(0, 1, 0).applyQuaternion(body.orientation);
  if (_bodyUp.y < 0.25) return false; // mid-flip or inverted: leave it to the player
  const w = body.angularVelocity;
  _nonYaw.copy(w).addScaledVector(_bodyUp, -w.dot(_bodyUp));
  if (_nonYaw.length() > 2.5) return false; // committed flip/off-axis momentum
  _axisErr.crossVectors(_bodyUp, targetUp);
  const s = _axisErr.length();
  const angle = Math.atan2(s, clamp(_bodyUp.dot(targetUp), -1, 1));
  if (s > 1e-6) _axisErr.multiplyScalar(angle / s);
  else _axisErr.set(0, 0, 0);
  // Remove yaw component of the correction.
  _axisErr.addScaledVector(_bodyUp, -_axisErr.dot(_bodyUp));
  _desired.copy(_axisErr).multiplyScalar(2.2);
  _nonYaw.lerp(_desired, dampFactor(strength, dt));
  const yaw = w.dot(_bodyUp);
  w.copy(_nonYaw).addScaledVector(_bodyUp, yaw);
  return true;
}
