import { Quaternion, Vector3 } from 'three';
import type { SkiPhysicsConfig } from '../config/physicsConfig';
import {
  approach,
  clamp,
  clampLength,
  dampFactor,
  isFiniteVector,
  quaternionFromForwardUp,
  smoothstep,
} from '../core/math';
import { createSurfaceSample, type SurfaceField } from '../park/SurfaceField';
import type { SkierBody } from '../player/SkierBody';

/** Ground control intent, already resolved from raw input by the player controller. */
export interface GroundControl {
  /** -1 (right) .. +1 (left). */
  steer: number;
  /** 0..1 braking intent. */
  brake: number;
  /** Tuck / push (accelerate). */
  push: boolean;
  /** Steering effectiveness multiplier (e.g. reduced while charging a jump). */
  steerFactor: number;
}

export interface GroundStepResult {
  /** True when the skier separated from the snow during this step. */
  leftGround: boolean;
  /** Normal velocity at separation (m/s). */
  separationSpeed: number;
}

const _s = createSurfaceSample();
const _tip = createSurfaceSample();
const _tail = createSurfaceSample();
const _n = new Vector3();
const _left = new Vector3();
const _vt = new Vector3();
const _acc = new Vector3();
const _tmp = new Vector3();
const _q = new Quaternion();
const _skiCenter = new Vector3();

/**
 * Custom ski-snow physics.
 *
 * Model summary (per fixed step):
 *  1. Each ski samples the snow under its tip and tail → contact point, normal and gap.
 *  2. The heading (ski direction) is steered by the edge angle. A carving ski follows its sidecut,
 *     giving a turn radius R = sidecut / sin(edge) and therefore a yaw rate v / R (more effective at speed).
 *     At low speed rotary "pivot" steering dominates.
 *  3. Forces in the snow tangent plane:
 *       - gravity (full vector; the normal part is cancelled by the contact constraint),
 *       - longitudinal glide friction  mu_k * N  (+ braking friction which ramps in gradually),
 *       - lateral edge grip that cancels sideways velocity, limited by mu_lat(edge) * N,
 *         so turns redirect the velocity instead of rotating the skier in place,
 *       - quadratic air drag  0.5 * rho * CdA * |v| v  and a small linear snow resistance,
 *       - skating/poling push at low speed.
 *  4. Semi-implicit Euler integration, then a non-penetration constraint against the snow: penetration is
 *     resolved vertically and the inward normal velocity removed (perfectly inelastic → no bouncing).
 *     The normal force N is reconstructed from that impulse (N = m Δv / dt) so friction naturally drops when
 *     the skier is unweighted over a crest.
 *  5. The skier leaves the ground only when geometry and velocity actually separate them from the snow.
 */
export function stepGround(
  body: SkierBody,
  control: GroundControl,
  surface: SurfaceField,
  cfg: SkiPhysicsConfig,
  dt: number,
): GroundStepResult {
  const result: GroundStepResult = { leftGround: false, separationSpeed: 0 };
  const m = cfg.mass;
  const p = body.position;
  const v = body.velocity;

  // --- 1. Ski contacts --------------------------------------------------------------------------
  surface.sample(p.x, p.z, _s);
  _n.copy(_s.normal);
  const startSurface = _s.type;
  const startFeature = _s.featureId;
  const h = body.heading;
  // Keep heading tangent to the snow.
  h.addScaledVector(_n, -h.dot(_n));
  if (h.lengthSq() < 1e-8) h.set(0, 0, 1).addScaledVector(_n, -_n.z);
  h.normalize();
  _left.crossVectors(_n, h).normalize();

  let contactCount = 0;
  const contactNormal = _tmp.set(0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const ski = body.skis[i];
    const side = i === 0 ? 1 : -1; // 0 = left ski, 1 = right ski
    _skiCenter.copy(p).addScaledVector(_left, side * cfg.skiHalfSpacing);
    const tx = _skiCenter.x + h.x * cfg.skiHalfLength * 0.7;
    const tz = _skiCenter.z + h.z * cfg.skiHalfLength * 0.7;
    const bx = _skiCenter.x - h.x * cfg.skiHalfLength * 0.7;
    const bz = _skiCenter.z - h.z * cfg.skiHalfLength * 0.7;
    surface.sample(tx, tz, _tip);
    surface.sample(bx, bz, _tail);
    ski.normal.copy(_tip.normal).add(_tail.normal).normalize();
    ski.height = Math.max(_tip.height, _tail.height, (_tip.height + _tail.height) * 0.5);
    ski.point.copy(_skiCenter);
    ski.gap = _skiCenter.y - ski.height;
    ski.inContact = ski.gap < cfg.contactTolerance;
    ski.direction.copy(h);
    if (ski.inContact) {
      contactCount++;
      contactNormal.add(ski.normal);
    }
  }
  if (contactCount > 0) _n.copy(contactNormal).normalize();

  // Smoothed normal for orientation (physics uses the raw contact normal).
  body.groundNormal.lerp(_n, dampFactor(22, dt)).normalize();

  // --- 2. Steering / edging --------------------------------------------------------------------
  const vn = v.dot(_n);
  _vt.copy(v).addScaledVector(_n, -vn);
  const vLong = _vt.dot(h);
  const vLat = _vt.dot(_left);
  const speed = _vt.length();
  const steer = clamp(control.steer, -1, 1) * clamp(control.steerFactor, 0, 1);
  const edgeAuthority = clamp(0.35 + speed / 9, 0, 1);
  const targetEdge = steer * cfg.maxEdgeAngle * edgeAuthority;
  body.edgeAngle = approach(body.edgeAngle, targetEdge, cfg.edgeRate * dt);

  const absEdge = Math.abs(body.edgeAngle);
  const carveCurvature = Math.sin(absEdge) / cfg.sidecutRadius;
  const carveRate = Math.abs(vLong) * carveCurvature;
  const pivotRate =
    (cfg.pivotRateLow + (cfg.pivotRateHigh - cfg.pivotRateLow) * smoothstep(3, 14, speed)) * Math.abs(steer);
  const turnSign = steer !== 0 ? Math.sign(steer) : Math.sign(body.edgeAngle);
  // Turning direction follows travel direction so switch riding steers consistently on screen.
  const yawRate = turnSign * Math.min(cfg.maxGroundYawRate, Math.max(carveRate, pivotRate));
  body.yawRate = yawRate;
  if (yawRate !== 0) {
    _q.setFromAxisAngle(_n, yawRate * dt);
    h.applyQuaternion(_q).normalize();
    _left.crossVectors(_n, h).normalize();
  }

  // --- 3. Forces -------------------------------------------------------------------------------
  let N = body.normalForce;
  if (N <= 0 && contactCount > 0) N = m * cfg.gravity * Math.max(0, _n.y);
  const grounded = contactCount > 0;

  // Load distribution: the outside ski of a turn carries more weight.
  const shift = clamp(Math.sin(body.edgeAngle) * 0.55, -0.4, 0.4);
  let loadL = N * (0.5 - shift);
  let loadR = N * (0.5 + shift);
  if (!body.skis[0].inContact) {
    loadR += loadL;
    loadL = 0;
  }
  if (!body.skis[1].inContact) {
    loadL += loadR;
    loadR = 0;
  }
  if (!grounded) {
    loadL = 0;
    loadR = 0;
  }
  body.skis[0].load = loadL;
  body.skis[1].load = loadR;
  body.skis[0].edgeAngle = body.edgeAngle * (shift > 0 ? 0.8 : 1);
  body.skis[1].edgeAngle = body.edgeAngle * (shift < 0 ? 0.8 : 1);
  const totalLoad = loadL + loadR;

  _acc.set(0, -cfg.gravity, 0);

  // Braking ramps in gradually - never an instant stop.
  body.brakeAmount = approach(body.brakeAmount, clamp(control.brake, 0, 1), dt / cfg.brakeRampTime);

  // Longitudinal friction.
  const muLong = cfg.glideFriction + cfg.brakeFriction * body.brakeAmount;
  let aLong = -(muLong * totalLoad) / m - cfg.snowResistance * Math.abs(vLong);
  aLong *= Math.sign(vLong);
  if (Math.abs(aLong * dt) > Math.abs(vLong)) aLong = -vLong / dt;
  _acc.addScaledVector(h, aLong);

  // Lateral edge grip. Braking skids the skis sideways which keeps grip low but scrubs speed via muLong.
  const edgeGrip = clamp(absEdge / (cfg.maxEdgeAngle * 0.6), 0, 1);
  const muLat = cfg.lateralFrictionFlat + (cfg.lateralFrictionEdged - cfg.lateralFrictionFlat) * edgeGrip;
  const maxLatAcc = (muLat * totalLoad) / m;
  const aLat = clamp(-vLat / cfg.lateralGripTime, -maxLatAcc, maxLatAcc);
  _acc.addScaledVector(_left, aLat);
  body.skidSpeed = Math.abs(vLat);
  for (const ski of body.skis) ski.skidSpeed = ski.inContact ? Math.abs(vLat) : 0;

  // Air drag.
  const cda = control.push ? cfg.dragAreaTuck : cfg.dragAreaUpright;
  body.tucking = control.push;
  const vMag = v.length();
  _acc.addScaledVector(v, (-0.5 * cfg.airDensity * cda * vMag) / m);

  // Skating / poling at low speed.
  if (control.push && grounded && Math.abs(vLong) < cfg.pushMaxSpeed) {
    const dir = vLong < -0.5 ? -1 : 1;
    _acc.addScaledVector(h, dir * cfg.pushAcceleration * (1 - Math.abs(vLong) / cfg.pushMaxSpeed));
  }

  // --- 4. Integrate ----------------------------------------------------------------------------
  v.addScaledVector(_acc, dt);
  clampLength(v, cfg.maxSpeed);
  p.addScaledVector(v, dt);

  // --- 5. Contact constraint -------------------------------------------------------------------
  surface.sample(p.x, p.z, _s);
  const gap = (p.y - _s.height) * _s.normal.y;
  let nInst = 0;
  if (gap < 0) {
    p.y = _s.height;
    const vIn = v.dot(_s.normal);
    if (vIn < 0) {
      v.addScaledVector(_s.normal, -vIn);
      nInst = (m * -vIn) / dt;
    }
  }
  body.normalForce += (Math.min(nInst, m * cfg.gravity * 6) - body.normalForce) * 0.5;
  body.groundGap = Math.max(0, p.y - _s.height);
  body.surfaceType = _s.type;
  body.featureId = _s.featureId;

  const sepSpeed = v.dot(_s.normal);
  if (gap > cfg.airborneGap || (gap > cfg.contactTolerance * 0.5 && sepSpeed > cfg.takeoffSeparationSpeed)) {
    result.leftGround = true;
    result.separationSpeed = sepSpeed;
    // Report the surface the skier took off from, not the one below them now.
    body.surfaceType = startSurface;
    body.featureId = startFeature;
  }

  // --- 6. Orientation --------------------------------------------------------------------------
  quaternionFromForwardUp(h, body.groundNormal, body.orientation);
  body.angularVelocity.copy(body.groundNormal).multiplyScalar(yawRate);
  body.grounded = !result.leftGround;

  if (!isFiniteVector(p) || !isFiniteVector(v)) {
    // Numerical safeguard: never propagate NaNs.
    v.set(0, 0, 0);
    p.set(0, surface.height(0, 0), 0);
  }
  return result;
}

/** Applies an instantaneous pop along the snow normal (jump). */
export function applyPop(body: SkierBody, popSpeed: number): void {
  body.velocity.addScaledVector(body.groundNormal, popSpeed);
  body.grounded = false;
}
