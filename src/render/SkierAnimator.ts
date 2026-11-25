import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { LandingQuality } from '../landing/LandingEvaluator';
import type { PlayerState } from '../player/PlayerState';
import type { RailPress, RailStance } from '../rails/RailSystem';
import type { GrabDefinition } from '../tricks/grabs';
import { aimDownAxis, solveTwoBoneIK } from './IK';
import { grabStyleFor, type GrabStyle } from './skier/grabStyles';
import { GETUP_TIME, RagdollDriver, type SkierRagdollPose } from './skier/RagdollDriver';
import { createSpring, damp, ramp, stepSpring, stepSpring3, wobble, type Spring3 } from './skier/springs';
import { RIG, type SkierModel } from './SkierModel';

/**
 * Everything the animator needs to know about the simulation this frame (the sim -> animation contract).
 * Built by `buildSkierPose` in poseFromSim.ts from read-only views of the simulation.
 */
export interface SkierPoseInput {
  state: PlayerState;
  /** State before the current one (derives takeoff, landing and recovery blends). */
  previousState: PlayerState;
  /** Seconds spent in the current state. */
  timeInState: number;
  edgeAngle: number;
  brake: number;
  speed: number;
  tucking: boolean;
  charge: number;
  landingCompression: number;
  /** Quality of the most recent landing (null before the first one). */
  landingQuality: LandingQuality | null;
  /** Vertical gap to the snow (legs extend to reach it). */
  groundGap: number;
  grab: GrabDefinition | null;
  grabBlend: number;
  railStance: RailStance | null;
  /** Body yaw relative to the rail travel direction (0, +-PI/2, PI). */
  railStanceYaw: number;
  railBalance: number;
  railPress: RailPress;
  spinRate: number;
  /** Body-frame angular velocity (rad/s): yaw (spin), pitch (+ = frontflip), roll. */
  localSpin: number;
  localFlip: number;
  localRoll: number;
  /** Predicted seconds to touchdown while airborne, -1 when unknown. */
  impactTime: number;
  airTime: number;
  /** Ground turn rate (rad/s). */
  yawRate: number;
  skidSpeed: number;
  /** Load distribution between the skis: -1 all left .. +1 all right. */
  loadBias: number;
  switchStance: boolean;
  time: number;
  /**
   * Crash ragdoll (interpolated world segment transforms). While `ragdoll.active`, the rig shows only
   * the ragdoll: no layer, IK, spring or noise touches the bones.
   */
  ragdoll: SkierRagdollPose;
}

// ---------------------------------------------------------------------------------------------------
// Pose parameters. Every layer writes a full parameter set; layers are blended by smoothly damped
// weights, so state changes never pop.

const SCALARS = [
  'crouch',
  'pelvisX',
  'pelvisZ',
  'pelvisPitch',
  'pelvisYaw',
  'pelvisRoll',
  'spinePitch',
  'spineYaw',
  'spineRoll',
  'neckPitch',
  'neckYaw',
  'neckRoll',
  'lean',
  'bodyYaw',
  'bodyPitch',
] as const;
type ScalarKey = (typeof SCALARS)[number];

class Pose {
  readonly s = {} as Record<ScalarKey, number>;
  /** Hand targets in chest space. */
  readonly hand: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** Pole directions in body space (unit). */
  readonly pole: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** Ski bone positions (ski centre at the base) in body space. */
  readonly ski: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** Ski attitude (x = pitch, y = yaw, z = roll) in body space. */
  readonly skiRot: [Vector3, Vector3] = [new Vector3(), new Vector3()];

  constructor() {
    for (const k of SCALARS) this.s[k] = 0;
  }

  copy(o: Pose): this {
    for (const k of SCALARS) this.s[k] = o.s[k];
    for (let i = 0; i < 2; i++) {
      this.hand[i].copy(o.hand[i]);
      this.pole[i].copy(o.pole[i]);
      this.ski[i].copy(o.ski[i]);
      this.skiRot[i].copy(o.skiRot[i]);
    }
    return this;
  }

  /** this = this * (1 - w) + o * w */
  mix(o: Pose, w: number): this {
    if (w <= 0) return this;
    if (w >= 1) return this.copy(o);
    for (const k of SCALARS) this.s[k] += (o.s[k] - this.s[k]) * w;
    for (let i = 0; i < 2; i++) {
      this.hand[i].lerp(o.hand[i], w);
      this.pole[i].lerp(o.pole[i], w);
      this.ski[i].lerp(o.ski[i], w);
      this.skiRot[i].lerp(o.skiRot[i], w);
    }
    return this;
  }

  /** Weighted accumulation (for normalised multi-layer blends). */
  addScaled(o: Pose, w: number): this {
    for (const k of SCALARS) this.s[k] += o.s[k] * w;
    for (let i = 0; i < 2; i++) {
      this.hand[i].addScaledVector(o.hand[i], w);
      this.pole[i].addScaledVector(o.pole[i], w);
      this.ski[i].addScaledVector(o.ski[i], w);
      this.skiRot[i].addScaledVector(o.skiRot[i], w);
    }
    return this;
  }

  clear(): this {
    for (const k of SCALARS) this.s[k] = 0;
    for (let i = 0; i < 2; i++) {
      this.hand[i].set(0, 0, 0);
      this.pole[i].set(0, 0, 0);
      this.ski[i].set(0, 0, 0);
      this.skiRot[i].set(0, 0, 0);
    }
    return this;
  }
}

const SIDE = [1, -1] as const;
const LEG = RIG.thigh + RIG.shin;
const ARM = RIG.upperArm + RIG.forearm;
/** Distance from the wrist joint to the palm centre of the glove. */
const PALM = 0.065;
/** Grab point height above the ski base (top sheet + glove thickness). */
const GRAB_HEIGHT = 0.05;
/** After a crash the recovery crouch holds while the get-up blend lands in it, then stands up (s). */
const RECOVER_HOLD = GETUP_TIME * 0.6;

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
const _knee = new Vector3();
const _target = new Vector3();
const _grab = new Vector3();
const _shoulder = new Vector3();
const _wrist = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _bodyQ = new Quaternion();
const _chestQ = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _m = new Matrix4();
const _bodyInv = new Matrix4();
const _poleW = new Vector3();
const _fallbackW = new Vector3();
const _up = new Vector3(0, 1, 0);
const _skiPos: [Vector3, Vector3] = [new Vector3(), new Vector3()];

const GROUND: ReadonlySet<PlayerState> = new Set<PlayerState>([
  'IDLE',
  'RIDING',
  'CARVING',
  'BRAKING',
  'JUMP_CHARGING',
  'LANDING',
]);

/** True when one of the grab's targets uses this hand (0 = left). No allocation. */
function usesHand(g: GrabDefinition, i: number): boolean {
  for (const t of g.targets) if ((t.hand === 'left') === (i === 0)) return true;
  return false;
}

/** True when one of the grab's targets is on this ski (0 = left). */
function usesSki(g: GrabDefinition, i: number): boolean {
  for (const t of g.targets) if ((t.ski === 'left') === (i === 0)) return true;
  return false;
}

function skiQuat(rot: Vector3, out: Quaternion): Quaternion {
  _e.set(rot.x, rot.y, rot.z, 'YXZ');
  return out.setFromEuler(_e);
}

/**
 * Layered procedural animation. Pose layers (ground riding/carving/braking/charging/tuck, air
 * takeoff/spin/flip/grab/landing-prep, rail, recovery) are computed from the simulation each
 * frame and blended with damped weights. Secondary motion (crouch compression, hands, head) runs on
 * springs. The rig is then solved with two-bone IK: skis are placed first (on the snow, or where the
 * pose / grab puts them), legs reach the skis, and arms reach their targets - for grabs the real grab
 * point on the ski. The root transform always comes from physics; animation only shapes the pose.
 */
export class SkierAnimator {
  private readonly target = new Pose();
  private readonly ground = new Pose();
  private readonly air = new Pose();
  private readonly rail = new Pose();
  private readonly cur = new Pose();
  private initialised = false;

  // Damped mode / sub-layer weights.
  private wGround = 1;
  private wAir = 0;
  private wRail = 0;
  private wCarve = 0;
  private wBrake = 0;
  private wCharge = 0;
  private wTuck = 0;
  private wIdle = 1;
  private wSpin = 0;
  private wFlip = 0;
  private wPrep = 0;
  private wSwitch = 0;
  private wGrab = 0;
  private spinSign = 1;
  private flipSign = 1;
  private rollSign = 1;
  private brakeSide = 1;
  private lastTurn = 1;
  private legExtend = 0;
  private lastState: PlayerState | null = null;
  private recoverClock = -1;
  private sketchyClock = -1;
  private landClock = -1;
  private lastGrab: GrabDefinition | null = null;
  private readonly crouch = createSpring(0.35);
  private readonly headPitch = createSpring(0);
  /** Displays the crash ragdoll, blends into it and owns the get-up transition. */
  private readonly ragdoll = new RagdollDriver();
  private ragdollOn = false;
  private restartFromRagdoll = false;
  private readonly hands: [Spring3, Spring3] = [
    { x: new Vector3(), v: new Vector3() },
    { x: new Vector3(), v: new Vector3() },
  ];

  /** Largest distance between a grabbing hand and its grab point (m), for tests / QA. */
  grabError = 0;
  /** Largest distance between an IK foot target and the reached ankle (m), for tests / QA. */
  footError = 0;

  /** True while the crash ragdoll drives the rig (including its blend in). */
  get ragdollActive(): boolean {
    return this.ragdoll.active;
  }
  /** Ragdoll blend-in weight (0 = animated, 1 = ragdoll), for tests / QA. */
  get ragdollBlendIn(): number {
    return this.ragdoll.blendInWeight;
  }
  /** True during the get-up blend after a crash. */
  get gettingUp(): boolean {
    return this.ragdoll.gettingUp;
  }

  update(m: SkierModel, p: SkierPoseInput, dtIn: number): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    const rd = p.ragdoll.active ? p.ragdoll : null;
    this.ragdollOn = rd !== null;
    this.trackTransitions(p);
    this.updateWeights(p, dt);

    if (rd) {
      // Physics owns the body: the ragdoll drives every bone; the animation layers do not run.
      this.ragdoll.drive(m, rd, dt);
      // The animated pose restarts from the recovery crouch when the get-up begins.
      this.initialised = false;
      this.restartFromRagdoll = true;
      this.lastState = p.state;
      return;
    }
    if (this.ragdoll.active) {
      // The ragdoll ended (recover()): get up from its last pose.
      this.ragdoll.beginGetUp();
      if (this.recoverClock < 0) this.recoverClock = 0;
    }

    this.buildGround(this.ground, p);
    this.buildAir(this.air, p);
    this.buildRail(this.rail, p);

    const t = this.target.clear();
    const sum = this.wGround + this.wAir + this.wRail || 1;
    t.addScaled(this.ground, this.wGround / sum);
    t.addScaled(this.air, this.wAir / sum);
    t.addScaled(this.rail, this.wRail / sum);

    // Final smoothing stage (kills residual discontinuities, adds a little follow-through).
    if (!this.initialised) {
      this.cur.copy(t);
      this.crouch.x = t.s.crouch;
      for (let i = 0; i < 2; i++) this.hands[i].x.copy(t.hand[i]);
      if (this.restartFromRagdoll) {
        // The get-up target starts settled in the recovery crouch (no spring swing from the old pose).
        this.crouch.v = 0;
        this.headPitch.x = t.s.neckPitch;
        this.headPitch.v = 0;
        for (let i = 0; i < 2; i++) this.hands[i].v.set(0, 0, 0);
        this.restartFromRagdoll = false;
      }
      this.initialised = true;
    }
    const k = 1 - Math.exp(-18 * dt);
    this.cur.mix(t, k);
    // Springs: compression with a slight rebound, hands with lag, head with a nod on impacts.
    stepSpring(this.crouch, t.s.crouch, 4.2, 0.62, dt);
    this.cur.s.crouch = this.crouch.x;
    stepSpring(this.headPitch, t.s.neckPitch, 3.2, 0.55, dt);
    this.cur.s.neckPitch = this.headPitch.x;
    for (let i = 0; i < 2; i++) {
      stepSpring3(this.hands[i], t.hand[i], 4.5, 0.72, dt);
      this.cur.hand[i].copy(this.hands[i].x);
    }

    const groundExact = GROUND.has(p.state) ? 1 : 0;
    this.legExtend = damp(this.legExtend, groundExact ? Math.min(0.25, Math.max(0, p.groundGap)) : 0, 18, dt);
    this.apply(m, this.cur, groundExact);
    // Get-up: world-space blend from the last ragdoll pose into this animated pose.
    if (this.ragdoll.gettingUp) this.ragdoll.applyGetUp(m, this.recoverClock);
    this.ragdoll.recordAnimated(m);
    this.lastState = p.state;
  }

  // -------------------------------------------------------------------------------------------------

  private trackTransitions(p: SkierPoseInput): void {
    const prev = this.lastState;
    if (prev !== p.state) {
      if (p.state === 'LANDING') {
        this.landClock = 0;
        // Landing impulse into the compression spring (scaled by impact).
        this.crouch.v += 1.6 + p.landingCompression * 3.2;
        this.headPitch.v += 1.5 + p.landingCompression * 2.5;
        this.sketchyClock = p.landingQuality === 'sketchy' ? 0 : -1;
      }
      if (p.state === 'BRAKING') {
        this.brakeSide = Math.abs(p.edgeAngle) > 0.05 ? Math.sign(p.edgeAngle) : this.lastTurn;
      }
      if (prev === 'CRASHED' && p.state !== 'CRASHED') this.recoverClock = 0;
    }
    if (p.state === 'CRASHED') this.recoverClock = -1;
    // Deterministic source (replays): time since leaving the crash. The fixed-step clock is quantised,
    // so the frame clock runs on and is re-synchronised whenever it drifts by more than two steps.
    if (p.previousState === 'CRASHED' && p.state !== 'CRASHED') {
      if (this.recoverClock < 0 || Math.abs(this.recoverClock - p.timeInState) > 1 / 30)
        this.recoverClock = p.timeInState;
    }
    if (Math.abs(p.edgeAngle) > 0.08) this.lastTurn = Math.sign(p.edgeAngle);
  }

  private updateWeights(p: SkierPoseInput, dt: number): void {
    const s = p.state;
    const air = s === 'AIRBORNE';
    const rail = s === 'RAIL_GRINDING';
    // A crash is displayed by the ragdoll; the animated layers keep the ground pose (the get-up target).
    const ground = !air && !rail;
    // Touch-down must be quick (skis on the snow), take-off a little softer.
    const toGround = ground && this.wGround < 0.999 ? 22 : 10;
    this.wGround = damp(this.wGround, ground ? 1 : 0, toGround, dt);
    this.wAir = damp(this.wAir, air ? 1 : 0, 12, dt);
    this.wRail = damp(this.wRail, rail ? 1 : 0, 14, dt);

    this.wCarve = damp(this.wCarve, Math.min(1, Math.abs(p.edgeAngle) / 0.35), 10, dt);
    this.wBrake = damp(this.wBrake, s === 'BRAKING' ? p.brake : 0, 7, dt);
    this.wCharge = damp(this.wCharge, s === 'JUMP_CHARGING' ? 1 : 0, 14, dt);
    this.wTuck = damp(this.wTuck, p.tucking && ground ? 1 : 0, 6, dt);
    this.wIdle = damp(this.wIdle, s === 'IDLE' && p.speed < 1.5 ? 1 : 0, 3, dt);
    this.wSwitch = damp(this.wSwitch, p.switchStance && ground ? 1 : 0, 4, dt);

    const spin = Math.abs(p.localSpin);
    const flip = Math.abs(p.localFlip);
    if (spin > 1.0) this.spinSign = Math.sign(p.localSpin);
    if (flip > 1.0) this.flipSign = Math.sign(p.localFlip);
    if (Math.abs(p.localRoll) > 1.0) this.rollSign = Math.sign(p.localRoll);
    this.wSpin = damp(this.wSpin, air ? ramp(1.2, 4.5, spin) : 0, 8, dt);
    this.wFlip = damp(this.wFlip, air ? ramp(1.5, 4.0, Math.max(flip, Math.abs(p.localRoll))) : 0, 8, dt);
    const prep = air && p.impactTime >= 0 && p.airTime > 0.2 ? 1 - ramp(0.12, 0.42, p.impactTime) : 0;
    this.wPrep = damp(this.wPrep, prep, 16, dt);

    if (p.grab && p.grabBlend > 0) this.lastGrab = p.grab;
    this.wGrab = air ? p.grabBlend : damp(this.wGrab, 0, 20, dt);

    if (this.recoverClock >= 0) this.recoverClock += dt;
    if (this.sketchyClock >= 0) this.sketchyClock += dt;
    if (this.landClock >= 0) this.landClock += dt;
    if (this.sketchyClock > 1.4) this.sketchyClock = -1;
    if (this.landClock > 1.0) this.landClock = -1;
  }

  // -------------------------------------------------------------------------------------------------
  // Layers

  private neutral(P: Pose): void {
    P.clear();
    P.s.crouch = 0.35;
    P.s.spinePitch = 0.12;
    P.s.pelvisPitch = 0.08;
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      P.hand[i].set(sd * 0.28, -0.3, 0.34);
      P.pole[i].set(sd * 0.1, -0.62, -0.78).normalize();
      P.ski[i].set(sd * RIG.stance, 0, 0);
    }
  }

  private buildGround(P: Pose, p: SkierPoseInput): void {
    this.neutral(P);
    const t = p.time;
    const speedK = Math.min(1, p.speed / 18);
    const edge = p.edgeAngle;
    const absEdge = Math.abs(edge);
    const turn = absEdge > 0.01 ? Math.sign(edge) : this.lastTurn;

    // Athletic stance, deeper with speed and edge angle; subtle terrain chatter at speed.
    let crouch = 0.3 + 0.12 * speedK + absEdge * 0.3;
    const chatter = (wobble(t * 9, 1) * 0.6 + wobble(t * 17, 2) * 0.4) * 0.03 * speedK;
    crouch += chatter;

    // Carve: whole body leans into the turn from the feet, upper body angulates back towards vertical.
    const lean = edge * 0.85;
    P.s.lean = lean;
    P.s.spineRoll = lean * 0.42;
    P.s.neckRoll = lean * 0.3;
    P.s.neckYaw = edge * 0.35;
    P.s.spineYaw = edge * 0.12;
    // Weight on the outside ski: pelvis shifts a touch over it.
    P.s.pelvisX = -p.loadBias * 0.03;

    // Carving hands: inside hand low and forward, outside hand out for balance.
    const wc = this.wCarve;
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      const inside = sd === turn ? 1 : 0;
      const h = P.hand[i];
      const poleSwing = Math.sin(t * 2.2 + i * Math.PI) * 0.03 * speedK * (1 - wc);
      h.set(sd * 0.28, -0.3, 0.34 + poleSwing);
      if (inside) h.lerp(_v.set(sd * 0.33, -0.48, 0.36), wc);
      else h.lerp(_v.set(sd * 0.45, -0.2, 0.18), wc);
    }

    // Idle: relaxed, breathing, weight shifts, poles planted beside the skis, looking around.
    const wi = this.wIdle;
    if (wi > 0.001) {
      crouch = crouch * (1 - wi) + (0.24 + Math.sin(t * 1.7) * 0.012) * wi;
      P.s.pelvisX += Math.sin(t * 0.45) * 0.025 * wi;
      P.s.spinePitch += (Math.sin(t * 1.7) * 0.025 - 0.08) * wi;
      P.s.neckYaw += Math.sin(t * 0.31) * Math.sin(t * 0.17 + 1) * 0.6 * wi;
      P.s.neckPitch += (Math.sin(t * 0.23) * 0.1 - 0.05) * wi;
      for (let i = 0; i < 2; i++) {
        const sd = SIDE[i];
        P.hand[i].lerp(_v.set(sd * 0.33, -0.44, 0.16), wi);
        // Pole tip planted on the snow out to the side and slightly ahead.
        P.pole[i].lerp(_v.set(sd * 0.35, -0.9, 0.18).normalize(), wi);
      }
    }

    // Speed tuck: deep, hands in front of the face, poles under the arms.
    const wt = this.wTuck;
    if (wt > 0.001) {
      crouch += (0.8 - crouch) * wt;
      P.s.spinePitch += 0.75 * wt;
      P.s.neckPitch -= 0.25 * wt;
      for (let i = 0; i < 2; i++) {
        P.hand[i].lerp(_v.set(SIDE[i] * 0.1, -0.2, 0.36), wt);
        P.pole[i].lerp(_v.set(SIDE[i] * 0.12, -0.18, -0.98).normalize(), wt);
      }
    }

    // Hockey stop: skis across the fall line on the uphill edge, upper body faces down the hill.
    const wb = this.wBrake;
    if (wb > 0.001) {
      const yaw = this.brakeSide * wb * 0.95;
      P.s.bodyYaw = yaw;
      P.s.lean += this.brakeSide * wb * 0.42;
      P.s.spineYaw -= yaw * 0.62;
      P.s.neckYaw -= yaw * 0.3;
      P.s.spineRoll -= this.brakeSide * wb * 0.12;
      crouch += 0.2 * wb;
      for (let i = 0; i < 2; i++) {
        const sd = SIDE[i];
        P.hand[i].lerp(_v.set(sd * 0.3, -0.34, 0.34), wb);
      }
    }

    // Jump charge: compress, arms wind back, eyes up.
    const wch = this.wCharge;
    if (wch > 0.001) {
      const c = p.charge;
      crouch += (0.2 + c * 0.5) * wch;
      P.s.spinePitch += (0.15 + c * 0.25) * wch;
      P.s.neckPitch -= (0.15 + c * 0.15) * wch;
      for (let i = 0; i < 2; i++) {
        P.hand[i].lerp(_v.set(SIDE[i] * 0.3, -0.42, -0.12 - c * 0.12), wch * (0.4 + c * 0.6));
        P.pole[i].lerp(_v.set(SIDE[i] * 0.2, -0.45, -0.87).normalize(), wch);
      }
    }

    // Landing: compression (spring impulse on entry) plus the sim's absorb value; arms forward.
    const lc = p.landingCompression;
    if (lc > 0.001 || this.landClock >= 0) {
      crouch += lc * 0.55;
      const wl = Math.max(lc, this.landClock >= 0 ? 1 - ramp(0.2, 0.7, this.landClock) : 0);
      for (let i = 0; i < 2; i++) P.hand[i].lerp(_v.set(SIDE[i] * 0.33, -0.4, 0.36), wl * 0.8);
      P.s.spinePitch += lc * 0.25;
    }
    // Sketchy landing: decaying wobble of hips, torso and windmilling arms.
    if (this.sketchyClock >= 0) {
      const sc = this.sketchyClock;
      const a = Math.pow(Math.max(0, 1 - sc / 1.3), 2);
      const w = Math.sin(sc * 13) * a;
      P.s.pelvisRoll += 0.12 * w;
      P.s.spineRoll -= 0.22 * Math.sin(sc * 13 + 0.9) * a;
      P.s.lean += 0.06 * w;
      P.s.pelvisZ -= 0.05 * a;
      for (let i = 0; i < 2; i++) {
        const ph = sc * 11 + i * Math.PI;
        P.hand[i].add(
          _v.set(SIDE[i] * 0.2 * a, 0.35 * a * (0.6 + Math.sin(ph) * 0.5), 0.2 * a * Math.cos(ph)),
        );
      }
    }

    // Switch riding: look over the shoulder down the hill.
    if (this.wSwitch > 0.001) {
      P.s.neckYaw += 1.05 * this.wSwitch;
      P.s.spineYaw += 0.35 * this.wSwitch;
    }

    // Recovery after a crash: start low (hands on knees, the get-up blend lands here) and stand up.
    if (this.recoverClock >= 0 || this.ragdollOn) {
      const wr = this.ragdollOn ? 1 : 1 - ramp(RECOVER_HOLD, RECOVER_HOLD + 1.0, this.recoverClock);
      if (wr > 0) {
        crouch += (1.35 - crouch) * wr;
        P.s.spinePitch += 0.75 * wr;
        P.s.neckPitch += 0.3 * wr;
        for (let i = 0; i < 2; i++) {
          P.hand[i].lerp(_v.set(SIDE[i] * 0.2, -0.56, 0.3), wr);
          P.pole[i].lerp(_v.set(SIDE[i] * 0.4, -0.8, 0.2).normalize(), wr);
        }
      }
      // Getting up from the snow: deeper, chest over the skis, hands down beside the boots pushing off,
      // poles pointing back. Released into the hands-on-knees crouch as the get-up blend completes.
      const wpush = this.ragdollOn ? 1 : 1 - ramp(GETUP_TIME * 0.35, GETUP_TIME * 0.95, this.recoverClock);
      if (wpush > 0) {
        crouch += (1.5 - crouch) * wpush;
        P.s.spinePitch += 0.3 * wpush;
        P.s.neckPitch -= 0.25 * wpush;
        for (let i = 0; i < 2; i++) {
          P.hand[i].lerp(_v.set(SIDE[i] * 0.3, -0.66, 0.42), wpush);
          P.pole[i].lerp(_v.set(SIDE[i] * 0.35, -0.45, -0.82).normalize(), wpush);
        }
      }
    }

    P.s.crouch = crouch;
    P.s.pelvisPitch = 0.06 + crouch * 0.18;
    P.s.spinePitch += 0.04 + crouch * 0.3;
    // Skis on the snow: centred on the physics ski points, tilted on edge around the inside edge.
    const roll = -P.s.lean;
    for (let i = 0; i < 2; i++) {
      P.ski[i].set(SIDE[i] * RIG.stance, Math.sin(Math.abs(roll)) * 0.05, 0);
      P.skiRot[i].set(0, 0, roll);
    }
  }

  private buildAir(P: Pose, p: SkierPoseInput): void {
    this.neutral(P);
    const t = p.time;
    let crouch = 0.32;
    let tuck = 0.22;
    P.s.spinePitch = 0.16;

    // Balance arms: out to the sides, gently moving.
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      P.hand[i].set(sd * 0.5, -0.1 + wobble(t * 1.3, i) * 0.06, 0.16 + wobble(t * 1.1, i + 3) * 0.05);
      P.pole[i].set(sd * 0.3, -0.55, -0.78).normalize();
    }

    // Take-off: legs extend explosively, arms swing up and forward.
    const fromRail = p.previousState === 'RAIL_GRINDING';
    const tw = p.state === 'AIRBORNE' ? (1 - ramp(0.05, 0.32, p.timeInState)) * (fromRail ? 0.5 : 1) : 0;
    if (tw > 0) {
      crouch += (0.04 - crouch) * tw;
      tuck *= 1 - tw;
      for (let i = 0; i < 2; i++) P.hand[i].lerp(_v.set(SIDE[i] * 0.3, 0.02, 0.34), tw);
    }

    // Spin: upper body leads into the rotation, head looks over the leading shoulder, arms in tight.
    const ws = this.wSpin;
    if (ws > 0.001) {
      const sg = this.spinSign;
      P.s.spineYaw += sg * 0.62 * ws;
      P.s.neckYaw += sg * 0.7 * ws;
      P.s.neckPitch += 0.12 * ws;
      P.s.pelvisYaw -= sg * 0.1 * ws;
      P.s.spineRoll -= sg * 0.08 * ws;
      tuck += 0.22 * ws;
      for (let i = 0; i < 2; i++) {
        const lead = SIDE[i] === sg ? 1 : 0;
        // Leading arm sweeps across and back, trailing arm wraps across the chest.
        P.hand[i].lerp(lead ? _v.set(SIDE[i] * 0.42, -0.06, -0.2) : _v.set(-SIDE[i] * 0.06, -0.1, 0.32), ws);
      }
    }

    // Flip / off-axis: tuck the knees to the chest, hands to the shins; backflips spot the landing.
    const wf = this.wFlip;
    if (wf > 0.001) {
      tuck += (0.88 - tuck) * wf;
      const front = this.flipSign > 0 ? 1 : 0;
      P.s.spinePitch += (0.45 + front * 0.2) * wf;
      P.s.neckPitch += (front ? 0.45 : -0.35) * wf;
      const roll = Math.abs(p.localRoll) > 0.8 ? this.rollSign : 0;
      P.s.spineRoll += roll * 0.25 * wf;
      P.s.neckYaw += roll * 0.3 * wf;
      for (let i = 0; i < 2; i++) P.hand[i].lerp(_v.set(SIDE[i] * 0.15, -0.5, 0.32), wf);
    }

    // Landing preparation: open up from any tuck, legs reach for the snow, arms forward, eyes down.
    const wp = this.wPrep;
    if (wp > 0.001) {
      tuck *= 1 - wp;
      crouch += (0.28 - crouch) * wp;
      P.s.neckPitch += 0.25 * wp;
      P.s.spineYaw *= 1 - wp * 0.6;
      for (let i = 0; i < 2; i++) P.hand[i].lerp(_v.set(SIDE[i] * 0.35, -0.3, 0.32), wp);
    }

    // Grab shaping (spine / head / free hand / non-grabbed ski); hands and grabbed skis are solved in
    // `apply` from the style so they meet at the real grab point.
    const g = this.lastGrab;
    const wg = this.wGrab * (1 - wp * 0.5);
    let style: GrabStyle | null = null;
    if (g && wg > 0.001) {
      style = grabStyleFor(g);
      tuck += ((style.tuck ?? g.tuck) - tuck) * wg;
      P.s.spinePitch += style.spinePitch * wg;
      P.s.spineYaw += style.spineYaw * wg;
      P.s.spineRoll += style.spineRoll * wg;
      P.s.neckPitch += style.neckPitch * wg;
      P.s.neckYaw += style.neckYaw * wg;
      for (let i = 0; i < 2; i++) {
        const grabbing = usesHand(g, i);
        if (!grabbing) P.hand[i].lerp(_v.fromArray(style.freeHand[i]), wg);
        P.pole[i].lerp(_v.set(SIDE[i] * 0.35, -0.45, -0.82).normalize(), wg);
      }
    }

    P.s.crouch = crouch;
    P.s.pelvisPitch = 0.08 + tuck * 0.25;
    P.s.spinePitch += tuck * 0.3;
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      // Knees up towards the chest; skis stay together under the body.
      P.ski[i].set(sd * 0.12, tuck * 0.36, tuck * 0.12);
      P.skiRot[i].set(tuck * 0.12, 0, 0);
      if (style && wg > 0.001) {
        const grabbed = usesSki(g!, i);
        P.skiRot[i].lerp(_v.set(style.ski[i].pitch, style.ski[i].yaw, style.ski[i].roll), wg);
        if (!grabbed) P.ski[i].add(_v.fromArray(style.footOffset[i]).multiplyScalar(wg));
      }
    }
  }

  private buildRail(P: Pose, p: SkierPoseInput): void {
    this.neutral(P);
    const t = p.time;
    const bal = Math.max(-1.2, Math.min(1.2, p.railBalance));
    const press = p.railPress === 'nose' ? 1 : p.railPress === 'tail' ? -1 : 0;
    P.s.crouch = 0.42 + Math.abs(press) * 0.12 + wobble(t * 3, 5) * 0.02;
    // Balance: the body tips towards the fall side, upper body and arms counter it.
    P.s.lean = bal * 0.3;
    P.s.spineRoll = -bal * 0.55;
    P.s.neckRoll = -bal * 0.25;
    P.s.bodyPitch = press * 0.2;
    P.s.spinePitch = 0.35 + press * 0.3;
    P.s.pelvisZ = press * 0.06;
    // Look along the rail (slides: head and chest turn towards the travel direction).
    const yaw = p.railStanceYaw;
    const look = Math.abs(yaw) > 2.5 ? 0.95 * (yaw > 0 ? 1 : -1) : Math.max(-1, Math.min(1, -yaw * 0.6));
    P.s.neckYaw = look;
    P.s.spineYaw = Math.abs(yaw) > 2.5 ? look * 0.25 : -yaw * 0.25;
    P.s.pelvisPitch = 0.15 + P.s.crouch * 0.2;
    P.s.spinePitch += 0.12 + P.s.crouch * 0.35;
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      const high = -sd * bal; // > 0 for the arm on the high side
      P.hand[i].set(sd * 0.58, -0.02 + high * 0.18 + wobble(t * 2.3, i + 7) * 0.04, 0.06 - high * 0.05);
      P.pole[i].set(sd * 0.45, -0.55, -0.7).normalize();
      const stance = p.railStance === 'slide' ? RIG.stance : 0.1;
      P.ski[i].set(sd * stance, 0, 0);
      P.skiRot[i].set(0, 0, -P.s.lean * 0.5);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Rig solve

  private apply(m: SkierModel, P: Pose, groundExact: number): void {
    const s = P.s;
    this.grabError = 0;
    this.footError = 0;

    // Body layer: brake yaw, rail press pitch, ground-gap offset. Never a root rotation.
    m.body.position.set(0, -this.legExtend, 0);
    _e.set(s.bodyPitch, s.bodyYaw, 0, 'YXZ');
    m.body.quaternion.setFromEuler(_e);
    // Rest bones the layers never pose (the ragdoll and the get-up blend write them).
    for (let i = 0; i < 2; i++) {
      m.hips[i].quaternion.identity();
      m.skis[i].quaternion.identity();
    }

    // Pelvis: height from crouch, pivoting about the feet for the visual lean (edge angle).
    const crouch = Math.max(-0.1, Math.min(1.5, s.crouch));
    const H = RIG.ankle + LEG * (0.985 - crouch * 0.36);
    const lean = s.lean;
    m.pelvis.position.set(
      H * Math.sin(lean) + s.pelvisX,
      H * Math.cos(lean),
      -0.04 - crouch * 0.09 + s.pelvisZ,
    );
    _e.set(s.pelvisPitch, s.pelvisYaw, s.pelvisRoll - lean * 0.7, 'YXZ');
    m.pelvis.quaternion.setFromEuler(_e);
    _e.set(s.spinePitch * 0.55, s.spineYaw * 0.5, s.spineRoll * 0.5 + lean * 0.12, 'YXZ');
    m.spine.quaternion.setFromEuler(_e);
    _e.set(s.spinePitch * 0.45, s.spineYaw * 0.5, s.spineRoll * 0.5 + lean * 0.12, 'YXZ');
    m.chest.quaternion.setFromEuler(_e);
    // Head stabilisation: the neck cancels most of the torso pitch so the eyes stay on the horizon.
    const torsoPitch = s.pelvisPitch + s.spinePitch;
    const neckPitch = s.neckPitch - torsoPitch * 0.8;
    _e.set(neckPitch * 0.55, s.neckYaw * 0.5, s.neckRoll * 0.5, 'YXZ');
    m.neck.quaternion.setFromEuler(_e);
    _e.set(neckPitch * 0.45, s.neckYaw * 0.5, s.neckRoll * 0.5, 'YXZ');
    m.head.quaternion.setFromEuler(_e);
    m.root.updateMatrixWorld(true);

    m.body.getWorldQuaternion(_bodyQ);
    _bodyInv.copy(m.body.matrixWorld).invert();

    // --- Skis (body space): from the pose, or solved from the grabbing hand -------------------------
    const g = this.lastGrab;
    const wg = this.wGrab * this.wAir;
    const style = g && wg > 0.001 ? grabStyleFor(g) : null;
    _skiPos[0].copy(P.ski[0]);
    _skiPos[1].copy(P.ski[1]);
    if (style && g) {
      for (let k = 0; k < g.targets.length; k++) {
        const tg = g.targets[k];
        const si = tg.ski === 'left' ? 0 : 1;
        const hi = tg.hand === 'left' ? 0 : 1;
        const home = style.hands[Math.min(k, style.hands.length - 1)];
        // Hand home (body space); the ski is placed so its grab point lands in the hand. Alternate
        // arm-reach and leg-reach clamps so both chains can actually get there.
        _v.fromArray(home);
        m.upperArms[hi].getWorldPosition(_shoulder).applyMatrix4(_bodyInv);
        m.thighs[si].getWorldPosition(_hip).applyMatrix4(_bodyInv);
        skiQuat(P.skiRot[si], _q);
        _v2.set(SIDE[si] * tg.edge * 0.055, GRAB_HEIGHT, tg.along * RIG.skiLength * 0.45).applyQuaternion(_q);
        _knee.set(0, -RIG.skiOffsetY, -RIG.skiOffsetZ).applyQuaternion(_q);
        for (let iter = 0; iter < 4; iter++) {
          const armMax = ARM * 0.96 + PALM;
          _v3.subVectors(_v, _shoulder);
          if (_v3.length() > armMax) _v.copy(_shoulder).addScaledVector(_v3.normalize(), armMax);
          // ankle = hand - grabOffset + ankleOffset
          _ankle.copy(_v).sub(_v2).add(_knee);
          const dLeg = _ankle.distanceTo(_hip);
          const excess = dLeg - LEG * 0.95;
          const tooClose = LEG * 0.34 - dLeg;
          if (excess <= 0 && tooClose <= 0) break;
          _v.addScaledVector(_v3.subVectors(_hip, _ankle).normalize(), excess > 0 ? excess : -tooClose);
        }
        _v3.copy(_v).sub(_v2);
        _skiPos[si].lerp(_v3, wg);
      }
    }

    // --- Legs ---------------------------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      // Ankle = ski origin + R * (offset of the ankle above the ski bone).
      skiQuat(P.skiRot[i], _q);
      _ankle.set(0, -RIG.skiOffsetY, -RIG.skiOffsetZ).applyQuaternion(_q).add(_skiPos[i]);
      // Reach limit: airborne, pull the ski towards the hip; on the snow, lower the pelvis instead.
      m.thighs[i].getWorldPosition(_hip).applyMatrix4(_bodyInv);
      const d = _hip.distanceTo(_ankle);
      const maxReach = LEG * 0.985;
      if (d > maxReach) {
        if (groundExact) {
          m.pelvis.position.addScaledVector(_v.subVectors(_ankle, _hip).normalize(), d - maxReach);
          m.pelvis.updateMatrixWorld(true);
        } else {
          const pull = _v
            .subVectors(_hip, _ankle)
            .normalize()
            .multiplyScalar(d - maxReach);
          _ankle.add(pull);
        }
      }
      _target.copy(_ankle).applyMatrix4(m.body.matrixWorld);
      // Knees point along the ski (plus a little outwards); fall back to "up" when the leg is kicked
      // forward along the pole axis.
      _poleW
        .set(Math.sin(P.skiRot[i].y) + SIDE[i] * 0.12, 0.05, Math.cos(P.skiRot[i].y))
        .applyQuaternion(_bodyQ);
      _fallbackW.set(0, 1, 0.2).applyQuaternion(_bodyQ);
      solveTwoBoneIK(m.thighs[i], m.shins[i], RIG.thigh, RIG.shin, _target, _poleW, {
        minReach: 0.3,
        fallbackPole: _fallbackW,
      });
      // Foot / ski orientation from the pose (body space).
      _q2.copy(_bodyQ).multiply(_q);
      m.shins[i].getWorldQuaternion(_q);
      m.feet[i].quaternion.copy(_q.invert().multiply(_q2));
      m.feet[i].updateMatrixWorld(true);
      m.feet[i].getWorldPosition(_v);
      this.footError = Math.max(this.footError, _v.distanceTo(_target));
    }

    // --- Arms ---------------------------------------------------------------------------------------
    m.chest.updateMatrixWorld(true);
    m.chest.getWorldQuaternion(_chestQ);
    for (let i = 0; i < 2; i++) {
      const sd = SIDE[i];
      // Target in world space.
      _target.copy(P.hand[i]).applyMatrix4(m.chest.matrixWorld);
      let grabbing = false;
      if (g && wg > 0.001) {
        for (const tg of g.targets) {
          if ((tg.hand === 'left') !== (i === 0)) continue;
          const si = tg.ski === 'left' ? 0 : 1;
          _grab.set(SIDE[si] * tg.edge * 0.055, GRAB_HEIGHT, tg.along * RIG.skiLength * 0.45);
          m.skis[si].localToWorld(_grab);
          // The wrist sits a palm-length back from the grab point, towards the shoulder.
          m.upperArms[i].getWorldPosition(_shoulder);
          _wrist.subVectors(_shoulder, _grab).normalize().multiplyScalar(PALM).add(_grab);
          _target.lerp(_wrist, wg);
          grabbing = true;
        }
      }
      // Clavicle: shrug / reach towards far targets.
      _v.copy(_target).applyMatrix4(_m.copy(m.chest.matrixWorld).invert());
      _v.x -= sd * RIG.shoulderHalfWidth;
      _v.y -= 0.14;
      const reach = _v.length() / (ARM + PALM);
      const amt = Math.min(0.4, Math.max(0, (reach - 0.7) * 1.3));
      const len = _v.length() || 1;
      _e.set(0, -sd * amt * (_v.z / len) * 0.8, sd * amt * (_v.y / len) * 0.7, 'YXZ');
      m.shoulders[i].quaternion.setFromEuler(_e);
      m.shoulders[i].updateMatrixWorld(true);
      // Elbows out, back and down; fall back to "down" when the hand reaches out sideways.
      _poleW.set(sd * 0.9, -0.35, -0.6).applyQuaternion(_chestQ);
      _fallbackW.set(sd * 0.2, -1, -0.3).applyQuaternion(_chestQ);
      solveTwoBoneIK(m.upperArms[i], m.forearms[i], RIG.upperArm, RIG.forearm, _target, _poleW, {
        minReach: 0.18,
        fallbackPole: _fallbackW,
      });
      m.hands[i].getWorldPosition(_v);
      if (grabbing) {
        this.grabError = Math.max(this.grabError, _v.distanceTo(_target) * (wg >= 0.999 ? 1 : 0));
        // Palm towards the grab point.
        _v2.subVectors(_grab, _v);
        if (_v2.lengthSq() < 1e-8) _v2.set(0, -1, 0);
        aimDownAxis(m.hands[i], _v2.normalize(), _v3.set(0, 0, 1).applyQuaternion(_bodyQ));
      } else {
        // Wrist: continue the forearm with a slight bend towards the pole.
        m.forearms[i].getWorldQuaternion(_q);
        _v2.set(0, -1, 0).applyQuaternion(_q);
        _v3.copy(P.pole[i]).normalize().applyQuaternion(_bodyQ);
        _v2.multiplyScalar(0.75).addScaledVector(_v3, 0.25).normalize();
        aimDownAxis(m.hands[i], _v2, _v3.set(0, 0, 1).applyQuaternion(_chestQ));
      }

      // Pole: direction from the pose; on the snow the tip never goes below the surface.
      _v2.copy(P.pole[i]);
      if (_v2.lengthSq() < 1e-6) _v2.set(0, -1, 0);
      _v2.normalize();
      if (groundExact) {
        m.poles[i].getWorldPosition(_v3).applyMatrix4(_bodyInv);
        const minDy = -Math.max(0.05, _v3.y - 0.03) / RIG.poleLength;
        if (_v2.y < minDy) {
          const hz = Math.hypot(_v2.x, _v2.z) || 1;
          const nh = Math.sqrt(Math.max(0, 1 - minDy * minDy));
          _v2.set((_v2.x / hz) * nh, minDy, (_v2.z / hz) * nh);
        }
      }
      _v2.applyQuaternion(_bodyQ);
      aimDownAxis(m.poles[i], _v2, _v3.set(0, 0, 1).applyQuaternion(_bodyQ).add(_up));
    }
    m.root.updateMatrixWorld(true);
  }
}
