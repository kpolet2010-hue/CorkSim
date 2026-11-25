import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RAGDOLL_SEGMENT_INFO, SEG } from '../physics/Ragdoll';
import { BODY } from '../player/bodyDimensions';
import { GRAB_DEFINITIONS } from '../tricks/grabs';
import { createSkierPoseInput } from './poseFromSim';
import { GETUP_TIME, RAGDOLL_BLEND_IN, type SkierRagdollPose } from './skier/RagdollDriver';
import { SkierAnimator, type SkierPoseInput } from './SkierAnimator';
import { SkierModel } from './SkierModel';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const BOOT_LEAN = 0.3;
const N = RAGDOLL_SEGMENT_INFO.length;

/** Relative segment rotations (parent frame) of a test pose. */
type RelPose = Quaternion[];

function relPose(): RelPose {
  return Array.from({ length: N }, () => new Quaternion());
}

/** Bent legs, bent elbows, a curled spine and a turned head. */
function bentPose(): RelPose {
  const r = relPose();
  r[SEG.chest].setFromAxisAngle(X, 0.5).multiply(new Quaternion().setFromAxisAngle(Y, 0.3));
  r[SEG.head].setFromAxisAngle(X, -0.4);
  r[SEG.upperArmL].setFromAxisAngle(Z, 0.9);
  r[SEG.upperArmR].setFromAxisAngle(X, -0.7);
  r[SEG.forearmL].setFromAxisAngle(X, -1.1);
  r[SEG.forearmR].setFromAxisAngle(X, -0.4);
  r[SEG.thighL].setFromAxisAngle(X, -1.2);
  r[SEG.thighR].setFromAxisAngle(X, -0.3).multiply(new Quaternion().setFromAxisAngle(Z, -0.4));
  r[SEG.shinL].setFromAxisAngle(X, 1.4);
  r[SEG.shinR].setFromAxisAngle(X, 0.6);
  return r;
}

/** World segment transforms from a pelvis world transform and relative rotations (rigid chain). */
function fillRagdoll(out: SkierRagdollPose, pelvisPos: Vector3, pelvisQ: Quaternion, rel: RelPose): void {
  out.active = true;
  out.count = N;
  out.info = RAGDOLL_SEGMENT_INFO;
  out.bootLean = BOOT_LEAN;
  out.positions[0].copy(pelvisPos);
  out.quaternions[0].copy(pelvisQ).multiply(rel[0]);
  for (let i = 1; i < N; i++) {
    const info = RAGDOLL_SEGMENT_INFO[i];
    const pq = out.quaternions[info.parent];
    out.quaternions[i].copy(pq).multiply(rel[i]);
    out.positions[i]
      .set(info.origin.x, info.origin.y, info.origin.z)
      .applyQuaternion(pq)
      .add(out.positions[info.parent]);
  }
}

/** Puts the model root where the simulation puts it while CRASHED: pelvis × inverse(rest offset). */
function rootFromPelvis(m: SkierModel, pelvisPos: Vector3, pelvisQ: Quaternion): void {
  m.root.quaternion.copy(pelvisQ);
  m.root.position.set(0, -BODY.pelvisHeight, 0).applyQuaternion(pelvisQ).add(pelvisPos);
  m.root.updateMatrixWorld(true);
}

function setup() {
  const model = new SkierModel();
  model.root.position.set(2, 5, -3);
  model.root.updateMatrixWorld(true);
  return { model, anim: new SkierAnimator(), p: createSkierPoseInput() };
}

function step(m: SkierModel, a: SkierAnimator, p: SkierPoseInput, dt = 1 / 60): void {
  p.time += dt;
  p.timeInState += dt;
  a.update(m, p, dt);
}

function snapshot(m: SkierModel): { q: Quaternion[]; pos: Vector3[]; local: Quaternion[]; lpos: Vector3[] } {
  m.root.updateMatrixWorld(true);
  return {
    q: m.skeleton.bones.map((b) => b.getWorldQuaternion(new Quaternion())),
    pos: m.skeleton.bones.map((b) => b.getWorldPosition(new Vector3())),
    local: m.skeleton.bones.map((b) => b.quaternion.clone()),
    lpos: m.skeleton.bones.map((b) => b.position.clone()),
  };
}

function maxChange(
  a: ReturnType<typeof snapshot>,
  b: ReturnType<typeof snapshot>,
): { rot: number; pos: number } {
  let rot = 0;
  let pos = 0;
  for (let i = 0; i < a.q.length; i++) {
    rot = Math.max(rot, a.q[i].angleTo(b.q[i]));
    pos = Math.max(pos, a.pos[i].distanceTo(b.pos[i]));
  }
  return { rot, pos };
}

function expectQuat(actual: Quaternion, expected: Quaternion, eps = 1e-6, label = ''): void {
  expect(actual.angleTo(expected), label).toBeLessThan(eps);
}

/** Ragdoll lying on its back (pelvis pitched back 90°, legs slightly bent), pelvis 0.14 m above y0. */
function lyingPose(base: Vector3): { pos: Vector3; q: Quaternion; rel: RelPose } {
  const rel = relPose();
  rel[SEG.thighL].setFromAxisAngle(X, -0.4);
  rel[SEG.thighR].setFromAxisAngle(X, -0.2);
  rel[SEG.shinL].setFromAxisAngle(X, 0.6);
  rel[SEG.shinR].setFromAxisAngle(X, 0.3);
  rel[SEG.upperArmL].setFromAxisAngle(Z, 1.1);
  rel[SEG.upperArmR].setFromAxisAngle(Z, -1.1);
  return {
    pos: base.clone().add(new Vector3(0, 0.14, 0)),
    q: new Quaternion().setFromAxisAngle(Y, 2.4).multiply(new Quaternion().setFromAxisAngle(X, -Math.PI / 2)),
    rel,
  };
}

describe('SkierAnimator ragdoll display', () => {
  it('derives every bone from the segments: bent legs stay bent, the ski is rigid with the shin', () => {
    const { model: m, anim, p } = setup();
    p.state = 'CRASHED';
    p.previousState = 'RIDING';
    const pelvisPos = new Vector3(4, 3, 7);
    const pelvisQ = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, -0.5).normalize(), 1.9);
    const rel = bentPose();
    fillRagdoll(p.ragdoll, pelvisPos, pelvisQ, rel);
    rootFromPelvis(m, pelvisPos, pelvisQ);
    for (let i = 0; i < 12; i++) step(m, anim, p); // past the blend in
    expect(anim.ragdollActive).toBe(true);
    expect(anim.ragdollBlendIn).toBe(1);

    const half = (q: Quaternion) => new Quaternion().slerpQuaternions(new Quaternion(), q, 0.5);
    expectQuat(m.thighs[0].quaternion, rel[SEG.thighL], 1e-6, 'thighL');
    expectQuat(m.thighs[1].quaternion, rel[SEG.thighR], 1e-6, 'thighR');
    expectQuat(m.shins[0].quaternion, rel[SEG.shinL], 1e-6, 'shinL');
    expectQuat(m.shins[1].quaternion, rel[SEG.shinR], 1e-6, 'shinR');
    expectQuat(m.upperArms[0].quaternion, rel[SEG.upperArmL], 1e-6, 'upperArmL');
    expectQuat(m.forearms[1].quaternion, rel[SEG.forearmR], 1e-6, 'forearmR');
    expectQuat(m.spine.quaternion, half(rel[SEG.chest]), 1e-6, 'spine');
    expectQuat(m.chest.quaternion, half(rel[SEG.chest]), 1e-6, 'chest');
    expectQuat(m.neck.quaternion, half(rel[SEG.head]), 1e-6, 'neck');
    expectQuat(m.head.quaternion, half(rel[SEG.head]), 1e-6, 'head');
    const boot = new Quaternion().setFromAxisAngle(X, -BOOT_LEAN);
    for (let i = 0; i < 2; i++) {
      expectQuat(m.feet[i].quaternion, boot, 1e-6, 'foot');
      expectQuat(m.skis[i].quaternion, new Quaternion(), 1e-6, 'ski');
      expectQuat(m.hands[i].quaternion, new Quaternion(), 1e-6, 'hand');
      expectQuat(m.poles[i].quaternion, new Quaternion(), 1e-6, 'pole');
      expectQuat(m.hips[i].quaternion, new Quaternion(), 1e-6, 'hip');
      expectQuat(m.shoulders[i].quaternion, new Quaternion(), 1e-6, 'clavicle');
    }

    const s = snapshot(m);
    const bi = (b: object) => m.skeleton.bones.indexOf(b as never);
    // World transforms equal the segments (pelvis and legs: exact, no stretch).
    expect(s.pos[bi(m.pelvis)].distanceTo(p.ragdoll.positions[SEG.pelvis])).toBeLessThan(1e-6);
    expectQuat(s.q[bi(m.pelvis)], p.ragdoll.quaternions[SEG.pelvis], 1e-6, 'pelvis world');
    for (const [seg, bone] of [
      [SEG.thighL, m.thighs[0]],
      [SEG.thighR, m.thighs[1]],
      [SEG.shinL, m.shins[0]],
      [SEG.shinR, m.shins[1]],
    ] as const) {
      expect(s.pos[bi(bone)].distanceTo(p.ragdoll.positions[seg]), `${bone.name} joint`).toBeLessThan(1e-6);
      expectQuat(s.q[bi(bone)], p.ragdoll.quaternions[seg], 1e-6, `${bone.name} world`);
    }
    // The ski follows the shin: world rotation = shin × Rx(-bootLean), position = the rigid boot offset.
    for (const [seg, i] of [
      [SEG.shinL, 0],
      [SEG.shinR, 1],
    ] as const) {
      const shinQ = p.ragdoll.quaternions[seg];
      expectQuat(s.q[bi(m.skis[i])], shinQ.clone().multiply(boot), 1e-6, 'ski world');
      const expected = new Vector3(0, BODY.skiOffsetY, BODY.skiOffsetZ)
        .applyQuaternion(boot)
        .add(new Vector3(0, -BODY.shin, 0))
        .applyQuaternion(shinQ)
        .add(p.ragdoll.positions[seg]);
      expect(s.pos[bi(m.skis[i])].distanceTo(expected)).toBeLessThan(1e-6);
    }
    // The knees are visibly bent (not the ski stance): thigh vs shin direction.
    const kneeAngle = (i: 0 | 1) => {
      const a = new Vector3(0, -1, 0).applyQuaternion(s.q[bi(m.thighs[i])]);
      const b = new Vector3(0, -1, 0).applyQuaternion(s.q[bi(m.shins[i])]);
      return a.angleTo(b);
    };
    expect(kneeAngle(0)).toBeCloseTo(1.4, 5);
    expect(kneeAngle(1)).toBeCloseTo(0.6, 5);
    // Upper arms hang off the chest bone; the spine/chest split moves the shoulder a few cm at most.
    expect(s.pos[bi(m.upperArms[0])].distanceTo(p.ragdoll.positions[SEG.upperArmL])).toBeLessThan(0.08);
    // Bone positions stay at the rig offsets (except the pelvis, placed by the segment).
    const rest = new SkierModel();
    for (let i = 0; i < m.skeleton.bones.length; i++) {
      if (m.skeleton.bones[i] === m.pelvis) continue;
      expect(s.lpos[i].distanceTo(rest.skeleton.bones[i].position)).toBe(0);
    }
    rest.dispose();
    m.dispose();
  });

  it('the normal pipeline never touches ragdoll-driven bones', () => {
    const { model: m, anim, p } = setup();
    p.state = 'CRASHED';
    const pelvisPos = new Vector3(1, 2, 3);
    const pelvisQ = new Quaternion().setFromAxisAngle(X, 1.2);
    fillRagdoll(p.ragdoll, pelvisPos, pelvisQ, bentPose());
    rootFromPelvis(m, pelvisPos, pelvisQ);
    for (let i = 0; i < 10; i++) step(m, anim, p);
    const a = snapshot(m);
    // Everything the animation layers react to changes; the ragdoll pose does not.
    p.grab = GRAB_DEFINITIONS[0];
    p.grabBlend = 1;
    p.edgeAngle = 0.8;
    p.groundGap = 0.3;
    p.landingCompression = 1;
    p.localSpin = 6;
    p.localFlip = -4;
    p.speed = 20;
    p.brake = 1;
    p.railBalance = 1;
    for (let i = 0; i < 3; i++) step(m, anim, p, i === 1 ? 1 / 144 : 1 / 30);
    const b = snapshot(m);
    for (let i = 0; i < a.q.length; i++) {
      expect(b.local[i].equals(a.local[i]), m.skeleton.bones[i].name).toBe(true);
      expect(b.lpos[i].equals(a.lpos[i]), m.skeleton.bones[i].name).toBe(true);
    }
    expect(m.body.position.lengthSq()).toBe(0);
    expect(m.body.quaternion.equals(new Quaternion())).toBe(true);
    expect(anim.grabError).toBe(0);
    m.dispose();
  });

  it('blends into the ragdoll without a pop, hiding the root jump of the crouched stance', () => {
    const { model: m, anim, p } = setup();
    m.root.position.set(0, 0, 0);
    m.root.quaternion.identity();
    m.root.updateMatrixWorld(true);
    p.state = 'RIDING';
    p.speed = 8;
    for (let i = 0; i < 60; i++) step(m, anim, p);
    // Crash: the ragdoll starts crouched, so the root (pelvis × inverse rest offset) drops ~0.17 m.
    const before = snapshot(m);
    p.previousState = p.state;
    p.state = 'CRASHED';
    p.timeInState = 0;
    const pelvisQ = new Quaternion().setFromAxisAngle(X, 0.35);
    const pelvisPos = new Vector3(0, BODY.pelvisHeight - 0.17, 0.02);
    const rel = bentPose();
    fillRagdoll(p.ragdoll, pelvisPos, pelvisQ, rel);
    rootFromPelvis(m, pelvisPos, pelvisQ);
    step(m, anim, p);
    // First ragdoll frame: still the animated pose (no snap, even though the root jumped).
    expect(maxChange(before, snapshot(m)).rot).toBeLessThan(0.02);
    expect(maxChange(before, snapshot(m)).pos).toBeLessThan(0.02);
    let prev = snapshot(m);
    let maxRot = 0;
    let maxPos = 0;
    for (let i = 0; i < 20; i++) {
      step(m, anim, p);
      const cur = snapshot(m);
      const c = maxChange(prev, cur);
      maxRot = Math.max(maxRot, c.rot);
      maxPos = Math.max(maxPos, c.pos);
      prev = cur;
    }
    const total = maxChange(before, prev);
    expect(total.rot).toBeGreaterThan(1); // the poses really differ
    // Spread over the blend (smoothstep, ~6 frames): no frame carries more than a third of the change.
    expect(maxRot).toBeLessThan(total.rot * 0.34);
    expect(maxPos).toBeLessThan(total.pos * 0.5);
    expect(anim.ragdollBlendIn).toBe(1);
    // Done blending: exactly the ragdoll.
    expect(m.pelvis.getWorldPosition(new Vector3()).distanceTo(pelvisPos)).toBeLessThan(1e-6);
    expect(Math.round(RAGDOLL_BLEND_IN * 100)).toBe(10);
    m.dispose();
  });

  it.each([
    ['at rest', 0],
    ['still sliding at 3 m/s (time cap)', 3],
  ])('gets up from the last ragdoll pose without a jump (%s)', (_label, slide) => {
    const { model: m, anim, p } = setup();
    const base = new Vector3(5, 2, 9);
    const lie = lyingPose(base);
    p.state = 'CRASHED';
    p.previousState = 'AIRBORNE';
    fillRagdoll(p.ragdoll, lie.pos, lie.q, lie.rel);
    p.ragdoll.pelvisVelocity.set(0, 0, slide);
    rootFromPelvis(m, lie.pos, lie.q);
    for (let i = 0; i < 60; i++) step(m, anim, p);
    const frozen = snapshot(m);

    // recover(): ragdoll gone, the root stands upright at the pelvis x/z on the snow, facing downhill.
    p.ragdoll.active = false;
    p.previousState = 'CRASHED';
    p.state = 'IDLE';
    p.timeInState = 0;
    p.speed = 0;
    m.root.position.set(base.x + 0, base.y, base.z);
    m.root.quaternion.identity();
    m.root.updateMatrixWorld(true);
    step(m, anim, p);
    expect(anim.gettingUp).toBe(true);
    const first = maxChange(frozen, snapshot(m));
    expect(first.rot).toBeLessThan(0.02);
    expect(first.pos).toBeLessThan(0.02 + slide / 60);

    let prev = snapshot(m);
    let maxRot = 0;
    let maxPos = 0;
    let maxPelvis = 0;
    const pi = m.skeleton.bones.indexOf(m.pelvis);
    const frames = Math.round((GETUP_TIME + 1.6) * 60);
    for (let i = 0; i < frames; i++) {
      step(m, anim, p);
      const cur = snapshot(m);
      const c = maxChange(prev, cur);
      maxRot = Math.max(maxRot, c.rot);
      maxPos = Math.max(maxPos, c.pos);
      maxPelvis = Math.max(maxPelvis, prev.pos[pi].distanceTo(cur.pos[pi]));
      prev = cur;
    }
    // Lying on the back to standing (a half turn for some limbs) in 0.8 s: limbs swing at up to
    // ~15 rad/s (0.25 rad per 60 Hz frame); a pop or a shortest-arc flip is 0.5 rad and more.
    expect(maxRot).toBeLessThan(0.25);
    // Hands and ski tips swing (up to ~9 m/s at the extremities), the body itself rises smoothly.
    expect(maxPos).toBeLessThan(0.16);
    // The body rises at up to ~2.7 m/s (blend + bounded push-up lift): brisk, never a hop.
    expect(maxPelvis).toBeLessThan(0.045 + slide / 60);
    expect(anim.gettingUp).toBe(false);
    // Standing on the skis again.
    expect(anim.footError).toBeLessThan(0.01);
    const ski = m.root.worldToLocal(m.skis[0].getWorldPosition(new Vector3()));
    expect(Math.abs(ski.y)).toBeLessThan(0.05);
    expect(m.root.worldToLocal(m.pelvis.getWorldPosition(new Vector3())).y).toBeGreaterThan(0.8);
    m.dispose();
  });

  it('the get-up passes through the recovery crouch (hands on knees) before standing', () => {
    const { model: m, anim, p } = setup();
    const base = new Vector3(0, 0, 0);
    const lie = lyingPose(base);
    p.state = 'CRASHED';
    fillRagdoll(p.ragdoll, lie.pos, lie.q, lie.rel);
    rootFromPelvis(m, lie.pos, lie.q);
    for (let i = 0; i < 30; i++) step(m, anim, p);
    p.ragdoll.active = false;
    p.previousState = 'CRASHED';
    p.state = 'IDLE';
    p.timeInState = 0;
    m.root.position.copy(base);
    m.root.quaternion.identity();
    m.root.updateMatrixWorld(true);
    const heights: number[] = [];
    for (let i = 0; i < 150; i++) {
      step(m, anim, p);
      heights.push(m.root.worldToLocal(m.pelvis.getWorldPosition(new Vector3())).y);
    }
    // Rises from the snow, holds low around the end of the blend, then stands up.
    expect(heights[0]).toBeLessThan(0.2);
    expect(heights[Math.round(GETUP_TIME * 60)]).toBeLessThan(0.75);
    expect(heights[149]).toBeGreaterThan(0.8);
    for (let i = 1; i < heights.length; i++)
      expect(Math.abs(heights[i] - heights[i - 1])).toBeLessThan(0.045);
    m.dispose();
  });
  it('leaves non-crash poses untouched by (inactive) ragdoll data', () => {
    const a = setup();
    const b = setup();
    fillRagdoll(b.p.ragdoll, new Vector3(9, 9, 9), new Quaternion().setFromAxisAngle(X, 2), bentPose());
    b.p.ragdoll.active = false;
    for (const [state, edge] of [
      ['RIDING', 0],
      ['CARVING', 0.7],
      ['AIRBORNE', 0],
      ['LANDING', 0],
      ['RAIL_GRINDING', 0],
    ] as const) {
      for (const x of [a, b]) {
        x.p.previousState = x.p.state;
        x.p.state = state;
        x.p.timeInState = 0;
        x.p.edgeAngle = edge;
        x.p.speed = 10;
        x.p.railStance = state === 'RAIL_GRINDING' ? 'slide' : null;
      }
      for (let i = 0; i < 30; i++) {
        step(a.model, a.anim, a.p);
        step(b.model, b.anim, b.p);
      }
      const sa = snapshot(a.model);
      const sb = snapshot(b.model);
      for (let i = 0; i < sa.local.length; i++) {
        expect(sb.local[i].equals(sa.local[i]), state).toBe(true);
        expect(sb.lpos[i].equals(sa.lpos[i]), state).toBe(true);
      }
    }
    expect(b.anim.ragdollActive).toBe(false);
    a.model.dispose();
    b.model.dispose();
  });
});
