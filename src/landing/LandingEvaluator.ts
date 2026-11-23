import { Quaternion, Vector3 } from 'three';
import type { LandingConfig } from '../config/physicsConfig';
import { RAD2DEG, safeAngle } from '../core/math';

export type LandingQuality = 'clean' | 'sketchy' | 'crash';

export interface LandingInput {
  orientation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  surfaceNormal: Vector3;
  /** True if a grab is still held at touchdown. */
  grabbing: boolean;
}

export interface LandingResult {
  quality: LandingQuality;
  /** Angle between body up and the snow normal (deg). */
  uprightErrorDeg: number;
  /** Angle between the skis and the direction of travel on the slope (deg, 0..90). */
  yawErrorDeg: number;
  /** Speed into the snow along the normal (m/s). */
  impactSpeed: number;
  /** Speed along the slope (m/s). */
  slopeSpeed: number;
  angularSpeed: number;
  /** Landed riding backwards. */
  switchLanding: boolean;
  /** Human readable reason for a non-clean landing. */
  reason: string;
  /** 0..1 stability score (1 = perfect). */
  stability: number;
}

const _up = new Vector3();
const _fwd = new Vector3();
const _vt = new Vector3();
const _ft = new Vector3();

/**
 * Evaluates a touchdown against the actual landing surface: body alignment with the snow normal, ski
 * alignment with the velocity on the slope (forward or switch), impact speed into the slope (so landing on
 * a steep landing hill is soft and a flat landing is hard), residual rotation and whether a grab is held.
 */
export function evaluateLanding(input: LandingInput, cfg: LandingConfig): LandingResult {
  const n = input.surfaceNormal;
  _up.set(0, 1, 0).applyQuaternion(input.orientation);
  _fwd.set(0, 0, 1).applyQuaternion(input.orientation);
  const uprightErrorDeg = safeAngle(_up, n) * RAD2DEG;

  const vn = input.velocity.dot(n);
  const impactSpeed = Math.max(0, -vn);
  _vt.copy(input.velocity).addScaledVector(n, -vn);
  const slopeSpeed = _vt.length();
  _ft.copy(_fwd).addScaledVector(n, -_fwd.dot(n));

  let yawErrorDeg = 0;
  let switchLanding = false;
  if (slopeSpeed >= cfg.yawCheckMinSpeed && _ft.lengthSq() > 1e-6) {
    const a = safeAngle(_ft, _vt) * RAD2DEG; // 0..180
    switchLanding = a > 90;
    yawErrorDeg = switchLanding ? 180 - a : a;
  } else if (_ft.lengthSq() > 1e-6 && slopeSpeed > 0.1) {
    switchLanding = _ft.dot(_vt) < 0;
  }
  const angularSpeed = input.angularVelocity.length();

  const reasons: string[] = [];
  let quality: LandingQuality = 'clean';
  if (uprightErrorDeg > cfg.crashUprightDeg) {
    quality = 'crash';
    reasons.push(uprightErrorDeg > 120 ? 'Landed upside down' : 'Off balance');
  }
  if (yawErrorDeg > cfg.crashYawDeg) {
    quality = 'crash';
    reasons.push('Skis sideways');
  }
  if (impactSpeed > cfg.crashImpactSpeed) {
    quality = 'crash';
    reasons.push('Hard impact');
  }
  if (quality !== 'crash') {
    if (uprightErrorDeg > cfg.cleanUprightDeg) reasons.push('Off balance');
    if (yawErrorDeg > cfg.cleanYawDeg) reasons.push(yawErrorDeg > 0 ? 'Under/over-rotated' : '');
    if (impactSpeed > cfg.cleanImpactSpeed) reasons.push('Flat landing');
    if (angularSpeed > cfg.cleanAngularSpeed) reasons.push('Still rotating');
    if (input.grabbing) reasons.push('Late grab release');
    if (reasons.length > 0) quality = 'sketchy';
  }

  const stability = Math.max(
    0,
    1 -
      Math.max(
        uprightErrorDeg / cfg.crashUprightDeg,
        yawErrorDeg / cfg.crashYawDeg,
        impactSpeed / cfg.crashImpactSpeed,
      ),
  );

  return {
    quality,
    uprightErrorDeg,
    yawErrorDeg,
    impactSpeed,
    slopeSpeed,
    angularSpeed,
    switchLanding,
    reason: reasons.filter(Boolean).join(', '),
    stability,
  };
}
