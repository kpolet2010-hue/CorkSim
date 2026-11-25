import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type {
  CrashConfig,
  RagdollJointRange,
  RagdollRotation,
  RagdollSegmentKind,
} from '../config/physicsConfig';
import { quaternionToRotationVector } from '../core/math';
import { createSurfaceSample, type SurfaceField } from '../park/SurfaceField';
import { BODY } from '../player/bodyDimensions';

/**
 * Articulated crash ragdoll: 11 Rapier rigid bodies (pelvis, chest, head, upper arms, forearms, thighs,
 * shins with rigid boot + ski) joined by revolute knees/elbows (Rapier limits) and ball joints (hips,
 * shoulders, waist, neck). Ball-joint limits are per-axis Rapier solver limits (`setBallLimits`; our own
 * swing-ellipse + twist soft limit is the configurable fallback). Muscle tone towards a protective pose
 * (decaying as the body goes limp) and joint damping are applied here as equal and opposite torque impulse
 * pairs before each world step (plain arithmetic, deterministic). Snow ploughing and rolling resistance
 * come from the analytic snow surface. Skier parts never collide with each other.
 *
 * Every segment's local frame is the rest frame of the bone(s) it drives (identity rotation in the rest
 * pose: +Y up, +Z forward, +X left) with its origin at that bone's joint, so a renderer can drive the bones
 * with `inverse(parentSegment) × segment` without stretching the chain.
 */

export const RAGDOLL_SEGMENTS = [
  'pelvis',
  'chest',
  'head',
  'upperArmL',
  'upperArmR',
  'forearmL',
  'forearmR',
  'thighL',
  'thighR',
  'shinL',
  'shinR',
] as const;
export type RagdollSegmentName = (typeof RAGDOLL_SEGMENTS)[number];
export const SEGMENT_COUNT = RAGDOLL_SEGMENTS.length;

export const SEG = {
  pelvis: 0,
  chest: 1,
  head: 2,
  upperArmL: 3,
  upperArmR: 4,
  forearmL: 5,
  forearmR: 6,
  thighL: 7,
  thighR: 8,
  shinL: 9,
  shinR: 10,
} as const satisfies Record<RagdollSegmentName, number>;

export interface RagdollSegmentInfo {
  readonly name: RagdollSegmentName;
  /** Parent segment index (-1 for the pelvis, whose parent is the model root). */
  readonly parent: number;
  /** Rig bones this segment drives (split = relative rotation shared between the listed bones). */
  readonly bones: readonly string[];
  /** Segment origin (joint) in the parent segment's frame in the rest pose (pelvis: in the root frame). */
  readonly origin: Readonly<{ x: number; y: number; z: number }>;
  /** +1 for left / centre, -1 for right. */
  readonly side: 1 | -1;
  readonly kind: RagdollSegmentKind;
}

const sh = BODY.clavicle;
const ua = BODY.upperArm;
const shoulderY = BODY.chest.y + sh.y + ua.y;
const shoulderX = sh.x + ua.x;
const shoulderZ = sh.z + ua.z;

/** Static segment layout (matches `SkierModel.buildRig`; checked by bodyDimensions.test.ts). */
export const RAGDOLL_SEGMENT_INFO: readonly RagdollSegmentInfo[] = [
  {
    name: 'pelvis',
    parent: -1,
    bones: ['pelvis'],
    origin: { x: 0, y: BODY.pelvisHeight, z: 0 },
    side: 1,
    kind: 'pelvis',
  },
  { name: 'chest', parent: 0, bones: ['spine', 'chest'], origin: { ...BODY.spine }, side: 1, kind: 'chest' },
  {
    name: 'head',
    parent: 1,
    bones: ['neck', 'head'],
    origin: { x: BODY.neck.x, y: BODY.chest.y + BODY.neck.y, z: BODY.neck.z },
    side: 1,
    kind: 'head',
  },
  {
    name: 'upperArmL',
    parent: 1,
    bones: ['upperArmL'],
    origin: { x: shoulderX, y: shoulderY, z: shoulderZ },
    side: 1,
    kind: 'upperArm',
  },
  {
    name: 'upperArmR',
    parent: 1,
    bones: ['upperArmR'],
    origin: { x: -shoulderX, y: shoulderY, z: shoulderZ },
    side: -1,
    kind: 'upperArm',
  },
  {
    name: 'forearmL',
    parent: 3,
    bones: ['forearmL', 'handL', 'poleL'],
    origin: { x: 0, y: -BODY.upperArmLength, z: 0 },
    side: 1,
    kind: 'forearm',
  },
  {
    name: 'forearmR',
    parent: 4,
    bones: ['forearmR', 'handR', 'poleR'],
    origin: { x: 0, y: -BODY.upperArmLength, z: 0 },
    side: -1,
    kind: 'forearm',
  },
  { name: 'thighL', parent: 0, bones: ['thighL'], origin: { ...BODY.hip }, side: 1, kind: 'thigh' },
  {
    name: 'thighR',
    parent: 0,
    bones: ['thighR'],
    origin: { x: -BODY.hip.x, y: BODY.hip.y, z: BODY.hip.z },
    side: -1,
    kind: 'thigh',
  },
  {
    name: 'shinL',
    parent: 7,
    bones: ['shinL', 'footL', 'skiL'],
    origin: { x: 0, y: -BODY.thigh, z: 0 },
    side: 1,
    kind: 'shin',
  },
  {
    name: 'shinR',
    parent: 8,
    bones: ['shinR', 'footR', 'skiR'],
    origin: { x: 0, y: -BODY.thigh, z: 0 },
    side: -1,
    kind: 'shin',
  },
];

/** World-space state of one segment, updated every fixed step. `prev*` = before the last step. */
export interface RagdollSegmentView {
  readonly name: RagdollSegmentName;
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly prevPosition: Vector3;
  readonly prevQuaternion: Quaternion;
  /** World linear velocity of the segment origin's body (centre of mass) (m/s). */
  readonly velocity: Vector3;
  /** World angular velocity (rad/s). */
  readonly angularVelocity: Vector3;
  /** True while one of the segment's contact probes touches the snow. */
  readonly snowContact: boolean;
}

/** Read-only view of the ragdoll for presentation (renderer, effects, camera). */
export interface RagdollView {
  readonly segments: readonly RagdollSegmentView[];
  /** Static layout (parents, bones, rest origins). */
  readonly info: readonly RagdollSegmentInfo[];
  /** Fixed ankle flex of the rigid boot: the foot bone's local rotation is Rx(-bootLean) in the shin. */
  readonly bootLean: number;
  /** Seconds since the ragdoll was spawned. */
  readonly time: number;
}

interface MutableSegmentView {
  name: RagdollSegmentName;
  position: Vector3;
  quaternion: Quaternion;
  prevPosition: Vector3;
  prevQuaternion: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  snowContact: boolean;
}

interface Probe {
  x: number;
  y: number;
  z: number;
  r: number;
}

interface BallJoint {
  parent: number;
  child: number;
  /** Joint pivot in the parent frame (the child pivot is its origin). */
  anchor: Vector3;
  /** Limit range (already mirrored for the right side). */
  range: RagdollJointRange;
  /** Limits enforced by the Rapier solver (true) or by our soft constraint (false). */
  solver: boolean;
  /** Tone target relative rotation in the parent frame. */
  target: Quaternion;
}

interface Hinge {
  joint: RAPIER.RevoluteImpulseJoint;
  target: number;
}

/** Spawn parameters in world space. */
export interface RagdollSpawn {
  /** Skier root (foot point) and orientation at the crash. */
  rootPosition: Vector3;
  rootOrientation: Quaternion;
  /** Rigid motion of the skier: velocity of the root and angular velocity (about the root). */
  velocity: Vector3;
  angularVelocity: Vector3;
  /** Loss-of-balance trip: legs gain `tripSpeed` relative to the torso along `tripDirection` (unit). */
  tripDirection: Vector3;
  tripSpeed: number;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _qRel = new Quaternion();
const _qInv = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _axis = new Vector3();
const _lim = new Vector3();
const _err = new Vector3();
const _rv = new Vector3();
const _qSw = new Quaternion();
const _qTw = new Quaternion();
const _vec = { x: 0, y: 0, z: 0 };
const _sample = createSurfaceSample();
const X_AXIS = new Vector3(1, 0, 0);
const ZERO = new Vector3();

function quatFromRotVec(r: RagdollRotation, side: number, out: Quaternion): Quaternion {
  // Mirroring across the body's X plane flips the y and z components of a rotation vector.
  _v.set(r.x, r.y * side, r.z * side);
  const angle = _v.length();
  if (angle < 1e-9) return out.identity();
  return out.setFromAxisAngle(_v.divideScalar(angle), angle);
}

/** Swing/twist decomposition about the local Y (bone) axis: q = swing × twist. Returns the twist angle. */
function swingTwistY(q: Quaternion, swingOut: Quaternion, twistOut: Quaternion): number {
  const len = Math.hypot(q.y, q.w);
  if (len < 1e-9) twistOut.identity();
  else twistOut.set(0, q.y / len, 0, q.w / len);
  if (twistOut.w < 0) twistOut.set(0, -twistOut.y, 0, -twistOut.w);
  swingOut.copy(twistOut).invert().premultiply(q);
  return 2 * Math.atan2(twistOut.y, twistOut.w);
}

function mirrorRange(r: RagdollJointRange, side: number): RagdollJointRange {
  if (side > 0) return { ...r };
  return {
    swingXMin: r.swingXMin,
    swingXMax: r.swingXMax,
    swingZMin: -r.swingZMax,
    swingZMax: -r.swingZMin,
    twistMin: -r.twistMax,
    twistMax: -r.twistMin,
  };
}

type RawJointAxis = Parameters<RAPIER.ImpulseJointSet['raw']['jointSetLimits']>[1];
/** Rapier's angular joint axes (`RawJointAxis.AngX/AngY/AngZ`). */
const ANG_X = 3 as RawJointAxis;
const ANG_Y = 4 as RawJointAxis;
const ANG_Z = 5 as RawJointAxis;

/**
 * Ball-joint limits as Rapier solver constraints, per angular axis of the relative rotation (parent →
 * child): X = flexion/extension, Y = twist about the bone, Z = abduction/adduction. Rapier limits each
 * imaginary component of the relative quaternion to [sin(min/2), sin(max/2)], which is exact for a single
 * axis and a box in quaternion space for combined swings.
 *
 * Deviation from CRASH_REDESIGN 2.2: explicit pre-step limit torques (still available as the soft limit,
 * `applySoftLimit`) were measured to be either too weak (0.5 rad static violation under gravity) or
 * unstable (pelvis launched) on this 11-body chain, because one impulse per step cannot be stiff against the
 * coupled joint system, and they fidget against contacts (limbs pinned under the body or against a tree).
 * rapier3d-compat 0.19's JS wrapper has no `setLimits` on `SphericalImpulseJoint`, but the generic joint
 * set behind it supports per-axis angular limits; `ImpulseJointSet.raw` is its public handle.
 *
 * Constraint on the ranges: the box corner must stay well inside the unit ball (Σ sin²(limit/2) < 0.85),
 * otherwise the relative rotation can reach w = 0, where the quaternion's double cover flips the sign of
 * the measured components and the limit impulse explodes. Covered by Ragdoll.test.ts.
 */
function setBallLimits(world: RAPIER.World, joint: RAPIER.ImpulseJoint, r: RagdollJointRange): void {
  const raw = world.impulseJoints.raw;
  raw.jointSetLimits(joint.handle, ANG_X, r.swingXMin, r.swingXMax);
  raw.jointSetLimits(joint.handle, ANG_Y, r.twistMin, r.twistMax);
  raw.jointSetLimits(joint.handle, ANG_Z, r.swingZMin, r.swingZMax);
}

class RagdollViewImpl implements RagdollView {
  readonly info = RAGDOLL_SEGMENT_INFO;
  constructor(
    readonly segments: readonly RagdollSegmentView[],
    private readonly owner: Ragdoll,
  ) {}
  get bootLean(): number {
    return this.owner.bootLean;
  }
  get time(): number {
    return this.owner.time;
  }
}

export class Ragdoll {
  readonly view: RagdollView;
  private readonly segs: MutableSegmentView[] = [];
  private readonly bodies: (RAPIER.RigidBody | null)[] = new Array<RAPIER.RigidBody | null>(
    SEGMENT_COUNT,
  ).fill(null);
  private readonly probes: Probe[][] = [];
  private readonly masses = new Float64Array(SEGMENT_COUNT);
  /** Principal inertia (local principal frame) and that frame, per segment. */
  private readonly inertia: Vector3[] = [];
  private readonly inertiaFrame: Quaternion[] = [];
  /** Centre of mass in the segment frame. */
  private readonly comLocal: Vector3[] = [];
  private readonly balls: BallJoint[] = [];
  private readonly hinges: Hinge[] = [];
  private cfg: CrashConfig | null = null;
  /** Remaining trip (loss of balance) applied over the first steps. */
  private readonly tripDir = new Vector3();
  private tripDvLegs = 0;
  private tripDvTorso = 0;
  private tripLeft = 0;
  private _time = 0;
  private _active = false;
  /** Stance positions/rotations in the skier root frame (scratch, reused). */
  private readonly stancePos: Vector3[] = [];
  private readonly stanceRot: Quaternion[] = [];

  constructor(
    private readonly world: RAPIER.World,
    private readonly surface: SurfaceField,
    private readonly collisionGroups: number,
  ) {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      this.segs.push({
        name: RAGDOLL_SEGMENTS[i],
        position: new Vector3(),
        quaternion: new Quaternion(),
        prevPosition: new Vector3(),
        prevQuaternion: new Quaternion(),
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
        snowContact: false,
      });
      this.inertia.push(new Vector3(1, 1, 1));
      this.inertiaFrame.push(new Quaternion());
      this.comLocal.push(new Vector3());
      this.stancePos.push(new Vector3());
      this.stanceRot.push(new Quaternion());
      this.probes.push([]);
    }
    this.view = new RagdollViewImpl(this.segs, this);
  }

  /** Fixed boot forward lean of the current crash config (rad). */
  get bootLean(): number {
    return this.cfg?.bootLean ?? 0;
  }

  get active(): boolean {
    return this._active;
  }

  get time(): number {
    return this._time;
  }

  /** Total mass of all segments (kg). */
  get totalMass(): number {
    let m = 0;
    for (let i = 0; i < SEGMENT_COUNT; i++) m += this.masses[i];
    return m;
  }

  segmentMass(i: number): number {
    return this.masses[i];
  }

  /** Builds the bodies and joints in the athletic stance at the skier's transform with its rigid motion. */
  spawn(cfg: CrashConfig, skierMass: number, s: RagdollSpawn): void {
    this.despawn();
    this.cfg = cfg;
    this._time = 0;
    this.buildStance(cfg);
    this.buildProbes(cfg);

    // World transforms.
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = this.segs[i];
      seg.position.copy(this.stancePos[i]).applyQuaternion(s.rootOrientation).add(s.rootPosition);
      seg.quaternion.copy(s.rootOrientation).multiply(this.stanceRot[i]).normalize();
    }
    // No spawn pop: lift only by the actual penetration of the snow (+1 cm).
    const minGap = this.minProbeGap();
    if (minGap < 0) {
      const lift = -minGap + 0.01;
      for (const seg of this.segs) seg.position.y += lift;
    }
    for (const seg of this.segs) {
      seg.prevPosition.copy(seg.position);
      seg.prevQuaternion.copy(seg.quaternion);
    }

    const massScale = skierMass / this.nominalMass(cfg);
    for (let i = 0; i < SEGMENT_COUNT; i++) this.createBody(i, cfg, massScale);
    this.createJoints(cfg);

    // Rigid motion of the skier: v + ω × r about the root, so the body keeps exactly the motion it had.
    let mLegs = 0;
    let mTorso = 0;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const g = tripGroup(i);
      if (g > 0) mLegs += this.masses[i];
      else if (g < 0) mTorso += this.masses[i];
    }
    // Loss of balance: equal and opposite momentum for legs and torso (total momentum unchanged), spread
    // over tripDuration so the pelvis between them is not jerked in a single step.
    const total = mLegs + mTorso;
    this.tripDir.copy(s.tripDirection);
    this.tripDvLegs = total > 0 ? (s.tripSpeed * mTorso) / total : 0;
    this.tripDvTorso = total > 0 ? (-s.tripSpeed * mLegs) / total : 0;
    const instant = cfg.tripDuration <= 0;
    this.tripLeft = instant ? 0 : cfg.tripDuration;
    const dvLegs = instant ? this.tripDvLegs : 0;
    const dvTorso = instant ? this.tripDvTorso : 0;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const body = this.bodies[i]!;
      const com = body.worldCom();
      _v.set(com.x, com.y, com.z).sub(s.rootPosition);
      _v2.copy(s.angularVelocity).cross(_v).add(s.velocity);
      const g = tripGroup(i);
      if (g > 0) _v2.addScaledVector(s.tripDirection, dvLegs);
      else if (g < 0) _v2.addScaledVector(s.tripDirection, dvTorso);
      _vec.x = _v2.x;
      _vec.y = _v2.y;
      _vec.z = _v2.z;
      body.setLinvel(_vec, true);
      _vec.x = s.angularVelocity.x;
      _vec.y = s.angularVelocity.y;
      _vec.z = s.angularVelocity.z;
      body.setAngvel(_vec, true);
      this.segs[i].velocity.copy(_v2);
      this.segs[i].angularVelocity.copy(s.angularVelocity);
    }
    this._active = true;
  }

  despawn(): void {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const b = this.bodies[i];
      // Removing a body also removes its colliders and the joints attached to it.
      if (b) this.world.removeRigidBody(b);
      this.bodies[i] = null;
    }
    this.balls.length = 0;
    this.hinges.length = 0;
    this._active = false;
  }

  /** Current muscle tone 0..1. */
  tone(): number {
    const c = this.cfg;
    if (!c) return 0;
    return c.toneLimp + (c.toneStart - c.toneLimp) * Math.exp(-this._time / Math.max(1e-3, c.toneDecayTime));
  }

  /**
   * Applies muscle tone, joint damping and snow ploughing. Call right before `world.step()`. The joint
   * limits themselves are Rapier solver constraints (see `createJoints`).
   */
  beforeStep(dt: number): void {
    const c = this.cfg;
    if (!this._active || !c) return;
    if (this.tripLeft > 0) this.applyTrip(c, dt);
    const tone = this.tone();
    const wT = c.toneFrequency;
    const kT = tone * wT * wT;
    const cT = tone * 2 * c.toneDampingRatio * wT;

    for (const j of this.balls) {
      const P = this.segs[j.parent];
      const C = this.segs[j.child];
      _qInv.copy(P.quaternion).invert();
      _qRel.copy(_qInv).multiply(C.quaternion);
      if (_qRel.w < 0) _qRel.set(-_qRel.x, -_qRel.y, -_qRel.z, -_qRel.w);
      // Relative angular velocity in the parent frame.
      _w.copy(C.angularVelocity).sub(P.angularVelocity).applyQuaternion(_qInv);
      if (!j.solver) this.applySoftLimit(j, _qRel, _w, c.limitErp / dt, c.maxJointDeltaOmega);
      // Muscle tone towards the protective pose plus passive joint damping (explicit spring-damper on the
      // relative motion, as an equal and opposite torque impulse pair).
      _a.set(0, 0, 0);
      if (kT > 0) {
        _q.copy(j.target).invert().premultiply(_qRel);
        quaternionToRotationVector(_q, _v);
        _a.addScaledVector(_v, -kT * dt);
      }
      _a.addScaledVector(_w, -Math.min(0.9, (cT + c.jointDamping) * dt));
      this.applyRelativeImpulse(j, _a, c.maxJointDeltaOmega);
    }

    // Knees and elbows: Rapier limits; tone through an acceleration-based position motor.
    for (const h of this.hinges) {
      h.joint.configureMotorPosition(h.target, kT, cT + c.jointDamping);
    }

    // Snow: ploughing drag on the tangential velocity and rolling resistance of touching segments.
    const plough = Math.min(0.5, c.ploughDrag * dt);
    const roll = Math.min(0.5, c.contactAngularDamping * dt);
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = this.segs[i];
      const touching = this.segmentTouching(i, c.contactMargin);
      seg.snowContact = touching;
      if (!touching) continue;
      const body = this.bodies[i]!;
      const m = this.masses[i];
      const n = _sample.normal;
      _v.copy(seg.velocity)
        .addScaledVector(n, -seg.velocity.dot(n))
        .multiplyScalar(-m * plough);
      _vec.x = _v.x;
      _vec.y = _v.y;
      _vec.z = _v.z;
      body.applyImpulse(_vec, true);
      _v.copy(seg.angularVelocity).multiplyScalar(-roll * this.inertiaAlongVelocity(i));
      _vec.x = _v.x;
      _vec.y = _v.y;
      _vec.z = _v.z;
      body.applyTorqueImpulse(_vec, true);
    }
  }

  /** Applies this step's share of the trip impulse pair (sums to zero over all segments). */
  private applyTrip(c: CrashConfig, dt: number): void {
    const share = Math.min(dt, this.tripLeft) / c.tripDuration;
    this.tripLeft -= dt;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const g = tripGroup(i);
      if (g === 0) continue;
      const dv = (g > 0 ? this.tripDvLegs : this.tripDvTorso) * share * this.masses[i];
      _vec.x = this.tripDir.x * dv;
      _vec.y = this.tripDir.y * dv;
      _vec.z = this.tripDir.z * dv;
      this.bodies[i]!.applyImpulse(_vec, true);
    }
  }

  /** Reads the stepped state back into the view. Call right after `world.step()`. Returns false on NaN. */
  afterStep(dt: number): boolean {
    if (!this._active) return true;
    this._time += dt;
    let ok = true;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const b = this.bodies[i]!;
      const seg = this.segs[i];
      seg.prevPosition.copy(seg.position);
      seg.prevQuaternion.copy(seg.quaternion);
      const t = b.translation();
      const q = b.rotation();
      const lv = b.linvel();
      const av = b.angvel();
      seg.position.set(t.x, t.y, t.z);
      seg.quaternion.set(q.x, q.y, q.z, q.w).normalize();
      seg.velocity.set(lv.x, lv.y, lv.z);
      seg.angularVelocity.set(av.x, av.y, av.z);
      if (
        !Number.isFinite(seg.position.x + seg.position.y + seg.position.z) ||
        !Number.isFinite(seg.quaternion.x + seg.quaternion.y + seg.quaternion.z + seg.quaternion.w) ||
        !Number.isFinite(seg.velocity.x + seg.velocity.y + seg.velocity.z) ||
        !Number.isFinite(seg.angularVelocity.x + seg.angularVelocity.y + seg.angularVelocity.z)
      )
        ok = false;
    }
    return ok;
  }

  /** Largest segment angular speed (rad/s). */
  maxAngularSpeed(): number {
    let m = 0;
    for (const s of this.segs) m = Math.max(m, s.angularVelocity.length());
    return m;
  }

  /** Smallest gap between a contact probe and the analytic snow (m, negative = penetrating). */
  minProbeGap(): number {
    let best = Infinity;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = this.segs[i];
      for (const p of this.probes[i]) {
        _v3.set(p.x, p.y, p.z).applyQuaternion(seg.quaternion).add(seg.position);
        const gap = _v3.y - p.r - this.surface.height(_v3.x, _v3.z);
        if (gap < best) best = gap;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------------

  private nominalMass(cfg: CrashConfig): number {
    let m = 0;
    for (const info of RAGDOLL_SEGMENT_INFO) m += cfg.segmentMass[info.kind];
    return m;
  }

  /** Athletic stance in the skier root frame; the ski bases end up on the root plane, centred on it. */
  private buildStance(cfg: CrashConfig): void {
    const st = cfg.stance;
    const P = this.stancePos;
    const R = this.stanceRot;
    quatFromRotVec(st.pelvis, 1, R[SEG.pelvis]);
    quatFromRotVec(st.chest, 1, R[SEG.chest]);
    quatFromRotVec(st.head, 1, R[SEG.head]);
    for (const side of [1, -1]) {
      const ua = side > 0 ? SEG.upperArmL : SEG.upperArmR;
      const fa = side > 0 ? SEG.forearmL : SEG.forearmR;
      const th = side > 0 ? SEG.thighL : SEG.thighR;
      const sn = side > 0 ? SEG.shinL : SEG.shinR;
      quatFromRotVec(st.upperArm, side, R[ua]);
      R[fa].copy(R[ua]).multiply(_q.setFromAxisAngle(X_AXIS, -st.elbow));
      quatFromRotVec(st.thigh, side, R[th]);
      // Knee bend so that the shin leans forward by the boot lean (flat skis): shin X angle = bootLean.
      const thighPitch = 2 * Math.atan2(R[th].x, R[th].w);
      R[sn].copy(R[th]).multiply(_q.setFromAxisAngle(X_AXIS, cfg.bootLean - thighPitch));
    }
    P[SEG.pelvis].set(0, 0, 0);
    for (let i = 1; i < SEGMENT_COUNT; i++) {
      const info = RAGDOLL_SEGMENT_INFO[i];
      _v.set(info.origin.x, info.origin.y, info.origin.z).applyQuaternion(R[info.parent]);
      P[i].copy(P[info.parent]).add(_v);
    }
    // Centre the ski bones on the root and put their bases on the root plane.
    _v2.set(0, 0, 0);
    for (const sn of [SEG.shinL, SEG.shinR]) {
      this.skiBoneLocal(cfg, _v);
      _v.applyQuaternion(R[sn]).add(P[sn]);
      _v2.addScaledVector(_v, 0.5);
    }
    for (let i = 0; i < SEGMENT_COUNT; i++) P[i].sub(_v2);
  }

  /** Ski bone (ski base centre) in the shin frame. */
  private skiBoneLocal(cfg: CrashConfig, out: Vector3): Vector3 {
    out.set(0, BODY.skiOffsetY, BODY.skiOffsetZ).applyAxisAngle(X_AXIS, -cfg.bootLean);
    return out.add(_v3.set(0, -BODY.shin, 0));
  }

  private buildProbes(cfg: CrashConfig): void {
    const set = (i: number, list: Probe[]) => {
      this.probes[i].length = 0;
      this.probes[i].push(...list);
    };
    set(SEG.pelvis, [
      { x: 0.12, y: -0.02, z: 0, r: 0.09 },
      { x: -0.12, y: -0.02, z: 0, r: 0.09 },
    ]);
    set(SEG.chest, [
      { x: 0, y: 0.1, z: 0, r: 0.1 },
      { x: 0, y: 0.38, z: 0, r: 0.1 },
    ]);
    set(SEG.head, [{ x: 0, y: 0.2, z: 0.02, r: 0.125 }]);
    for (const i of [SEG.upperArmL, SEG.upperArmR])
      set(i, [
        { x: 0, y: -0.055, z: 0, r: 0.055 },
        { x: 0, y: -0.235, z: 0, r: 0.055 },
      ]);
    for (const i of [SEG.forearmL, SEG.forearmR])
      set(i, [
        { x: 0, y: -0.05, z: 0, r: 0.05 },
        { x: 0, y: -0.31, z: 0, r: 0.05 },
      ]);
    for (const i of [SEG.thighL, SEG.thighR])
      set(i, [
        { x: 0, y: -0.08, z: 0, r: 0.085 },
        { x: 0, y: -0.36, z: 0, r: 0.085 },
      ]);
    const half = BODY.skiLength / 2 - 0.04;
    for (const i of [SEG.shinL, SEG.shinR]) {
      const list: Probe[] = [{ x: 0, y: -0.08, z: 0, r: 0.06 }];
      for (const dz of [half, -half, 0]) {
        _v.set(0, BODY.skiOffsetY + 0.015, BODY.skiOffsetZ + dz).applyAxisAngle(X_AXIS, -cfg.bootLean);
        list.push({ x: _v.x, y: _v.y - BODY.shin, z: _v.z, r: 0.015 });
      }
      set(i, list);
    }
  }

  private createBody(i: number, cfg: CrashConfig, massScale: number): void {
    const seg = this.segs[i];
    const info = RAGDOLL_SEGMENT_INFO[i];
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(seg.position.x, seg.position.y, seg.position.z)
      .setRotation({ x: seg.quaternion.x, y: seg.quaternion.y, z: seg.quaternion.z, w: seg.quaternion.w })
      .setLinearDamping(cfg.linearDamping)
      .setAngularDamping(cfg.angularDamping)
      .setCanSleep(false)
      .setAdditionalSolverIterations(cfg.solverIterations)
      // Soft CCD (speculative contacts): hard CCD substeps fight the joints and launch the chain.
      .setSoftCcdPrediction(cfg.softCcdDistance);
    const body = this.world.createRigidBody(desc);
    this.bodies[i] = body;
    const mass = cfg.segmentMass[info.kind] * massScale;
    const groups = this.collisionGroups;
    const add = (c: RAPIER.ColliderDesc, m: number, friction: number, x: number, y: number, z: number) => {
      c.setTranslation(x, y, z)
        .setMass(m)
        .setFriction(friction)
        .setRestitution(cfg.restitution)
        .setCollisionGroups(groups);
      return this.world.createCollider(c, body);
    };
    const cloth = cfg.frictionClothing;
    switch (info.kind) {
      case 'pelvis':
        add(RAPIER.ColliderDesc.roundCuboid(0.13, 0.07, 0.06, 0.03), mass, cloth, 0, -0.02, 0);
        break;
      case 'chest':
        add(RAPIER.ColliderDesc.roundCuboid(0.13, 0.17, 0.07, 0.03), mass, cloth, 0, 0.24, 0);
        break;
      case 'head':
        add(RAPIER.ColliderDesc.ball(0.125), mass, cfg.frictionHelmet, 0, 0.2, 0.02);
        break;
      case 'upperArm':
        add(RAPIER.ColliderDesc.capsule(0.09, 0.055), mass, cloth, 0, -0.145, 0);
        break;
      case 'forearm':
        add(RAPIER.ColliderDesc.capsule(0.13, 0.05), mass, cloth, 0, -0.18, 0);
        break;
      case 'thigh':
        add(RAPIER.ColliderDesc.capsule(0.14, 0.085), mass, cloth, 0, -0.22, 0);
        break;
      case 'shin': {
        const skiMass = mass * cfg.skiMassFraction;
        add(RAPIER.ColliderDesc.capsule(0.15, 0.06), mass - skiMass, cloth, 0, -0.23, 0);
        // Rigid boot + ski: a thin cuboid at the foot offset, flat when the shin leans by bootLean.
        _v.set(0, BODY.skiOffsetY + 0.015, BODY.skiOffsetZ).applyAxisAngle(X_AXIS, -cfg.bootLean);
        _q2.setFromAxisAngle(X_AXIS, -cfg.bootLean);
        const ski = RAPIER.ColliderDesc.cuboid(0.05, 0.015, BODY.skiLength / 2).setRotation({
          x: _q2.x,
          y: _q2.y,
          z: _q2.z,
          w: _q2.w,
        });
        add(ski, skiMass, cfg.frictionSki, _v.x, _v.y - BODY.shin, _v.z);
        break;
      }
    }
    // Limb capsules have almost no inertia about their own axis, so they spin up about it (a whirling pole)
    // and stiffen the twist constraints. Raise the long-axis inertia to a fraction of the transverse one.
    if (info.kind === 'upperArm' || info.kind === 'forearm' || info.kind === 'thigh') {
      body.recomputeMassPropertiesFromColliders();
      const p0 = body.principalInertia();
      const transverse = Math.max(p0.x, p0.y, p0.z);
      const extra = Math.max(0, cfg.limbAxialInertia * transverse - Math.min(p0.x, p0.y, p0.z));
      body.setAdditionalMassProperties(
        0,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: extra, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        true,
      );
      body.recomputeMassPropertiesFromColliders();
    }
    this.masses[i] = body.mass();
    const pi = body.principalInertia();
    this.inertia[i].set(Math.max(1e-5, pi.x), Math.max(1e-5, pi.y), Math.max(1e-5, pi.z));
    const pf = body.principalInertiaLocalFrame();
    this.inertiaFrame[i].set(pf.x, pf.y, pf.z, pf.w).normalize();
    const lc = body.localCom();
    this.comLocal[i].set(lc.x, lc.y, lc.z);
  }

  private createJoints(cfg: CrashConfig): void {
    const ball = (child: number, rangeLeft: RagdollJointRange, target: RagdollRotation, solver: boolean) => {
      const info = RAGDOLL_SEGMENT_INFO[child];
      const jd = RAPIER.JointData.spherical(info.origin, { x: 0, y: 0, z: 0 });
      const j = this.world.createImpulseJoint(jd, this.bodies[info.parent]!, this.bodies[child]!, true);
      j.setContactsEnabled(false);
      const range = mirrorRange(rangeLeft, info.side);
      if (solver) setBallLimits(this.world, j, range);
      this.balls.push({
        parent: info.parent,
        child,
        anchor: new Vector3(info.origin.x, info.origin.y, info.origin.z),
        range,
        solver,
        target: quatFromRotVec(target, info.side, new Quaternion()),
      });
    };
    const hinge = (child: number, axisSign: number, max: number, target: number) => {
      const info = RAGDOLL_SEGMENT_INFO[child];
      const jd = RAPIER.JointData.revolute(info.origin, { x: 0, y: 0, z: 0 }, { x: axisSign, y: 0, z: 0 });
      const j = this.world.createImpulseJoint(
        jd,
        this.bodies[info.parent]!,
        this.bodies[child]!,
        true,
      ) as RAPIER.RevoluteImpulseJoint;
      j.setContactsEnabled(false);
      // JointData.limits is ignored for revolute joints in rapier3d-compat 0.19: set them on the joint.
      j.setLimits(0, max);
      j.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      this.hinges.push({ joint: j, target });
    };
    const tp = cfg.tonePose;
    const sl = cfg.solverLimits;
    ball(SEG.chest, cfg.waist, tp.waist, sl.waist);
    ball(SEG.head, cfg.neck, tp.neck, sl.neck);
    ball(SEG.upperArmL, cfg.shoulder, tp.shoulder, sl.shoulder);
    ball(SEG.upperArmR, cfg.shoulder, tp.shoulder, sl.shoulder);
    ball(SEG.thighL, cfg.hip, tp.hip, sl.hip);
    ball(SEG.thighR, cfg.hip, tp.hip, sl.hip);
    // Knee: + rotation about X swings the shin backwards. Elbow: flexion is about -X.
    hinge(SEG.shinL, 1, cfg.kneeMax, tp.knee);
    hinge(SEG.shinR, 1, cfg.kneeMax, tp.knee);
    hinge(SEG.forearmL, -1, cfg.elbowMax, tp.elbow);
    hinge(SEG.forearmR, -1, cfg.elbowMax, tp.elbow);
  }

  /**
   * Own ball-joint limit (joints without solver limits): a velocity-level soft constraint on a swing
   * ellipse (separate extents per quadrant in swing X/Z) and the twist range. It removes the relative
   * velocity that drives further out and corrects `erp` × error per second; it never pulls inwards.
   */
  private applySoftLimit(j: BallJoint, qRel: Quaternion, wRel: Vector3, erp: number, cap: number): void {
    const c = this.cfg!;
    const kv = c.softLimitVelocityGain;
    const kp = erp * c.softLimitStrength;
    const twist = swingTwistY(qRel, _qSw, _qTw);
    quaternionToRotationVector(_qSw, _rv);
    const r = j.range;
    _lim.set(0, 0, 0);
    const ax = _rv.x >= 0 ? Math.max(1e-3, r.swingXMax) : Math.max(1e-3, -r.swingXMin);
    const az = _rv.z >= 0 ? Math.max(1e-3, r.swingZMax) : Math.max(1e-3, -r.swingZMin);
    const e = (_rv.x / ax) ** 2 + (_rv.z / az) ** 2;
    if (e > 1) {
      const k = 1 - 1 / Math.sqrt(e);
      _err.set(_rv.x * k, 0, _rv.z * k);
      const len = _err.length();
      if (len > 1e-9) {
        _err.divideScalar(len);
        const drive = kv * wRel.dot(_err) + Math.min(kp * len, c.softLimitMaxBias);
        if (drive > 0) _lim.addScaledVector(_err, -drive);
      }
    }
    const tErr = twist > r.twistMax ? twist - r.twistMax : twist < r.twistMin ? twist - r.twistMin : 0;
    if (tErr !== 0) {
      _err.set(0, 1, 0).applyQuaternion(qRel);
      const sgn = tErr > 0 ? 1 : -1;
      const drive = kv * sgn * wRel.dot(_err) + Math.min(kp * Math.abs(tErr), c.softLimitMaxBias);
      if (drive > 0) _lim.addScaledVector(_err, -sgn * drive);
    }
    this.applyRelativeImpulse(j, _lim, cap);
  }

  /**
   * Applies a relative angular velocity change `dOmega` (parent frame) to a ball joint as an equal and
   * opposite torque impulse pair, sized with the effective inertia of the pair about the joint pivot.
   */
  private applyRelativeImpulse(j: BallJoint, dOmega: Vector3, cap: number): void {
    const len = dOmega.length();
    if (len < 1e-9) return;
    if (len > cap) dOmega.multiplyScalar(cap / len);
    dOmega.applyQuaternion(this.segs[j.parent].quaternion);
    _axis.copy(dOmega).divideScalar(dOmega.length());
    const ic = this.pivotInertia(j.child, _axis, ZERO);
    const ip = this.pivotInertia(j.parent, _axis, j.anchor);
    dOmega.multiplyScalar((ic * ip) / (ic + ip));
    this.torqueImpulse(j.child, dOmega, 1);
    this.torqueImpulse(j.parent, dOmega, -1);
  }

  /** Moment of inertia of segment `i` about a world axis through `pivot` (local frame), parallel-axis. */
  private pivotInertia(i: number, axisWorld: Vector3, pivot: Vector3): number {
    const base = this.inertiaAlong(i, axisWorld);
    _q.copy(this.segs[i].quaternion).invert();
    _v3.copy(axisWorld).applyQuaternion(_q);
    _v2.copy(pivot).sub(this.comLocal[i]);
    const along = _v2.dot(_v3);
    return base + this.masses[i] * Math.max(0, _v2.lengthSq() - along * along);
  }

  /** Moment of inertia of segment `i` about a world axis through its centre of mass. */
  private inertiaAlong(i: number, axisWorld: Vector3): number {
    _q.copy(this.segs[i].quaternion).multiply(this.inertiaFrame[i]).invert();
    _v3.copy(axisWorld).applyQuaternion(_q);
    const I = this.inertia[i];
    return I.x * _v3.x * _v3.x + I.y * _v3.y * _v3.y + I.z * _v3.z * _v3.z;
  }

  private inertiaAlongVelocity(i: number): number {
    const w = this.segs[i].angularVelocity;
    const len = w.length();
    if (len < 1e-9) return 0;
    _v2.copy(w).divideScalar(len);
    return this.inertiaAlong(i, _v2);
  }

  private torqueImpulse(i: number, impulse: Vector3, sign: number): void {
    _vec.x = impulse.x * sign;
    _vec.y = impulse.y * sign;
    _vec.z = impulse.z * sign;
    this.bodies[i]!.applyTorqueImpulse(_vec, true);
  }

  /** True when a probe of segment `i` is within `margin` of the snow; leaves the snow normal in _sample. */
  private segmentTouching(i: number, margin: number): boolean {
    const seg = this.segs[i];
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (const p of this.probes[i]) {
      _v3.set(p.x, p.y, p.z).applyQuaternion(seg.quaternion).add(seg.position);
      const gap = _v3.y - p.r - this.surface.height(_v3.x, _v3.z);
      if (gap < best) {
        best = gap;
        bx = _v3.x;
        bz = _v3.z;
      }
    }
    if (best > margin) return false;
    this.surface.sample(bx, bz, _sample);
    return true;
  }
}

/** +1 = legs (trip pushes them), -1 = torso (pushed the other way), 0 = pelvis (pivot). */
function tripGroup(i: number): number {
  if (i === SEG.pelvis) return 0;
  if (i >= SEG.thighL) return 1;
  return -1;
}

// Exposed for tests: rotation vector helpers keep the right/left mirroring in one place.
export const __test = { mirrorRange, quatFromRotVec, swingTwistY };
