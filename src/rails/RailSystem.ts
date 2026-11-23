import { Vector3 } from 'three';
import type { RailConfig } from '../config/physicsConfig';
import { RAD2DEG, clamp, quaternionFromForwardUp, wrapAngle } from '../core/math';
import { Random } from '../core/Random';
import type { Park, RailObstacle } from '../park/Park';
import type { SkierBody } from '../player/SkierBody';
import { createRailProjection, type RailProjection } from './RailPath';

export type RailStance = 'fifty' | 'switchFifty' | 'slide';
export type RailPress = 'none' | 'nose' | 'tail';

export interface RailLockCandidate {
  rail: RailObstacle;
  s: number;
  /** +1 when travelling towards increasing s. */
  direction: 1 | -1;
  /** Speed along the rail (m/s, >= 0). */
  speed: number;
}

export interface GrindState {
  rail: RailObstacle;
  s: number;
  /** Signed speed along the rail parameter (m/s). */
  speed: number;
  stance: RailStance;
  /** Yaw of the body relative to the travel direction (rad): 0, ±PI/2 or PI. */
  stanceYaw: number;
  balance: number;
  time: number;
  distance: number;
  entrySpinDeg: number;
  press: RailPress;
  noseTime: number;
  tailTime: number;
  lastSegment: number;
}

/** Summary of a completed grind, used by scoring. */
export interface RailTrick {
  railId: string;
  railLabel: string;
  kind: 'rail' | 'box';
  stance: RailStance;
  press: RailPress;
  entrySpinDeg: number;
  outSpinDeg: number;
  distance: number;
  time: number;
  difficulty: number;
  signature: string;
  name: string;
}

export interface GrindInput {
  /** -1..1 balance correction (A/D). */
  balance: number;
  /** +1 nose press (W), -1 tail press (S). */
  press: number;
}

const _proj: RailProjection = createRailProjection();
const _d = new Vector3();
const _tangent = new Vector3();
const _hv = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();

/**
 * Rail & box interaction. Every obstacle is a geometric path; the skier's position on it is the arc-length
 * parameter s and the local tangent drives orientation. Locking requires the skis to arrive close to the
 * path, from above, roughly aligned with it and with enough speed. While grinding, gravity along the
 * tangent and kinetic friction change the speed, and a balance value drifts (harder on slides, kinks and at
 * speed) which the player counters with A/D.
 */
export class RailSystem {
  readonly park: Park;
  readonly cfg: RailConfig;
  private readonly rng: Random;
  private readonly cooldowns = new Map<string, number>();
  grind: GrindState | null = null;
  private driftTarget = 0;
  private driftTimer = 0;

  constructor(park: Park, cfg: RailConfig, seed: number) {
    this.park = park;
    this.cfg = cfg;
    this.rng = new Random(seed);
  }

  reset(seed: number): void {
    this.grind = null;
    this.cooldowns.clear();
    this.rng.reseed(seed);
    this.driftTarget = 0;
    this.driftTimer = 0;
  }

  tickCooldowns(dt: number): void {
    for (const [id, t] of this.cooldowns) {
      const nt = t - dt;
      if (nt <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, nt);
    }
  }

  /** Finds a rail the skier can lock onto this step. */
  findLock(body: SkierBody, previousFootY: number): RailLockCandidate | null {
    const p = body.position;
    const v = body.velocity;
    let best: RailLockCandidate | null = null;
    let bestDist = Infinity;
    for (const rail of this.park.rails) {
      if (this.cooldowns.has(rail.id)) continue;
      const m = 1.5;
      const path = rail.path;
      if (p.x < path.min.x - m || p.x > path.max.x + m || p.z < path.min.z - m || p.z > path.max.z + m)
        continue;
      if (p.y < path.min.y - 1.5 || p.y > path.max.y + 1.5) continue;
      path.project(p, _proj);
      _d.subVectors(p, _proj.point);
      const dy = _d.y;
      _tangent.copy(_proj.tangent);
      // Reject points beyond the ends of the path (projection clamped to an endpoint).
      if (Math.abs(_d.dot(_tangent)) > 0.45) continue;
      // Horizontal distance perpendicular to the rail.
      _hv.copy(_d).addScaledVector(_tangent, -_d.dot(_tangent));
      _hv.y = 0;
      const lateral = _hv.length();
      if (lateral > rail.halfWidth + this.cfg.lockRadius) continue;
      if (dy < -this.cfg.lockBelow || dy > this.cfg.lockAbove) continue;
      const prevDy = previousFootY - _proj.point.y;
      if (prevDy < -this.cfg.lockBelow) continue; // coming from below
      if (v.y > 2.5) continue;
      const along = v.dot(_tangent);
      if (Math.abs(along) < this.cfg.minLockSpeed) continue;
      // Angle between horizontal travel and rail direction.
      const hvx = v.x;
      const hvz = v.z;
      const hl = Math.hypot(hvx, hvz);
      const tl = Math.hypot(_tangent.x, _tangent.z);
      if (hl > 0.5 && tl > 0.2) {
        const cos = Math.abs((hvx * _tangent.x + hvz * _tangent.z) / (hl * tl));
        if (Math.acos(clamp(cos, -1, 1)) > this.cfg.maxEntryAngle) continue;
      }
      const dir: 1 | -1 = along >= 0 ? 1 : -1;
      // Do not lock right at the far end in the travel direction.
      const remaining = dir > 0 ? path.totalLength - _proj.s : _proj.s;
      if (remaining < 0.6) continue;
      const dist = lateral + Math.abs(dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { rail, s: _proj.s, direction: dir, speed: Math.abs(along) };
      }
    }
    return best;
  }

  /** Locks the skier onto the rail. `entrySpin` is the rotation done in the air before locking (rad). */
  begin(body: SkierBody, c: RailLockCandidate, entrySpin: number): GrindState {
    const rail = c.rail;
    rail.path.tangentAt(c.s, _tangent);
    const travel = _hv.copy(_tangent).multiplyScalar(c.direction);
    _fwd.set(0, 0, 1).applyQuaternion(body.orientation);
    const fwdYaw = Math.atan2(_fwd.x, _fwd.z);
    const travelYaw = Math.atan2(travel.x, travel.z);
    const rel = wrapAngle(fwdYaw - travelYaw);
    const absRel = Math.abs(rel);
    let stance: RailStance;
    let stanceYaw: number;
    if (absRel < Math.PI / 4) {
      stance = 'fifty';
      stanceYaw = 0;
    } else if (absRel > (3 * Math.PI) / 4) {
      stance = 'switchFifty';
      stanceYaw = Math.PI;
    } else {
      stance = 'slide';
      stanceYaw = Math.sign(rel) * (Math.PI / 2);
    }
    const entrySpinDeg = Math.round(Math.abs(entrySpin * RAD2DEG) / 90) * 90;
    this.grind = {
      rail,
      s: c.s,
      speed: c.speed * c.direction,
      stance,
      stanceYaw,
      balance: 0,
      time: 0,
      distance: 0,
      entrySpinDeg: entrySpinDeg >= 90 ? entrySpinDeg : 0,
      press: 'none',
      noseTime: 0,
      tailTime: 0,
      lastSegment: -1,
    };
    // Deterministic but varied per attempt: seed the balance drift from the entry state.
    const entrySeed =
      Math.floor(body.position.x * 997 + body.position.z * 131 + c.speed * 1009) ^ (rail.id.length * 7919);
    this.rng.reseed(entrySeed);
    this.driftTarget = (this.rng.next() * 2 - 1) * 0.6;
    this.driftTimer = 0;
    body.angularVelocity.set(0, 0, 0);
    this.applyToBody(body);
    return this.grind;
  }

  /**
   * Advances the grind. Returns 'exit' when the skier rides off an end, 'bail' when balance is lost,
   * otherwise 'grinding'.
   */
  step(body: SkierBody, input: GrindInput, gravity: number, dt: number): 'grinding' | 'exit' | 'bail' {
    const g = this.grind;
    if (!g) return 'exit';
    const path = g.rail.path;
    path.tangentAt(g.s, _tangent);
    // Gravity along the path and kinetic friction (normal force ≈ m g cos(pitch)).
    const along = -gravity * _tangent.y;
    const cosPitch = Math.sqrt(Math.max(0, 1 - _tangent.y * _tangent.y));
    let mu = g.rail.kind === 'box' ? this.cfg.boxFriction : this.cfg.railFriction;
    if (g.stance === 'slide') mu *= this.cfg.slideFrictionMultiplier;
    const friction = mu * gravity * cosPitch;
    let newSpeed = g.speed + along * dt;
    const fr = friction * dt;
    if (Math.abs(newSpeed) <= fr) newSpeed = 0;
    else newSpeed -= Math.sign(newSpeed) * fr;
    if (newSpeed === 0 && Math.abs(along) > friction) newSpeed = Math.sign(along) * 0.01;
    g.speed = newSpeed;
    g.s += g.speed * dt;
    g.time += dt;
    g.distance += Math.abs(g.speed) * dt;

    // Press tricks.
    g.press = input.press > 0 ? 'nose' : input.press < 0 ? 'tail' : 'none';
    if (g.press === 'nose') g.noseTime += dt;
    if (g.press === 'tail') g.tailTime += dt;

    // Balance: smooth random drift + mild instability around the balance point, countered by input.
    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTarget = this.rng.next() * 2 - 1;
      this.driftTimer = 0.35 + this.rng.next() * 0.5;
    }
    const speedFactor = 0.55 + Math.abs(g.speed) / this.cfg.balanceSpeedReference;
    const stanceFactor = g.stance === 'slide' ? 1.3 : 1;
    const pressFactor = g.press !== 'none' ? 1.25 : 1;
    const drift =
      this.driftTarget *
      this.cfg.balanceDrift *
      speedFactor *
      stanceFactor *
      pressFactor *
      (0.7 + g.rail.difficulty * 0.3);
    g.balance += (drift + g.balance * this.cfg.balanceInstability) * dt;
    g.balance -= clamp(input.balance, -1, 1) * this.cfg.balanceCorrection * dt;

    // Kinks unsettle the skier.
    const seg = clamp(Math.floor(this.segmentIndex(g.s)), 0, path.points.length - 2);
    if (g.lastSegment >= 0 && seg !== g.lastSegment && path.kinks.includes(Math.max(seg, g.lastSegment))) {
      g.balance += (this.rng.next() < 0.5 ? -1 : 1) * 0.22;
    }
    g.lastSegment = seg;

    if (Math.abs(g.balance) >= 1) return 'bail';
    if (g.s >= path.totalLength || g.s <= 0) {
      g.s = clamp(g.s, 0, path.totalLength);
      this.applyToBody(body);
      return 'exit';
    }
    this.applyToBody(body);
    return 'grinding';
  }

  private segmentIndex(s: number): number {
    const L = this.grind!.rail.path.lengths;
    for (let i = 0; i < L.length - 1; i++) if (s < L[i + 1]) return i;
    return L.length - 2;
  }

  /** Writes the grind state into the skier body (position on the path, orientation from the tangent). */
  applyToBody(body: SkierBody): void {
    const g = this.grind;
    if (!g) return;
    const path = g.rail.path;
    path.pointAt(g.s, body.position);
    path.tangentAt(g.s, _tangent);
    const dirSign = g.speed >= 0 ? 1 : -1;
    body.velocity.copy(_tangent).multiplyScalar(g.speed);
    // Travel direction (horizontal) rotated by the stance yaw gives the ski direction.
    const travelYaw = Math.atan2(_tangent.x * dirSign, _tangent.z * dirSign);
    const yaw = travelYaw + g.stanceYaw;
    const pitchSlope = _tangent.y * dirSign;
    // Forward follows the rail pitch when riding along it; perpendicular stance stays level.
    const alongFactor = Math.cos(g.stanceYaw);
    _fwd.set(Math.sin(yaw), pitchSlope * alongFactor, Math.cos(yaw)).normalize();
    body.heading.copy(_fwd);
    // Up = world up made orthogonal to the (possibly pitched) forward direction.
    _up.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();
    quaternionFromForwardUp(_fwd, _up, body.orientation);
    body.groundNormal.copy(_up);
    body.grounded = false;
  }

  /** Ends the current grind and returns the trick summary. */
  end(cooldown = true): RailTrick | null {
    const g = this.grind;
    if (!g) return null;
    this.grind = null;
    if (cooldown) this.cooldowns.set(g.rail.id, this.cfg.relockCooldown);
    let press: RailPress = 'none';
    const pressThreshold = Math.max(0.35, g.time * 0.4);
    if (g.noseTime >= pressThreshold && g.noseTime >= g.tailTime) press = 'nose';
    else if (g.tailTime >= pressThreshold) press = 'tail';
    const trick: RailTrick = {
      railId: g.rail.id,
      railLabel: g.rail.config.label ?? (g.rail.kind === 'box' ? 'Box' : 'Rail'),
      kind: g.rail.kind,
      stance: g.stance,
      press,
      entrySpinDeg: g.entrySpinDeg,
      outSpinDeg: 0,
      distance: g.distance,
      time: g.time,
      difficulty: g.rail.difficulty,
      signature: '',
      name: '',
    };
    trick.signature = railSignature(trick);
    trick.name = formatRailTrickName(trick);
    return trick;
  }
}

export function railSignature(t: RailTrick): string {
  return `rail:${t.railId}:${t.stance}:${t.press}:${t.entrySpinDeg}:${t.outSpinDeg}`;
}

export function formatRailTrickName(t: RailTrick): string {
  const parts: string[] = [];
  if (t.entrySpinDeg > 0) parts.push(`${t.entrySpinDeg} On`);
  let base: string;
  if (t.press === 'nose') base = 'Nose Slide';
  else if (t.press === 'tail') base = 'Tail Slide';
  else if (t.stance === 'fifty') base = '50-50';
  else if (t.stance === 'switchFifty') base = 'Switch 50-50';
  else base = 'Boardslide';
  if (t.press !== 'none' && t.stance === 'slide')
    base = `Boardslide ${t.press === 'nose' ? 'Nose' : 'Tail'} Press`;
  parts.push(base);
  if (t.outSpinDeg > 0) parts.push(`${t.outSpinDeg} Out`);
  return parts.join(' ');
}
