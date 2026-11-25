import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createSkierPoseInput } from './poseFromSim';
import { LOOK_MAX, SkierAnimator, softLimit, stepLookSpring, type SkierPoseInput } from './SkierAnimator';
import { SkierModel } from './SkierModel';

const BACK = Math.PI;
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');

function setup() {
  const model = new SkierModel();
  model.root.position.set(1, 4, -2);
  model.root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  model.root.updateMatrixWorld(true);
  const p = createSkierPoseInput();
  p.state = 'RIDING';
  p.previousState = 'RIDING';
  p.speed = 10;
  return { model, anim: new SkierAnimator(), p };
}

function step(model: SkierModel, anim: SkierAnimator, p: SkierPoseInput, dt: number): void {
  p.time += dt;
  p.timeInState += dt;
  anim.update(model, p, dt);
}

function run(model: SkierModel, anim: SkierAnimator, p: SkierPoseInput, seconds: number, dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(model, anim, p, dt);
}

/** Yaw of the head's forward axis seen from `ref` (rad, > 0 = towards the left / +X). */
function headYawIn(model: SkierModel, ref: Object3D): number {
  ref.getWorldQuaternion(_q2).invert();
  model.head.getWorldQuaternion(_q);
  _v.set(0, 0, 1).applyQuaternion(_q).applyQuaternion(_q2);
  return Math.atan2(_v.x, _v.z);
}

function localYaw(o: Object3D): number {
  return _e.setFromQuaternion(o.quaternion, 'YXZ').y;
}

function snapshot(model: SkierModel): number[] {
  const out: number[] = [];
  for (const b of model.skeleton.bones) {
    out.push(
      b.quaternion.x,
      b.quaternion.y,
      b.quaternion.z,
      b.quaternion.w,
      b.position.x,
      b.position.y,
      b.position.z,
    );
  }
  return out;
}

describe('SkierAnimator switch look-back', () => {
  it('leaves forward riding untouched: travelYaw has no effect while not switch', () => {
    const a = setup();
    const b = setup();
    for (const [state, edge] of [
      ['RIDING', 0],
      ['CARVING', 0.6],
      ['CARVING', -0.8],
      ['BRAKING', 0.3],
      ['IDLE', 0],
    ] as const) {
      for (const s of [a, b]) {
        s.p.state = state;
        s.p.edgeAngle = edge;
        s.p.brake = state === 'BRAKING' ? 1 : 0;
      }
      for (let i = 0; i < 60; i++) {
        b.p.travelYaw = Math.sin(i * 0.37) * 0.3;
        step(a.model, a.anim, a.p, 1 / 60);
        step(b.model, b.anim, b.p, 1 / 60);
      }
      expect(snapshot(b.model)).toEqual(snapshot(a.model));
    }
    a.model.dispose();
    b.model.dispose();
  });

  it('looks back a long way when travelling straight back, within every joint limit', () => {
    const { model, anim, p } = setup();
    p.switchStance = true;
    p.travelYaw = BACK;
    run(model, anim, p, 2.5);
    const rel = Math.abs(headYawIn(model, model.pelvis));
    expect(rel).toBeGreaterThan((100 * Math.PI) / 180);
    // Total turn relative to the skis (body) is the full look.
    expect(Math.abs(headYawIn(model, model.body))).toBeGreaterThan(1.85);
    expect(Math.abs(headYawIn(model, model.body))).toBeLessThan(LOOK_MAX + 0.1);
    expect(Math.abs(localYaw(model.pelvis))).toBeLessThan(0.25);
    expect(Math.abs(localYaw(model.spine))).toBeLessThan(0.4);
    expect(Math.abs(localYaw(model.chest))).toBeLessThan(0.4);
    expect(Math.abs(localYaw(model.neck))).toBeLessThan(0.72);
    expect(Math.abs(localYaw(model.head))).toBeLessThan(0.72);
    expect(anim.footError).toBeLessThan(0.01);
    model.dispose();
  });

  it('chooses the shoulder from the travel side, with hysteresis around straight back', () => {
    const { model, anim, p } = setup();
    p.switchStance = true;
    p.travelYaw = BACK - 0.5; // behind-left
    run(model, anim, p, 2);
    expect(headYawIn(model, model.body)).toBeGreaterThan(1.5);
    // Slightly to the right of straight back (about 9 degrees): keep the left shoulder.
    p.travelYaw = -(BACK - 0.15);
    run(model, anim, p, 2);
    expect(headYawIn(model, model.body)).toBeGreaterThan(1.5);
    // Clearly behind-right: swap to the right shoulder.
    p.travelYaw = -(BACK - 0.5);
    run(model, anim, p, 2);
    expect(headYawIn(model, model.body)).toBeLessThan(-1.5);
    // Straight back (or unknown travel direction): keep the last shoulder.
    p.travelYaw = BACK;
    run(model, anim, p, 1);
    expect(headYawIn(model, model.body)).toBeLessThan(-1.5);
    p.travelYaw = 0;
    run(model, anim, p, 1);
    expect(headYawIn(model, model.body)).toBeLessThan(-1.5);
    model.dispose();

    // A fresh skier travelling behind-right looks over the right shoulder straight away.
    const s = setup();
    s.p.switchStance = true;
    s.p.travelYaw = -(BACK - 0.5);
    run(s.model, s.anim, s.p, 2);
    expect(headYawIn(s.model, s.model.body)).toBeLessThan(-1.5);
    s.model.dispose();
  });

  it('keeps a readable look-back while carving switch, over the inside shoulder', () => {
    const { model, anim, p } = setup();
    p.switchStance = true;
    p.travelYaw = BACK;
    p.state = 'CARVING';
    for (const edge of [0.6, -0.6, 0.9]) {
      p.edgeAngle = edge;
      run(model, anim, p, 2);
      const yaw = headYawIn(model, model.body);
      expect(Math.sign(yaw)).toBe(Math.sign(edge));
      expect(Math.abs(yaw)).toBeGreaterThan(1.5);
      expect(Math.abs(localYaw(model.neck))).toBeLessThan(0.72);
      expect(Math.abs(localYaw(model.head))).toBeLessThan(0.72);
      expect(anim.footError).toBeLessThan(0.01);
    }
    model.dispose();
  });

  it.each([30, 60, 144])('turns the head smoothly on switch on/off and shoulder swaps at %i fps', (fps) => {
    const dt = 1 / fps;
    const { model, anim, p } = setup();
    let prev = headYawIn(model, model.root);
    let maxJump = 0;
    const track = (seconds: number): void => {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        step(model, anim, p, dt);
        const y = headYawIn(model, model.root);
        maxJump = Math.max(maxJump, Math.abs(y - prev));
        prev = y;
      }
    };
    track(0.5);
    p.switchStance = true;
    p.travelYaw = BACK - 0.5;
    track(1.5);
    // Shoulder swap, measured from the last frame over the left shoulder to the first over the right.
    p.travelYaw = -(BACK - 0.5);
    let tLeft = 0;
    let tRight = -1;
    for (let t = 0; t < 2; t += dt) {
      step(model, anim, p, dt);
      const y = headYawIn(model, model.root);
      maxJump = Math.max(maxJump, Math.abs(y - prev));
      prev = y;
      if (y > 1.4) tLeft = t;
      if (tRight < 0 && y < -1.4) tRight = t;
    }
    const sweep = tRight - tLeft;
    expect(sweep).toBeGreaterThan(0.35);
    expect(sweep).toBeLessThan(0.75);
    // State changes while switch: carve, brake, landing, idle.
    for (const [state, edge] of [
      ['CARVING', 0.7],
      ['BRAKING', -0.3],
      ['LANDING', 0],
      ['IDLE', 0],
      ['RIDING', 0],
    ] as const) {
      p.previousState = p.state;
      p.state = state;
      p.timeInState = 0;
      p.edgeAngle = edge;
      p.brake = state === 'BRAKING' ? 1 : 0;
      p.landingCompression = state === 'LANDING' ? 0.4 : 0;
      p.speed = state === 'IDLE' ? 0.5 : 10;
      track(0.8);
    }
    p.switchStance = false;
    p.travelYaw = 0;
    track(2);
    // Whole-look rate limit is 7 rad/s; allow for the follow-through of the final smoothing stage.
    expect(maxJump).toBeLessThan(Math.max(8 * dt, 0.03));
    model.dispose();
  });

  it('returns exactly to the approved forward stance after riding switch', () => {
    const a = setup();
    const b = setup();
    run(a.model, a.anim, a.p, 1);
    b.p.switchStance = true;
    b.p.travelYaw = BACK;
    run(b.model, b.anim, b.p, 1);
    b.p.switchStance = false;
    b.p.travelYaw = 0;
    run(a.model, a.anim, a.p, 4);
    run(b.model, b.anim, b.p, 4);
    const sa = snapshot(a.model);
    const sb = snapshot(b.model);
    for (let i = 0; i < sa.length; i++) expect(sb[i]).toBeCloseTo(sa[i], 5);
    a.model.dispose();
    b.model.dispose();
  });

  it('is deterministic: the same inputs and dt give the identical pose', () => {
    const a = setup();
    const b = setup();
    const dts = [1 / 60, 1 / 144, 1 / 30, 1 / 75];
    for (let i = 0; i < 400; i++) {
      const dt = dts[i % dts.length];
      for (const s of [a, b]) {
        s.p.switchStance = i > 40 && i < 300;
        s.p.travelYaw = s.p.switchStance ? BACK - Math.sin(i * 0.05) * 0.8 : 0;
        s.p.state = i % 120 < 60 ? 'RIDING' : 'CARVING';
        s.p.edgeAngle = s.p.state === 'CARVING' ? Math.sin(i * 0.03) * 0.7 : 0;
        step(s.model, s.anim, s.p, dt);
      }
    }
    expect(snapshot(b.model)).toEqual(snapshot(a.model));
    a.model.dispose();
    b.model.dispose();
  });

  it('does not look back in the air or on a rail', () => {
    const { model, anim, p } = setup();
    p.switchStance = true;
    p.travelYaw = BACK;
    run(model, anim, p, 2);
    p.state = 'AIRBORNE';
    p.previousState = 'RIDING';
    p.timeInState = 0;
    run(model, anim, p, 3);
    expect(Math.abs(localYaw(model.pelvis))).toBeLessThan(1e-6);
    model.dispose();
  });
});

describe('look helpers', () => {
  it('softLimit is the identity below the knee, continuous and bounded above it', () => {
    expect(softLimit(0.7, 1.15, 1.4)).toBe(0.7);
    expect(softLimit(-1.15, 1.15, 1.4)).toBe(-1.15);
    expect(softLimit(1.150001, 1.15, 1.4)).toBeCloseTo(1.150001, 5);
    expect(softLimit(5, 1.15, 1.4)).toBeLessThan(1.4);
    expect(softLimit(-5, 1.15, 1.4)).toBeGreaterThan(-1.4);
  });

  it('stepLookSpring is rate limited, frame-rate independent and settles exactly on zero', () => {
    const a = { x: 0, v: 0 };
    const b = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) stepLookSpring(a, 2, 1 / 30);
    for (let i = 0; i < 144; i++) stepLookSpring(b, 2, 1 / 144);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
    const c = { x: 2, v: 0 };
    for (let i = 0; i < 600; i++) {
      const x0 = c.x;
      stepLookSpring(c, -2, 1 / 60);
      expect(Math.abs(c.x - x0)).toBeLessThanOrEqual((7 / 60) * (1 + 1e-9));
    }
    for (let i = 0; i < 600; i++) stepLookSpring(c, 0, 1 / 60);
    expect(c.x).toBe(0);
    expect(c.v).toBe(0);
  });
});
