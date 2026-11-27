import { Quaternion, Vector3 } from 'three';
import type { FallKind, GameplayConfig } from '../config/physicsConfig';
import type { EventBus } from '../core/EventBus';
import { RAD2DEG, clamp, isFiniteQuaternion, isFiniteVector, quaternionFromForwardUp } from '../core/math';
import type { ControlInput } from '../input/actions';
import { evaluateLanding, type LandingResult } from '../landing/LandingEvaluator';
import { FENCE_INSET, type Park } from '../park/Park';
import { createSurfaceSample } from '../park/SurfaceField';
import type { SurfaceType } from '../park/SurfaceFeatures';
import {
  applyAirPosture,
  applyLandingAssist,
  createImpactPrediction,
  predictImpact,
  stepAir,
  type AirControl,
} from '../physics/AirPhysics';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { SEG, type RagdollView } from '../physics/Ragdoll';
import { BODY } from './bodyDimensions';
import { applyPop, stepGround, type GroundControl } from '../physics/SkiPhysics';
import { RailSystem, formatRailTrickName, railSignature, type RailTrick } from '../rails/RailSystem';
import { scoreAirTrick, scoreRailTrick, type ScoringSystem } from '../scoring/ScoringSystem';
import type { SimEvents } from '../sim/events';
import { GrabSystem, type GrabButton } from '../tricks/GrabSystem';
import { RotationTracker } from '../tricks/RotationTracker';
import { recognizeAirTrick, type AirTrick } from '../tricks/TrickRecognition';
import { SkierBody } from './SkierBody';
import { PlayerStateMachine, type PlayerState } from './PlayerState';

export interface TakeoffInfo {
  surface: SurfaceType;
  featureId: string | null;
  fromRail: boolean;
  speed: number;
  position: Vector3;
}

/** Cause of a crash fall: which way the skier loses balance. */
export interface CrashFall {
  kind: FallKind;
  /** Side falls: +1 = towards the skier's left (+X), -1 = right. */
  side: 1 | -1;
  /** Scale of the loss-of-balance trip (default 1). */
  tripScale?: number;
  /** Start the ragdoll from the pre-step position (the crash was detected by an overlap this step). */
  rewind?: boolean;
}

const _sample = createSurfaceSample();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _crashRoot = new Vector3();
const _crashTrip = new Vector3();
const _fallUp = new Vector3();
const _fallTravel = new Vector3();
const _fallLeft = new Vector3();
const _grabButtons = new Set<GrabButton>();

/**
 * Fall direction of a crash at touchdown, from how the body meets the snow: leaning back relative to the
 * travel direction (back-seated) falls backward, leaning forward / head first falls forward, a lateral
 * tilt or skis sideways to the travel falls to the side. A hard but upright impact sits the skier back.
 */
export function fallFromTouchdown(
  orientation: Quaternion,
  normal: Vector3,
  velocity: Vector3,
  tripScale = 1,
): CrashFall {
  const up = _fallUp.set(0, 1, 0).applyQuaternion(orientation);
  up.addScaledVector(normal, -up.dot(normal)); // tilt of the body in the slope plane
  const travel = _fallTravel.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
  const left = _fallLeft.set(1, 0, 0).applyQuaternion(orientation);
  left.addScaledVector(normal, -left.dot(normal));
  if (left.lengthSq() > 1e-9) left.normalize();
  if (travel.lengthSq() < 4) {
    travel.set(0, 0, 1).applyQuaternion(orientation);
    travel.addScaledVector(normal, -travel.dot(normal));
  }
  if (travel.lengthSq() > 1e-9) travel.normalize();
  const tilt = up.length();
  const pitch = up.dot(travel);
  const lateral = up.dot(left);
  if (tilt < 0.42) {
    // Nearly upright: skis sideways to the travel catch an edge (fall towards the travel), else sit back.
    const across = travel.dot(left);
    if (Math.abs(across) > 0.6) return { kind: 'side', side: across >= 0 ? 1 : -1, tripScale };
    return { kind: 'backward', side: 1, tripScale };
  }
  if (Math.abs(lateral) > Math.abs(pitch)) return { kind: 'side', side: lateral >= 0 ? 1 : -1, tripScale };
  return { kind: pitch > 0 ? 'forward' : 'backward', side: 1, tripScale };
}

/**
 * High level skier controller. Owns the state machine and dispatches each fixed step to the subsystem
 * that is valid for the current state (ground ski physics, air physics, rail grinding or crash tumble).
 * Input is interpreted contextually: A/D carve on the ground, spin in the air and balance on rails.
 */
export class PlayerController {
  readonly body = new SkierBody();
  readonly fsm = new PlayerStateMachine();
  readonly grabs = new GrabSystem();
  readonly rotation = new RotationTracker();
  readonly rails: RailSystem;
  readonly impact = createImpactPrediction();

  /** Jump charge 0..1 while JUMP_CHARGING. */
  charge = 0;
  /** Time since leaving the ground (late pop window). */
  private sinceTakeoff = 0;
  private popped = false;
  private chargeAtTakeoff = 0;
  /** A rail trick waiting for the landing after the rail exit. */
  private pendingRail: RailTrick | null = null;
  takeoff: TakeoffInfo | null = null;
  lastLanding: LandingResult | null = null;
  lastAirTrick: AirTrick | null = null;
  crashTimer = 0;
  crashReason = '';
  /** Fall direction of the current / last crash. */
  lastFall: { kind: FallKind; side: 1 | -1 } = { kind: 'forward', side: 1 };
  assistActive = false;
  switchStance = false;
  private previousFootY = 0;
  /** Time spent nearly stationary (stuck detection). */
  stillTime = 0;
  private landingAbsorb = 0;

  constructor(
    readonly park: Park,
    readonly physics: PhysicsWorld,
    readonly scoring: ScoringSystem,
    readonly events: EventBus<SimEvents>,
    readonly cfg: GameplayConfig,
  ) {
    this.rails = new RailSystem(park, cfg.rail, park.config.seed);
    this.fsm.onChange = (from, to) => this.events.emit('stateChanged', { from, to });
  }

  get state(): PlayerState {
    return this.fsm.state;
  }

  /** Landing compression 0..1 for animation. */
  get landingCompression(): number {
    return this.landingAbsorb;
  }

  reset(position?: Vector3, headingDeg = 0): void {
    const spawn = position ?? this.park.spawnPosition(new Vector3());
    this.park.surface.sample(spawn.x, spawn.z, _sample);
    spawn.y = _sample.height;
    const heading = _tmp.set(Math.sin(headingDeg / RAD2DEG), 0, Math.cos(headingDeg / RAD2DEG));
    this.body.reset(spawn, heading, _sample.normal);
    quaternionFromForwardUp(this.body.heading, _sample.normal, this.body.orientation);
    this.physics.endRagdoll();
    this.grabs.reset();
    this.rotation.end();
    this.rails.reset(this.park.config.seed);
    this.charge = 0;
    this.sinceTakeoff = 0;
    this.popped = false;
    this.pendingRail = null;
    this.takeoff = null;
    this.lastLanding = null;
    this.lastAirTrick = null;
    this.crashTimer = 0;
    this.crashReason = '';
    this.switchStance = false;
    this.previousFootY = spawn.y;
    this.stillTime = 0;
    this.landingAbsorb = 0;
    this.fsm.force('IDLE');
  }

  step(input: ControlInput, dt: number): void {
    this.fsm.update(dt);
    this.rails.tickCooldowns(dt);
    this.landingAbsorb = Math.max(0, this.landingAbsorb - dt / 0.45);
    const footYBefore = this.body.position.y;
    switch (this.fsm.state) {
      case 'AIRBORNE':
        this.stepAirborne(input, dt);
        break;
      case 'RAIL_GRINDING':
        this.stepGrinding(input, dt);
        break;
      case 'CRASHED':
        this.stepCrashed(dt);
        break;
      default:
        this.stepGroundState(input, dt);
    }
    this.previousFootY = footYBefore;
    this.validate();
  }

  // ---------------------------------------------------------------------------------------------
  // Ground
  // ---------------------------------------------------------------------------------------------

  private stepGroundState(input: ControlInput, dt: number): void {
    const jcfg = this.cfg.jump;
    const steer = input.axis('right', 'left');
    const state = this.fsm.state;

    if (state === 'LANDING' && this.fsm.timeInState >= this.cfg.landing.absorbTime) {
      this.fsm.transition('RIDING');
    }

    // Jump charging: press to start, release to pop.
    if (input.pressed.jump && this.fsm.state !== 'LANDING' && this.fsm.state !== 'JUMP_CHARGING') {
      if (this.fsm.transition('JUMP_CHARGING')) this.charge = 0;
    }
    const charging = this.fsm.state === 'JUMP_CHARGING';
    if (charging) this.charge = Math.min(1, this.charge + dt / jcfg.chargeTime);

    const control: GroundControl = {
      steer,
      // While charging, W/S pre-wind a flip instead of tucking/braking.
      brake: input.down.back && !charging ? 1 : 0,
      push: input.down.forward && !charging,
      steerFactor: charging ? jcfg.chargeSteerFactor : 1,
    };
    const result = stepGround(this.body, control, this.park.surface, this.cfg.physics, dt);

    const vAlong = this.body.velocity.dot(this.body.heading);
    if (Math.abs(vAlong) > 1) this.switchStance = vAlong < 0;

    // Released jump while grounded → pop.
    if (charging && !input.down.jump && !result.leftGround) {
      const pop = jcfg.popMin + (jcfg.popMax - jcfg.popMin) * this.charge;
      this.chargeAtTakeoff = this.charge;
      applyPop(this.body, pop);
      this.beginAir(input, pop, false);
      return;
    }

    if (result.leftGround) {
      // Holding jump through the lip pops automatically with the current charge.
      let pop = 0;
      if (charging) {
        pop = jcfg.popMin + (jcfg.popMax - jcfg.popMin) * this.charge;
        this.chargeAtTakeoff = this.charge;
        this.body.velocity.addScaledVector(this.body.groundNormal, pop);
      } else {
        this.chargeAtTakeoff = 0;
      }
      this.beginAir(input, pop, false);
      this.popped = charging;
      return;
    }

    // Rails reachable from the ground (riding up an on-ramp).
    if (this.tryRailLock()) return;
    if (this.checkObstacles()) return;

    // Ground sub-state.
    if (!charging && this.fsm.state !== 'LANDING') {
      const speed = this.body.speed;
      let next: PlayerState;
      if (input.down.back && speed > 0.3) next = 'BRAKING';
      else if (Math.abs(this.body.edgeAngle) > 0.22 && speed > 2) next = 'CARVING';
      else if (speed < 0.25 && steer === 0 && !input.down.forward) next = 'IDLE';
      else next = 'RIDING';
      this.fsm.transition(next);
    }

    this.stillTime = this.body.speed < 0.4 ? this.stillTime + dt : 0;
    const bonus = this.scoring.updateGround(dt);
    if (bonus > 0) this.emitComboEnded(bonus);
    this.checkBounds();
  }

  private comboSnapshot = { points: 0, multiplier: 1, tricks: 0 };

  private emitComboEnded(bonus: number): void {
    this.events.emit('comboEnded', {
      bonus,
      points: this.comboSnapshot.points,
      multiplier: this.comboSnapshot.multiplier,
      tricks: this.comboSnapshot.tricks,
    });
  }

  private captureComboSnapshot(): void {
    const c = this.scoring.combo;
    this.comboSnapshot.points = c.points;
    this.comboSnapshot.multiplier = c.multiplier;
    this.comboSnapshot.tricks = c.tricks;
  }

  // ---------------------------------------------------------------------------------------------
  // Air
  // ---------------------------------------------------------------------------------------------

  private beginAir(input: ControlInput, pop: number, fromRail: boolean): void {
    const b = this.body;
    const surfaceType = b.surfaceType;
    this.fsm.transition('AIRBORNE');
    this.sinceTakeoff = 0;
    this.popped = pop > 0;
    this.takeoff = {
      surface: fromRail ? 'snow' : surfaceType,
      featureId: fromRail ? null : b.featureId,
      fromRail,
      speed: b.speed,
      position: b.position.clone(),
    };
    this.rotation.begin(b.orientation, b.velocity, this.switchStance, b.position.y);
    this.grabs.reset();
    // Angular momentum at takeoff: part of the carving yaw plus the pre-wound rotation from held inputs.
    const jc = this.cfg.jump;
    const windup = 0.45 + 0.55 * this.chargeAtTakeoff;
    const spin = input.axis('right', 'left');
    const flip = input.axis('back', 'forward');
    const roll = input.axis('tweakRight', 'tweakLeft');
    const local = _tmp.set(
      flip * jc.windupFlip * windup,
      spin * jc.windupSpin * windup,
      roll * jc.windupRoll * windup,
    );
    local.applyQuaternion(b.orientation);
    b.angularVelocity.multiplyScalar(fromRail ? 0 : 0.5).add(local);
    this.chargeAtTakeoff = 0;
    this.charge = 0;
    this.scoring.keepAlive();
    this.events.emit('takeoff', {
      speed: b.speed,
      surface: surfaceType,
      featureId: b.featureId,
      pop,
      fromRail,
    });
  }

  private readonly airControl: AirControl = { spin: 0, flip: 0, roll: 0 };

  private stepAirborne(input: ControlInput, dt: number): void {
    const b = this.body;
    const air = this.cfg.air;
    this.sinceTakeoff += dt;
    this.scoring.keepAlive();

    // Late pop: releasing jump just after leaving the lip still pops.
    if (!this.popped && this.sinceTakeoff <= this.cfg.jump.lateWindow && input.released.jump) {
      const pop = this.cfg.jump.popMin + (this.cfg.jump.popMax - this.cfg.jump.popMin) * 0.6;
      b.velocity.addScaledVector(b.groundNormal, pop);
      this.popped = true;
    }

    const c = this.airControl;
    c.spin = input.axis('right', 'left');
    c.flip = input.axis('back', 'forward');
    c.roll = input.axis('tweakRight', 'tweakLeft');

    // Grabs. Angular momentum is conserved: tucking into a grab lowers inertia → faster rotation.
    _grabButtons.clear();
    if (input.down.grab1) _grabButtons.add('grab1');
    if (input.down.grab2) _grabButtons.add('grab2');
    if (input.down.grab3) _grabButtons.add('grab3');
    if (input.down.grab4) _grabButtons.add('grab4');
    const before = this.grabs.current;
    const ev = this.grabs.update(_grabButtons, dt, true);
    if (ev === 'started') b.angularVelocity.divideScalar(air.grabInertiaRatio);
    else if (ev === 'released') b.angularVelocity.multiplyScalar(air.grabInertiaRatio);
    if (ev === 'started' || ev === 'changed')
      this.events.emit('grabStart', { name: this.grabs.current!.name });
    if ((ev === 'released' || ev === 'changed') && before) this.events.emit('grabEnd', { name: before.name });

    predictImpact(b, this.park.surface, this.cfg.physics.gravity, this.impact, 2.5);
    this.assistActive = applyLandingAssist(b, this.impact, c, air, dt);
    if (!this.assistActive) {
      _tmp.set(0, 1, 0);
      if (this.impact.valid) _tmp.copy(this.impact.normal);
      applyAirPosture(b, _tmp, c, air.postureStrength, dt);
    }
    stepAir(b, c, this.cfg.physics, air, dt);
    this.rotation.update(b.angularVelocity, b.orientation, b.position.y, dt);

    if (this.tryRailLock()) return;
    if (this.checkObstacles()) return;

    this.park.surface.sample(b.position.x, b.position.z, _sample);
    if (b.position.y <= _sample.height) {
      this.land();
      return;
    }
    // Upper body or head hitting the snow before the skis (e.g. under-rotated flips).
    _tmp.set(0, 1, 0).applyQuaternion(b.orientation);
    for (const reach of [0.9, 1.6]) {
      _tmp2.copy(b.position).addScaledVector(_tmp, reach);
      if (_tmp.y < 0.3 && _tmp2.y < this.park.surface.height(_tmp2.x, _tmp2.z)) {
        const impact = Math.max(0, -b.velocity.y);
        this.events.emit('landed', {
          result: {
            quality: 'crash',
            uprightErrorDeg: 180,
            yawErrorDeg: 0,
            impactSpeed: impact,
            slopeSpeed: b.speed,
            angularSpeed: b.angularVelocity.length(),
            switchLanding: false,
            reason: 'Head first',
            stability: 0,
          },
          airTime: this.rotation.airTime,
        });
        this.park.surface.sample(b.position.x, b.position.z, _sample);
        this.crash(
          'Head first',
          impact,
          fallFromTouchdown(b.orientation, _sample.normal, b.velocity, this.cfg.crash.landingTripScale),
        );
        return;
      }
    }
    if (this.rotation.airTime > 14 || b.position.y < _sample.height - 5) this.respawnSafe();
  }

  private land(): void {
    const b = this.body;
    const grabbing = this.grabs.isSecured;
    this.grabs.releaseAll();
    this.park.surface.sample(b.position.x, b.position.z, _sample);
    b.position.y = _sample.height;
    const result = evaluateLanding(
      {
        orientation: b.orientation,
        velocity: b.velocity,
        angularVelocity: b.angularVelocity,
        surfaceNormal: _sample.normal,
        grabbing,
      },
      this.cfg.landing,
    );
    this.lastLanding = result;
    this.rotation.end();
    const airTime = this.rotation.airTime;
    this.events.emit('landed', { result, airTime });

    if (result.quality === 'crash') {
      this.pendingRail = null;
      this.crash(
        result.reason || 'Crash',
        result.impactSpeed,
        fallFromTouchdown(b.orientation, _sample.normal, b.velocity, this.cfg.crash.landingTripScale),
      );
      return;
    }

    // Absorb the impact: remove the velocity into the slope, keep the slope-parallel momentum.
    const vn = b.velocity.dot(_sample.normal);
    if (vn < 0) b.velocity.addScaledVector(_sample.normal, -vn);
    if (result.quality === 'sketchy') b.velocity.multiplyScalar(1 - this.cfg.landing.sketchySpeedLoss);
    // Skis take the body's facing projected on the slope (forward or switch).
    _tmp.set(0, 0, 1).applyQuaternion(b.orientation);
    _tmp.addScaledVector(_sample.normal, -_tmp.dot(_sample.normal));
    if (_tmp.lengthSq() < 1e-6)
      _tmp.copy(b.velocity).addScaledVector(_sample.normal, -b.velocity.dot(_sample.normal));
    if (_tmp.lengthSq() < 1e-6) _tmp.set(0, 0, 1);
    b.heading.copy(_tmp.normalize());
    b.groundNormal.copy(_sample.normal);
    quaternionFromForwardUp(b.heading, b.groundNormal, b.orientation);
    b.angularVelocity.set(0, 0, 0);
    b.grounded = true;
    b.normalForce = 0;
    b.edgeAngle = 0;
    this.switchStance = result.switchLanding;
    this.landingAbsorb = clamp(result.impactSpeed / 8, 0.25, 1);

    this.scoreLanding(result, airTime);
    this.fsm.transition('LANDING');
  }

  private scoreLanding(result: LandingResult, airTime: number): void {
    const quality = result.quality;
    const summary = {
      spin: this.rotation.spin,
      pitch: this.rotation.pitch,
      roll: this.rotation.roll,
      inversions: this.rotation.inversions,
      airTime,
      switchTakeoff: this.rotation.takeoffSwitch,
    };
    if (this.pendingRail) {
      const rail = this.pendingRail;
      this.pendingRail = null;
      const out = Math.round(Math.abs(this.rotation.spin * RAD2DEG) / 90) * 90;
      rail.outSpinDeg = out >= 180 || (out >= 90 && rail.stance === 'slide') ? out : 0;
      rail.signature = railSignature(rail);
      rail.name = formatRailTrickName(rail);
      const scored = this.scoring.addTrick(
        rail.name,
        rail.signature,
        scoreRailTrick(rail, this.scoring.cfg),
        quality,
        'rail',
      );
      this.captureComboSnapshot();
      this.events.emit('trickLanded', { scored, air: null, rail });
      return;
    }
    const trick = recognizeAirTrick(summary, this.grabs.completed);
    this.lastAirTrick = trick;
    const fromKicker = this.takeoff?.surface === 'kicker';
    const meaningful =
      trick.category !== 'straight' || trick.grabs.length > 0 || (fromKicker && airTime > 0.8);
    if (!meaningful) return;
    const scored = this.scoring.addTrick(
      trick.name,
      trick.signature,
      scoreAirTrick(trick, this.scoring.cfg),
      quality,
      'air',
    );
    this.captureComboSnapshot();
    this.events.emit('trickLanded', { scored, air: trick, rail: null });
  }

  // ---------------------------------------------------------------------------------------------
  // Rails
  // ---------------------------------------------------------------------------------------------

  private tryRailLock(): boolean {
    const candidate = this.rails.findLock(this.body, this.previousFootY);
    if (!candidate) return false;
    if (!this.fsm.transition('RAIL_GRINDING')) return false;
    // A pending rail trick from a previous rail (rail-to-rail transfer) is banked now.
    if (this.pendingRail) {
      const prev = this.pendingRail;
      this.pendingRail = null;
      const scored = this.scoring.addTrick(
        prev.name,
        prev.signature,
        scoreRailTrick(prev, this.scoring.cfg),
        'clean',
        'rail',
      );
      this.captureComboSnapshot();
      this.events.emit('trickLanded', { scored, air: null, rail: prev });
    }
    const entrySpin = this.rotation.active ? this.rotation.spin : 0;
    this.rotation.end();
    this.grabs.releaseAll();
    this.grabs.reset();
    const g = this.rails.begin(this.body, candidate, entrySpin);
    this.scoring.keepAlive();
    this.events.emit('railStart', {
      railId: g.rail.id,
      label: g.rail.config.label ?? g.rail.kind,
      stance: g.stance,
      kind: g.rail.kind,
    });
    return true;
  }

  private stepGrinding(input: ControlInput, dt: number): void {
    this.scoring.keepAlive();
    const result = this.rails.step(
      this.body,
      { balance: input.axis('right', 'left'), press: input.axis('back', 'forward') },
      this.cfg.physics.gravity,
      dt,
    );
    const rail = this.rails.grind?.rail;
    if (result === 'bail') {
      const railId = rail?.id ?? '';
      const g = this.rails.grind;
      // Fall off to the side the balance tipped towards.
      const fallSide: 1 | -1 = g && g.balance > 0 ? -1 : 1;
      if (g) {
        _tmp
          .set(1, 0, 0)
          .applyQuaternion(this.body.orientation)
          .multiplyScalar(fallSide * 2);
        this.body.velocity.add(_tmp);
      }
      this.rails.end();
      this.events.emit('railEnd', { railId, bailed: true });
      this.crash('Lost balance', 0, { kind: 'side', side: fallSide });
      return;
    }
    if (result === 'exit' || input.pressed.jump) {
      const railId = rail?.id ?? '';
      const trick = this.rails.end();
      this.pendingRail = trick;
      this.events.emit('railEnd', { railId, bailed: false });
      const pop = input.pressed.jump ? this.cfg.rail.popVelocity : 0.4;
      this.body.velocity.y += pop;
      // Lift slightly so the next step does not immediately re-touch the rail top.
      this.body.position.y += 0.02;
      this.chargeAtTakeoff = input.pressed.jump ? 0.6 : 0;
      this.beginAir(input, pop, true);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Crashes, bounds and safety
  // ---------------------------------------------------------------------------------------------

  private checkObstacles(): boolean {
    const hit = this.physics.checkObstacleHit(this.body.position, this.body.orientation);
    if (!hit) return false;
    if (this.body.speed < 2.5 && hit !== 'tree') return false;
    // The skis/body stop at the obstacle while the torso carries on. The overlap began during this step,
    // so the ragdoll starts from the pre-step position (no depenetration pop out of the obstacle).
    this.crash(hit === 'tree' ? 'Hit a tree' : 'Hit an obstacle', this.body.speed, {
      kind: 'forward',
      side: 1,
      rewind: true,
    });
    return true;
  }

  /** The crash ragdoll (read-only) while CRASHED, otherwise null. */
  get ragdoll(): RagdollView | null {
    return this.physics.ragdoll.active ? this.physics.ragdoll.view : null;
  }

  /**
   * Starts a crash: the skier becomes an articulated ragdoll that keeps its exact rigid motion
   * (v + ω × r per segment) plus a momentum-conserving loss-of-balance trip in the direction of `fall`.
   * Without `fall`, the skier falls forward.
   */
  crash(reason: string, impactSpeed: number, fall?: CrashFall): void {
    if (!this.fsm.transition('CRASHED')) return;
    this.crashReason = reason;
    this.crashTimer = 0;
    this.crashCalmTime = 0;
    this.crashCalmW = Infinity;
    this.crashSettledAt = -1;
    this.grabs.releaseAll();
    this.grabs.reset();
    this.rotation.end();
    this.pendingRail = null;
    this.scoring.breakCombo();
    const b = this.body;
    const c = this.cfg.crash;
    const kind: FallKind = fall?.kind ?? 'forward';
    const side = fall?.side ?? 1;
    this.lastFall = { kind, side };

    const root = _crashRoot.copy(b.position);
    if (fall?.rewind) root.addScaledVector(b.velocity, -this.cfg.fixedTimestep);
    // Trip direction (legs relative to the torso), tangent to the snow under the skier.
    this.park.surface.sample(root.x, root.z, _sample);
    const n = _sample.normal;
    const travel = _tmp.copy(b.velocity).addScaledVector(n, -b.velocity.dot(n));
    if (travel.lengthSq() < 1) {
      // Slow: the skis' facing defines "forward".
      travel.set(0, 0, 1).applyQuaternion(b.orientation);
      travel.addScaledVector(n, -travel.dot(n));
    }
    if (travel.lengthSq() < 1e-6) travel.copy(b.heading);
    travel.normalize();
    const dir = _crashTrip;
    if (kind === 'backward') dir.copy(travel);
    else if (kind === 'forward') dir.copy(travel).negate();
    else {
      // The skis slip out opposite to the side the body falls to.
      dir.set(1, 0, 0).applyQuaternion(b.orientation);
      dir.addScaledVector(n, -dir.dot(n));
      if (dir.lengthSq() < 1e-6) dir.crossVectors(n, travel);
      dir.normalize().multiplyScalar(-side);
    }
    // Landing crashes carry their own scale; otherwise the skis are on the snow (ground fall, rail bail,
    // obstacle).
    const scale = fall?.tripScale ?? c.groundTripScale[kind];
    this.physics.startRagdoll(c, this.cfg.physics.mass, {
      rootPosition: root,
      rootOrientation: b.orientation,
      velocity: b.velocity,
      angularVelocity: b.angularVelocity,
      tripDirection: dir,
      tripSpeed: c.tripSpeed[kind] * scale,
      dt: this.cfg.fixedTimestep,
    });
    this.syncBodyFromRagdoll();
    this.events.emit('crash', { reason, impactSpeed });
  }

  /**
   * Debug/test hook: makes the skier lose balance and fall from a ground state (there is no gameplay
   * trigger for ground falls yet). `side` (+1 = the skier's left, -1 = right) applies to side falls.
   * Returns false if the skier is not on the ground.
   */
  debugFall(kind: FallKind, side: 1 | -1 = 1): boolean {
    if (!this.fsm.onGround) return false;
    this.crash('Lost balance', 0, { kind, side });
    return this.fsm.state === 'CRASHED';
  }

  /** Time the ragdoll has been calm (below the settle thresholds), and when it settled (-1 = not yet). */
  private crashCalmTime = 0;
  /** Low-passed largest segment angular speed (ignores single-step contact flicker). */
  private crashCalmW = Infinity;
  private crashSettledAt = -1;

  /** True once the ragdoll has come to rest (the skier lies still before getting up). */
  get crashSettled(): boolean {
    return this.fsm.state === 'CRASHED' && this.crashSettledAt >= 0;
  }

  /**
   * While CRASHED the body mirrors the pelvis: the model root is pelvis × inverse(pelvis rest offset), and
   * velocity / angular velocity are the pelvis's, so camera, effects and audio keep working.
   */
  private syncBodyFromRagdoll(): void {
    const pelvis = this.physics.ragdoll.view.segments[SEG.pelvis];
    const b = this.body;
    b.orientation.copy(pelvis.quaternion);
    b.position.set(0, -BODY.pelvisHeight, 0).applyQuaternion(pelvis.quaternion).add(pelvis.position);
    b.velocity.copy(pelvis.velocity);
    b.angularVelocity.copy(pelvis.angularVelocity);
    b.grounded = false;
  }

  private stepCrashed(dt: number): void {
    this.crashTimer += dt;
    const c = this.cfg.crash;
    const ok = this.physics.stepRagdoll(dt);
    if (!ok) {
      this.recover();
      return;
    }
    this.syncBodyFromRagdoll();
    const ragdoll = this.physics.ragdoll;
    const pelvis = ragdoll.view.segments[SEG.pelvis];
    // Safety net: if the body ever slips through the snow mesh, recover immediately.
    if (
      pelvis.position.y <
      this.park.surface.height(pelvis.position.x, pelvis.position.z) - c.fallThroughDepth
    ) {
      this.recover();
      return;
    }
    // Settled: pelvis slow and every segment calm for a while, after a minimum crash time.
    const w = ragdoll.maxAngularSpeed();
    this.crashCalmW = Number.isFinite(this.crashCalmW)
      ? this.crashCalmW + (w - this.crashCalmW) * Math.min(1, dt / Math.max(dt, c.settleFilterTime))
      : w;
    const calm = pelvis.velocity.length() < c.settleSpeed && this.crashCalmW < c.settleAngularSpeed;
    this.crashCalmTime = calm ? this.crashCalmTime + dt : 0;
    if (this.crashSettledAt < 0 && this.crashTimer >= c.minCrashTime && this.crashCalmTime >= c.settleTime)
      this.crashSettledAt = this.crashTimer;
    const lieDone = this.crashSettledAt >= 0 && this.crashTimer - this.crashSettledAt >= c.lieTime;
    if (lieDone || this.crashTimer > c.maxTumbleTime || !isFiniteVector(this.body.position)) {
      this.recover();
    }
  }

  /** Stands the skier back up where the ragdoll's pelvis came to rest, facing down the fall line. */
  recover(): void {
    const b = this.body;
    const half = this.park.config.terrain.halfWidth;
    const rd = this.physics.ragdoll;
    const from = rd.active ? rd.view.segments[SEG.pelvis].position : b.position;
    const pos = _tmp2.copy(isFiniteVector(from) ? from : this.park.spawnPosition(new Vector3()));
    // Get up on the side of the safety net the body lies on (never moved across it): inside the corridor
    // just clear of the net, or off-piste (riding there is allowed) clear of the net and within the snow.
    const net = half - FENCE_INSET;
    const ax = Math.abs(pos.x);
    const sx = pos.x < 0 ? -1 : 1;
    if (ax < net) pos.x = sx * Math.min(ax, net - 0.7);
    else pos.x = sx * clamp(ax, net + 0.7, half + 25);
    // Avoid recovering on top of a feature or rail: step down the hill until clear.
    for (let i = 0; i < 40 && this.park.surface.featureOffset(pos.x, pos.z) > 0.05; i++) pos.z += 1.5;
    this.physics.endRagdoll();
    const yawDeg = 0;
    this.reset(pos.clone(), yawDeg);
    this.events.emit('recovered', {});
  }

  private respawnSafe(): void {
    if (this.fsm.state !== 'CRASHED') this.scoring.breakCombo();
    this.recover();
  }

  private checkBounds(): void {
    const b = this.body;
    const limit = this.park.config.terrain.halfWidth + 40;
    if (
      Math.abs(b.position.x) > limit ||
      b.position.z > this.park.terrain.zMax - 50 ||
      b.position.z < this.park.terrain.zMin + 20
    ) {
      this.respawnSafe();
    }
  }

  /** Numerical safeguards: never let NaNs or runaway values survive a step. */
  private validate(): void {
    const b = this.body;
    if (
      !isFiniteVector(b.position) ||
      !isFiniteVector(b.velocity) ||
      !isFiniteQuaternion(b.orientation) ||
      !isFiniteVector(b.angularVelocity)
    ) {
      this.physics.endRagdoll();
      this.reset();
      return;
    }
    if (b.angularVelocity.lengthSq() > 30 * 30) b.angularVelocity.setLength(30);
    if (!isFiniteVector(b.heading) || b.heading.lengthSq() < 0.5)
      b.heading.set(0, 0, 1).applyQuaternion(b.orientation);
  }

  /** Signed balance on a rail (-1..1) or 0. */
  get railBalance(): number {
    return this.rails.grind?.balance ?? 0;
  }
}
