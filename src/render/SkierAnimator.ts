import { Quaternion, Vector3 } from 'three';
import { dampFactor, lerp } from '../core/math';
import type { PlayerState } from '../player/PlayerState';
import type { RailPress, RailStance } from '../rails/RailSystem';
import type { GrabDefinition } from '../tricks/grabs';
import { solveTwoBoneIK } from './IK';
import { RIG, type SkierModel } from './SkierModel';

/** Everything the animator needs to know about the simulation this frame. */
export interface SkierPoseInput {
  state: PlayerState;
  edgeAngle: number;
  brake: number;
  speed: number;
  tucking: boolean;
  charge: number;
  landingCompression: number;
  /** Vertical gap to the snow (legs extend to reach it). */
  groundGap: number;
  grab: GrabDefinition | null;
  grabBlend: number;
  railStance: RailStance | null;
  railBalance: number;
  railPress: RailPress;
  spinRate: number;
  time: number;
}

const _target = new Vector3();
const _pole = new Vector3();
const _hand = new Vector3();
const _grabPoint = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _bodyQ = new Quaternion();
const _tmp = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);
const _z = new Vector3(0, 0, 1);

/**
 * Procedural animation layer. Computes high-level pose parameters (crouch, lean, tuck, arm spread...)
 * from the simulation state, smooths them over time and drives the rig with two-bone IK for legs (feet
 * planted on the skis) and arms (pole plants, balance, grabs reaching the actual ski).
 */
export class SkierAnimator {
  private crouch = 0.35;
  private lean = 0;
  private brakeYaw = 0;
  private tuck = 0;
  private armSpread = 0;
  private balance = 0;
  private press = 0;
  private tweak = 0;
  private crash = 0;
  private legExtend = 0;
  private polePlant = 0;
  private lastGrab: GrabDefinition | null = null;

  update(m: SkierModel, p: SkierPoseInput, dt: number): void {
    const airborne = p.state === 'AIRBORNE';
    const rail = p.state === 'RAIL_GRINDING';
    const crashed = p.state === 'CRASHED';
    const k = dampFactor(10, dt);
    const kFast = dampFactor(18, dt);

    // --- Pose targets ---------------------------------------------------------------------------
    let crouchT = 0.32 + Math.min(0.15, p.speed / 120);
    if (p.tucking) crouchT = 0.72;
    if (p.state === 'JUMP_CHARGING') crouchT = 0.45 + p.charge * 0.45;
    if (p.state === 'BRAKING') crouchT = 0.5;
    if (p.state === 'CARVING') crouchT += Math.abs(p.edgeAngle) * 0.25;
    crouchT += p.landingCompression * 0.55;
    if (airborne) crouchT = 0.3;
    if (rail) crouchT = 0.42;
    if (crashed) crouchT = 0.6;
    this.crouch = lerp(this.crouch, Math.min(1, crouchT), airborne || p.landingCompression > 0.2 ? kFast : k);

    const leanT = airborne || rail || crashed ? 0 : -p.edgeAngle * 0.9;
    this.lean = lerp(this.lean, leanT, kFast);
    const brakeT = p.state === 'BRAKING' ? p.brake : 0;
    this.brakeYaw = lerp(this.brakeYaw, brakeT * 1.15, dampFactor(6, dt));

    const grab = p.grab ?? this.lastGrab;
    if (p.grab) this.lastGrab = p.grab;
    const grabTuck = grab ? grab.tuck * p.grabBlend : 0;
    const tuckT = airborne ? Math.max(0.25 + Math.min(0.35, Math.abs(p.spinRate) * 0.03), grabTuck) : 0;
    this.tuck = lerp(this.tuck, tuckT, kFast);
    this.tweak = lerp(this.tweak, grab && p.grabBlend > 0 ? (grab.tweak * Math.PI) / 180 : 0, k);
    this.armSpread = lerp(this.armSpread, airborne ? 1 : rail ? 0.85 : 0, k);
    this.balance = lerp(this.balance, rail ? p.railBalance : 0, kFast);
    this.press = lerp(
      this.press,
      rail ? (p.railPress === 'nose' ? 1 : p.railPress === 'tail' ? -1 : 0) : 0,
      k,
    );
    this.crash = lerp(this.crash, crashed ? 1 : 0, k);
    this.legExtend = lerp(this.legExtend, airborne || rail ? 0 : Math.min(0.25, p.groundGap), kFast);
    this.polePlant = p.state === 'CARVING' || p.state === 'RIDING' ? 0.5 + 0.5 * Math.sin(p.time * 3) : 0;

    // --- Body layer -----------------------------------------------------------------------------
    m.body.position.set(0, -this.legExtend, 0);
    _bodyQ.setFromAxisAngle(_y, this.brakeYaw);
    _q.setFromAxisAngle(_z, this.lean + this.balance * 0.35);
    _bodyQ.multiply(_q);
    _q.setFromAxisAngle(_x, this.press * 0.22);
    _bodyQ.multiply(_q);
    m.body.quaternion.copy(_bodyQ);

    // Pelvis height from crouch; hips sit back as the skier crouches.
    const legLen = RIG.thigh + RIG.shin;
    const pelvisY = RIG.ankle + legLen * (0.985 - this.crouch * 0.33) - this.tuck * 0.05;
    m.pelvis.position.set(0, pelvisY, -0.06 - this.crouch * 0.1);
    // Angulation: upper body stays more upright than the legs in a carve.
    m.pelvis.rotation.set(0, -this.brakeYaw * 0.35, -this.lean * 0.25);
    const spinePitch = 0.18 + this.crouch * 0.55 + this.tuck * 0.35 - this.press * 0.1;
    m.spine.rotation.set(spinePitch, 0, -this.lean * 0.3 + Math.sin(p.time * 1.3) * 0.015);
    m.neck.rotation.set(-spinePitch * 0.75, this.brakeYaw * -0.4, this.lean * 0.4);

    // --- Legs -----------------------------------------------------------------------------------
    m.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // Feet planted on the skis; in the air the knees pull up towards the chest (tuck / grab).
      const crashSplay = this.crash * side * 0.18;
      _target.set(side * RIG.stance + crashSplay, RIG.ankle + this.tuck * 0.42, this.tuck * 0.12);
      m.body.localToWorld(_target);
      _pole.set(0, 0, 1).applyQuaternion(m.body.getWorldQuaternion(_q));
      solveTwoBoneIK(m.thighs[i], m.shins[i], RIG.thigh, RIG.shin, _target, _pole);
      // Foot (and ski) orientation: aligned with the body layer, plus grab tweaks.
      m.body.getWorldQuaternion(_q);
      const tweakYaw = side * this.tweak * 0.35;
      const tweakRoll = side * this.tweak * 0.4;
      _q2.setFromAxisAngle(_y, tweakYaw);
      _q.multiply(_q2);
      _q2.setFromAxisAngle(_z, -tweakRoll);
      _q.multiply(_q2);
      m.shins[i].getWorldQuaternion(_q2);
      m.feet[i].quaternion.copy(_q2.invert().multiply(_q));
      m.feet[i].updateMatrixWorld(true);
    }

    // --- Arms -----------------------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // Riding: hands forward, poles ready; air/rail: arms out for balance; crash: flailing.
      const plant = i === 0 ? this.polePlant : 1 - this.polePlant;
      const ride = _hand.set(side * 0.3, pelvisY + 0.08 - this.crouch * 0.12, 0.34 + plant * 0.05);
      const spreadPos = _tmp.set(side * 0.62, pelvisY + 0.38, 0.05 + Math.sin(p.time * 2 + i) * 0.04);
      ride.lerp(spreadPos, this.armSpread);
      if (this.crash > 0.01) {
        const flail = _tmp.set(
          side * (0.5 + Math.sin(p.time * 9 + i) * 0.2),
          pelvisY + 0.5 + Math.cos(p.time * 7 + i * 2) * 0.25,
          Math.sin(p.time * 8) * 0.3,
        );
        ride.lerp(flail, this.crash);
      }
      m.body.localToWorld(ride);
      // Grab target: the actual point on the ski.
      if (grab && p.grabBlend > 0) {
        for (const t of grab.targets) {
          if ((t.hand === 'left') !== (i === 0)) continue;
          const skiIdx = t.ski === 'left' ? 0 : 1;
          const skiSide = skiIdx === 0 ? 1 : -1;
          _grabPoint.set(skiSide * t.edge * 0.055, 0.05, t.along * RIG.skiLength * 0.45);
          m.skis[skiIdx].localToWorld(_grabPoint);
          ride.lerp(_grabPoint, p.grabBlend);
        }
      }
      // Elbows point outwards and back.
      m.body.getWorldQuaternion(_q);
      _pole.set(side * 0.8, -0.2, -1).applyQuaternion(_q);
      solveTwoBoneIK(m.upperArms[i], m.forearms[i], RIG.upperArm, RIG.forearm, ride, _pole);
      // Hands keep a natural orientation relative to the forearm; poles angle back and down.
      m.hands[i].quaternion.identity();
      const poleBack = this.armSpread > 0.5 ? 1.25 : 0.55 + plant * 0.25;
      m.hands[i].updateMatrixWorld(true);
      m.hands[i].getWorldQuaternion(_q2);
      _tmp
        .set(side * 0.08, -1, -poleBack)
        .normalize()
        .applyQuaternion(_q);
      _q.setFromUnitVectors(_y.clone().negate(), _tmp);
      m.poles[i].quaternion.copy(_q2.invert().multiply(_q));
    }
    m.root.updateMatrixWorld(true);
  }
}
