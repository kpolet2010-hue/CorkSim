import { Matrix4, Quaternion, Vector3, type Bone } from 'three';
import type { RagdollSegmentInfo } from '../../physics/Ragdoll';
import type { SkierModel } from '../SkierModel';
import { ramp } from './springs';

/** Capacity of the preallocated segment arrays (the ragdoll has 11 segments). */
export const RAGDOLL_POSE_CAPACITY = 16;

/**
 * Interpolated crash ragdoll pose for one render frame (part of `SkierPoseInput`). Filled by
 * `buildSkierPose` from `player.ragdoll`; preallocated, so building it never allocates.
 */
export interface SkierRagdollPose {
  /** True while the simulation shows the crash ragdoll. Everything else is only valid while true. */
  active: boolean;
  /** Number of valid segments. */
  count: number;
  /** Static layout (parents, driven bones), shared with the simulation (read-only). */
  info: readonly RagdollSegmentInfo[];
  /** Interpolated world position of each segment origin (its bone joint). */
  readonly positions: Vector3[];
  /** Interpolated world rotation of each segment (identity = the bone's rest frame). */
  readonly quaternions: Quaternion[];
  /** World velocity of the pelvis segment (m/s), carried into the get-up. */
  readonly pelvisVelocity: Vector3;
  /** Fixed ankle flex of the rigid boot: foot local rotation = Rx(-bootLean). */
  bootLean: number;
  /** Seconds since the ragdoll spawned (latest step). */
  time: number;
}

export function createSkierRagdollPose(): SkierRagdollPose {
  const positions: Vector3[] = [];
  const quaternions: Quaternion[] = [];
  for (let i = 0; i < RAGDOLL_POSE_CAPACITY; i++) {
    positions.push(new Vector3());
    quaternions.push(new Quaternion());
  }
  return {
    active: false,
    count: 0,
    info: [],
    positions,
    quaternions,
    pelvisVelocity: new Vector3(),
    bootLean: 0,
    time: 0,
  };
}

/** Blend from the last animated pose into the ragdoll (s). */
export const RAGDOLL_BLEND_IN = 0.1;
/** World-space get-up blend from the last ragdoll pose to the animated recovery pose (s). */
export const GETUP_TIME = 0.8;
/** Slide carried into the get-up: the frozen pose keeps the pelvis velocity, decaying with this tau (s). */
const GETUP_SLIDE_TAU = 0.08;

/**
 * Bone groups of the staggered get-up: the legs pull the skis under the body and the arms reach down to
 * push first, then the torso comes up over the skis (the ground clamp lifts the body as the legs fold
 * under it).
 */
const enum Group {
  Torso,
  Arm,
  Leg,
}
/** [delay, duration] of each group's get-up blend (s). All end by GETUP_TIME. */
const GETUP_TIMING: readonly (readonly [number, number])[] = [
  [0.14, GETUP_TIME - 0.14],
  [0, 0.5],
  [0, 0.6],
];
/** Largest ground-clamp lift (m): the body is pushed up, never thrown into the air. */
const GETUP_MAX_LIFT = 0.3;
/** Largest ground-clamp lift speed (m/s). */
const GETUP_LIFT_SPEED = 1.5;
/** The pelvis rises with the torso. */
const GETUP_PELVIS: readonly [number, number] = [0.14, GETUP_TIME - 0.14];
/** Contact points kept above the snow during the get-up: [bone, local x, y, z, radius]. */
type Probe = readonly [keyof ProbeBones, number, number, number, number];
interface ProbeBones {
  skiL: Bone;
  skiR: Bone;
  shinL: Bone;
  shinR: Bone;
  head: Bone;
  chest: Bone;
  pelvis: Bone;
}
const GETUP_PROBES: readonly Probe[] = [
  // Boot / binding centre only: the long ski tips may drag through the surface snow while the legs
  // swing under the body; clamping on them would lift the whole body off the ground.
  ['skiL', 0, 0, 0, 0.01],
  ['skiR', 0, 0, 0, 0.01],
  ['shinL', 0, 0, 0, 0.06],
  ['shinR', 0, 0, 0, 0.06],
  ['head', 0, 0.1, 0, 0.14],
  ['chest', 0, 0.1, 0, 0.13],
  ['pelvis', 0, 0, 0, 0.12],
];

const X_AXIS = new Vector3(1, 0, 0);
const IDENTITY = new Quaternion();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _rootQ = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _v2 = new Vector3();
const _inv = new Matrix4();

function quatNegate(q: Quaternion): Quaternion {
  return q.set(-q.x, -q.y, -q.z, -q.w);
}

function quatDot(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/**
 * q^t without the shortest-arc flip (in place): a quaternion with w < 0 turns the long way round, so a
 * rotation path whose sign is kept continuous never jumps.
 */
function quatPowIdentity(q: Quaternion, t: number): Quaternion {
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-9) return q.identity();
  const half = Math.atan2(s, q.w) * t;
  const k = Math.sin(half) / s;
  return q.set(q.x * k, q.y * k, q.z * k, Math.cos(half));
}

function groupOf(name: string): Group {
  if (/^(upperArm|forearm|hand|pole|shoulder)/.test(name)) return Group.Arm;
  if (/^(hip|thigh|shin|foot|ski)/.test(name)) return Group.Leg;
  return Group.Torso;
}

/**
 * Displays the crash ragdoll on the rig and owns the two transitions around it:
 *
 * - **Ragdoll drive:** every driven bone's local rotation is `inverse(parentSegment) × segment`; the
 *   chest's rotation is split between spine and chest and the head's between neck and head (slerp
 *   halves); clavicles, hips, hands, poles and skis stay at rest and the foot is Rx(-bootLean), so the
 *   ski is rigid with the shin. The pelvis bone takes the pelvis segment's world transform through the
 *   root's actual world matrix. Bone positions stay at the rig offsets (the joint anchors match them).
 * - **Blend in:** from the last animated bone locals over RAGDOLL_BLEND_IN; the pelvis carries the world
 *   offset between the animated and the ragdoll pelvis at entry and lets it decay (hides the root jump
 *   from the crouched ragdoll stance), so the physics is never delayed.
 * - **Get-up:** keeps the last displayed ragdoll pose in world space and blends it into the animated
 *   recovery pose over GETUP_TIME, per bone group (torso sits / pushes up first, legs follow).
 *
 * No allocation per frame.
 */
export class RagdollDriver {
  private model: SkierModel | null = null;
  private bones: Bone[] = [];
  private parent: Int16Array = new Int16Array(0);
  private group: Uint8Array = new Uint8Array(0);
  private pelvisIndex = 0;
  /** Bones driven by each segment (by `info.bones`), resolved once per model. */
  private segBones: Bone[][] = [];
  private segInfo: readonly RagdollSegmentInfo[] | null = null;

  // Per-bone scratch / state (sized to the skeleton).
  private animLocal: Quaternion[] = [];
  private frozenQ: Quaternion[] = [];
  private worldQ: Quaternion[] = [];
  private blendQ: Quaternion[] = [];
  /** Get-up rotation (frozen -> animated, world) of the previous frame, to keep the path continuous. */
  private pathQ: Quaternion[] = [];
  private getUpFresh = false;
  /** Snow penetration of the frozen pose at the start of the get-up (faded out, never popped). */
  private getUpPen0 = 0;
  private getUpLift = 0;
  private getUpT = 0;
  private probeBones: ProbeBones | null = null;

  private readonly frozenPelvis = new Vector3();
  private readonly frozenVel = new Vector3();
  private readonly lastPelvisPos = new Vector3();
  private readonly lastPelvisQ = new Quaternion();
  private hasLastPelvis = false;
  private readonly entryDPos = new Vector3();
  private readonly entryDQ = new Quaternion();
  private entryPending = false;

  /** True while the ragdoll drives the rig. */
  active = false;
  /** Seconds since the ragdoll took over (drives the blend in). */
  private blendClock = 0;
  /** True between the end of the ragdoll and the end of the get-up blend. */
  gettingUp = false;
  /** Current blend-in weight (0 = animated pose, 1 = ragdoll), for tests / QA. */
  blendInWeight = 1;
  /** Current get-up weight (0 = frozen ragdoll pose, 1 = animated recovery), for tests / QA. */
  getUpWeight = 1;

  private bind(m: SkierModel): void {
    if (this.model === m) return;
    this.model = m;
    this.bones = m.skeleton.bones;
    const n = this.bones.length;
    this.parent = new Int16Array(n);
    this.group = new Uint8Array(n);
    this.animLocal = [];
    this.frozenQ = [];
    this.worldQ = [];
    this.blendQ = [];
    this.pathQ = [];
    for (let i = 0; i < n; i++) {
      const b = this.bones[i];
      this.parent[i] = b.parent ? this.bones.indexOf(b.parent as Bone) : -1;
      this.group[i] = groupOf(b.name);
      this.animLocal.push(new Quaternion());
      this.frozenQ.push(new Quaternion());
      this.worldQ.push(new Quaternion());
      this.blendQ.push(new Quaternion());
      this.pathQ.push(new Quaternion());
    }
    this.pelvisIndex = this.bones.indexOf(m.pelvis);
    this.probeBones = {
      skiL: m.skis[0],
      skiR: m.skis[1],
      shinL: m.shins[0],
      shinR: m.shins[1],
      head: m.head,
      chest: m.chest,
      pelvis: m.pelvis,
    };
    this.segInfo = null;
    this.hasLastPelvis = false;
    this.active = false;
    this.gettingUp = false;
  }

  private resolveSegments(info: readonly RagdollSegmentInfo[]): void {
    if (this.segInfo === info) return;
    this.segInfo = info;
    this.segBones = info.map((s) =>
      s.bones.map((name) => {
        const b = this.bones.find((x) => x.name === name);
        if (!b) throw new Error(`RagdollDriver: rig has no bone '${name}'`);
        return b;
      }),
    );
  }

  /** World rotation of the bones' common parent (root × body layer); updates the root's world matrix. */
  private rootWorld(m: SkierModel): Quaternion {
    m.body.updateWorldMatrix(true, false);
    m.body.matrixWorld.decompose(_v, _rootQ, _s);
    return _rootQ;
  }

  /** World rotations of all bones from their locals (parents first). */
  private chainWorld(rootQ: Quaternion, out: Quaternion[]): void {
    for (let i = 0; i < this.bones.length; i++) {
      const p = this.parent[i];
      out[i].copy(p < 0 ? rootQ : out[p]).multiply(this.bones[i].quaternion);
    }
  }

  /** Remembers the displayed pelvis after a normal (animated) frame, for the next blend in. */
  recordAnimated(m: SkierModel): void {
    this.bind(m);
    m.pelvis.matrixWorld.decompose(this.lastPelvisPos, this.lastPelvisQ, _s);
    this.hasLastPelvis = true;
  }

  /** Displays the ragdoll pose (blending in during the first RAGDOLL_BLEND_IN seconds). */
  drive(m: SkierModel, rd: SkierRagdollPose, dt: number): void {
    this.bind(m);
    this.resolveSegments(rd.info);
    const bones = this.bones;
    if (!this.active) {
      // Entry: snapshot the last animated pose.
      for (let i = 0; i < bones.length; i++) this.animLocal[i].copy(bones[i].quaternion);
      this.active = true;
      this.gettingUp = false;
      this.blendClock = 0;
      this.entryPending = this.hasLastPelvis;
    } else {
      this.blendClock += Math.max(0, dt);
    }

    // The ragdoll owns the whole body: no body-layer pose offsets.
    m.body.position.set(0, 0, 0);
    m.body.quaternion.identity();
    const rootQ = this.rootWorld(m);

    // Bones no segment drives (clavicles, hips) and the rigid extras rest.
    for (const b of bones) b.quaternion.identity();
    const info = rd.info;
    const n = Math.min(rd.count, info.length);
    for (let i = 0; i < n; i++) {
      const si = info[i];
      const parentQ = si.parent < 0 ? rootQ : rd.quaternions[si.parent];
      // rel = inverse(parentSegment) × segment
      _q.copy(parentQ).invert().multiply(rd.quaternions[i]);
      const driven = this.segBones[i];
      if (si.bones.length === 2 && si.kind !== 'shin') {
        // Split (spine + chest, neck + head): two equal halves compose to the full rotation.
        _q2.slerpQuaternions(IDENTITY, _q, 0.5);
        driven[0].quaternion.copy(_q2);
        driven[1].quaternion.copy(_q2);
      } else {
        driven[0].quaternion.copy(_q);
        // Rigid boot: the foot sits at the fixed boot lean in the shin; ski (and hand, pole) at rest.
        if (si.kind === 'shin' && driven.length > 1)
          driven[1].quaternion.setFromAxisAngle(X_AXIS, -rd.bootLean);
      }
    }

    // Pelvis: the segment's world transform through the root's actual world matrix.
    const pPos = rd.positions[0];
    const pQ = rd.quaternions[0];
    if (this.entryPending) {
      this.entryDPos.subVectors(this.lastPelvisPos, pPos);
      this.entryDQ.copy(this.lastPelvisQ).multiply(_q.copy(pQ).invert());
      this.entryPending = false;
    }
    const w = this.hasLastPelvis ? ramp(0, RAGDOLL_BLEND_IN, this.blendClock) : 1;
    this.blendInWeight = w;
    _v.copy(pPos);
    _q2.copy(pQ);
    if (w < 1) {
      _v.addScaledVector(this.entryDPos, 1 - w);
      _q2.premultiply(_q.slerpQuaternions(this.entryDQ, IDENTITY, w));
      for (let i = 0; i < bones.length; i++) {
        if (i === this.pelvisIndex) continue;
        // (slerpQuaternions would alias its target: blend from the snapshot towards the ragdoll local.)
        _q.copy(bones[i].quaternion);
        bones[i].quaternion.copy(this.animLocal[i]).slerp(_q, w);
      }
    }
    this.setPelvisWorld(m, rootQ, _v, _q2);
    m.root.updateMatrixWorld(true);

    // Frozen pose for the get-up: world rotations of every bone and the pelvis position.
    this.chainWorld(rootQ, this.frozenQ);
    m.pelvis.getWorldPosition(this.frozenPelvis);
    this.frozenVel.copy(rd.pelvisVelocity);
    this.lastPelvisPos.copy(this.frozenPelvis);
    this.lastPelvisQ.copy(this.frozenQ[this.pelvisIndex]);
    this.hasLastPelvis = true;
  }

  /** The ragdoll ended (recovery): start the get-up from the last displayed ragdoll pose. */
  beginGetUp(): void {
    if (!this.active) return;
    this.active = false;
    this.gettingUp = true;
    this.getUpFresh = true;
    this.getUpWeight = 0;
  }

  /**
   * Blends the animated pose that `SkierAnimator.apply` just put on the rig (world matrices up to date)
   * from the frozen ragdoll pose, in world space. `t` = seconds since the recovery.
   */
  applyGetUp(m: SkierModel, t: number): void {
    if (!this.gettingUp) return;
    this.bind(m);
    if (t >= GETUP_TIME) {
      this.gettingUp = false;
      this.getUpWeight = 1;
      return;
    }
    const tt = Math.max(0, t);
    const bones = this.bones;
    const rootQ = this.rootWorld(m);
    this.chainWorld(rootQ, this.worldQ);
    m.pelvis.getWorldPosition(_v);

    // Per bone: D = animated × inverse(frozen) (world), applied partially. Lying -> standing can be close
    // to a half turn, where the shortest arc flips as the target moves; instead the rotation keeps the
    // direction it started with (sign continuity of D, possibly the long way round). At the start every
    // large rotation turns the same way as the pelvis, so the limbs do not twist through each other.
    const pi = this.pelvisIndex;
    for (let i = 0; i < bones.length; i++) {
      const D = this.blendQ[i].copy(this.worldQ[i]).multiply(_q.copy(this.frozenQ[i]).invert());
      if (this.getUpFresh) {
        const ref = i === pi ? null : this.pathQ[pi];
        if (D.w < 0) quatNegate(D);
        // Large rotation (> ~110°): pick the turning direction of the pelvis.
        if (ref && D.w < 0.57 && D.x * ref.x + D.y * ref.y + D.z * ref.z < 0) quatNegate(D);
      } else if (quatDot(D, this.pathQ[i]) < 0) {
        quatNegate(D);
      }
      this.pathQ[i].copy(D);
      const [d, len] = GETUP_TIMING[this.group[i]];
      quatPowIdentity(D, ramp(d, d + len, tt)).multiply(this.frozenQ[i]);
    }
    for (let i = 0; i < bones.length; i++) {
      const p = this.parent[i];
      bones[i].quaternion
        .copy(p < 0 ? rootQ : this.blendQ[p])
        .invert()
        .multiply(this.blendQ[i]);
    }
    // Pelvis position: frozen (still sliding a little, decaying) -> animated.
    const wp = ramp(GETUP_PELVIS[0], GETUP_PELVIS[0] + GETUP_PELVIS[1], tt);
    const slide = GETUP_SLIDE_TAU * (1 - Math.exp(-tt / GETUP_SLIDE_TAU));
    _s.copy(this.frozenPelvis).addScaledVector(this.frozenVel, slide).lerp(_v, wp);
    this.setPelvisWorldPosition(m, _s);
    this.getUpWeight = ramp(0, GETUP_TIME, tt);
    m.root.updateMatrixWorld(true);

    // Ground clamp (root frame = the snow under the recovery point): as the legs fold under the body the
    // skis, knees or hands would sink into the snow; the body is pushed up instead. Any penetration the
    // frozen pose already had fades out instead of popping.
    const pen = this.snowPenetration(m);
    if (this.getUpFresh) {
      this.getUpPen0 = pen;
      this.getUpFresh = false;
      this.getUpLift = 0;
      this.getUpT = tt;
    }
    // Pushed up at a bounded speed (a short clip of a knee beats a hop), released freely.
    const target = Math.min(GETUP_MAX_LIFT, Math.max(0, pen - this.getUpPen0 * (1 - this.getUpWeight)));
    const lift = Math.min(target, this.getUpLift + GETUP_LIFT_SPEED * Math.max(0, tt - this.getUpT));
    this.getUpLift = lift;
    this.getUpT = tt;
    if (lift > 0) {
      const up = this.rootWorldQ(m);
      _s.add(_v.set(0, lift, 0).applyQuaternion(up));
      this.setPelvisWorldPosition(m, _s);
      m.root.updateMatrixWorld(true);
    }
  }

  /** Deepest probe below the root plane (m, >= 0). World matrices must be current. */
  private snowPenetration(m: SkierModel): number {
    const bones = this.probeBones!;
    _inv.copy(m.root.matrixWorld).invert();
    let pen = 0;
    for (let i = 0; i < GETUP_PROBES.length; i++) {
      const pr = GETUP_PROBES[i];
      bones[pr[0]].localToWorld(_v.set(pr[1], pr[2], pr[3])).applyMatrix4(_inv);
      pen = Math.max(pen, pr[4] - _v.y);
    }
    return pen;
  }

  private rootWorldQ(m: SkierModel): Quaternion {
    m.root.matrixWorld.decompose(_v, _q2, _v2);
    return _q2;
  }

  private setPelvisWorld(m: SkierModel, rootQ: Quaternion, pos: Vector3, q: Quaternion): void {
    m.pelvis.quaternion.copy(rootQ).invert().multiply(q);
    this.setPelvisWorldPosition(m, pos);
  }

  private setPelvisWorldPosition(m: SkierModel, pos: Vector3): void {
    _inv.copy(m.body.matrixWorld).invert();
    m.pelvis.position.copy(pos).applyMatrix4(_inv);
  }
}
