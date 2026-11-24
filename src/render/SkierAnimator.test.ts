import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAB_DEFINITIONS } from '../tricks/grabs';
import { createSkierPoseInput } from './poseFromSim';
import { SkierAnimator, type SkierPoseInput } from './SkierAnimator';
import { RIG, SkierModel } from './SkierModel';

function run(model: SkierModel, anim: SkierAnimator, p: SkierPoseInput, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    p.time += dt;
    p.timeInState += dt;
    anim.update(model, p, dt);
  }
}

function allFinite(model: SkierModel): boolean {
  const v = new Vector3();
  const q = new Quaternion();
  for (const b of model.skeleton.bones) {
    b.getWorldPosition(v);
    b.getWorldQuaternion(q);
    if (!Number.isFinite(v.x + v.y + v.z + q.x + q.y + q.z + q.w)) return false;
  }
  return true;
}

function setup(rootPos = new Vector3(3, 10, -4), yaw = 0.7) {
  const model = new SkierModel();
  model.root.position.copy(rootPos);
  model.root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  model.root.updateMatrixWorld(true);
  return { model, anim: new SkierAnimator(), p: createSkierPoseInput() };
}

describe('SkierAnimator', () => {
  it('keeps the skis on the physics ski points while riding and carving', () => {
    const { model, anim, p } = setup();
    p.state = 'RIDING';
    p.speed = 12;
    for (const edge of [0, 0.5, -0.9]) {
      p.edgeAngle = edge;
      p.state = edge === 0 ? 'RIDING' : 'CARVING';
      run(model, anim, p, 1.2);
      expect(allFinite(model)).toBe(true);
      expect(anim.footError).toBeLessThan(0.01);
      for (let i = 0; i < 2; i++) {
        const local = model.root.worldToLocal(model.skis[i].getWorldPosition(new Vector3()));
        expect(local.x).toBeCloseTo((i === 0 ? 1 : -1) * RIG.stance, 2);
        expect(Math.abs(local.z)).toBeLessThan(0.01);
        // Base on the snow (the edged ski pivots on its inside edge, so its centre lifts a little).
        expect(local.y).toBeGreaterThan(-0.005);
        expect(local.y).toBeLessThan(0.05);
      }
    }
    model.dispose();
  });

  it.each([
    ['plain', 0, 1.5],
    ['spinning into the landing', 5, 0.3],
  ])('lets every catalogue grab reach the actual ski point of the grab type (%s)', (_label, spin, impact) => {
    for (const def of GRAB_DEFINITIONS) {
      const { model, anim, p } = setup();
      p.state = 'AIRBORNE';
      p.previousState = 'RIDING';
      p.airTime = 0.4;
      p.timeInState = 0.4;
      p.impactTime = impact;
      p.localSpin = spin;
      run(model, anim, p, 0.3);
      p.grab = def;
      p.grabBlend = 1;
      run(model, anim, p, 1.0);
      expect(allFinite(model)).toBe(true);
      expect(anim.grabError, `${def.id} grab error`).toBeLessThan(0.025);
      // Glove (palm) really at the ski grab point.
      for (const t of def.targets) {
        const hi = t.hand === 'left' ? 0 : 1;
        const si = t.ski === 'left' ? 0 : 1;
        const grab = new Vector3((si === 0 ? 1 : -1) * t.edge * 0.055, 0.05, t.along * RIG.skiLength * 0.45);
        model.skis[si].localToWorld(grab);
        const palm = new Vector3(0, -0.065, 0);
        model.hands[hi].localToWorld(palm);
        expect(palm.distanceTo(grab), `${def.id} palm-to-ski`).toBeLessThan(0.04);
      }
      model.dispose();
    }
  });

  it('never produces NaN across a full state sequence at variable frame rates', () => {
    const { model, anim, p } = setup();
    const seq: [SkierPoseInput['state'], number][] = [
      ['IDLE', 0.5],
      ['RIDING', 0.5],
      ['CARVING', 0.5],
      ['BRAKING', 0.5],
      ['JUMP_CHARGING', 0.4],
      ['AIRBORNE', 1.2],
      ['LANDING', 0.3],
      ['RAIL_GRINDING', 0.8],
      ['AIRBORNE', 0.4],
      ['CRASHED', 1.5],
      ['IDLE', 1.2],
    ];
    let dt = 1 / 144;
    for (const [state, secs] of seq) {
      p.previousState = p.state;
      p.state = state;
      p.timeInState = 0;
      p.localSpin = state === 'AIRBORNE' ? 6 : 0;
      p.localFlip = state === 'AIRBORNE' ? -4 : 0;
      p.spinRate = state === 'CRASHED' ? 5 : 0;
      p.railStance = state === 'RAIL_GRINDING' ? 'slide' : null;
      p.railStanceYaw = state === 'RAIL_GRINDING' ? Math.PI / 2 : 0;
      p.railBalance = state === 'RAIL_GRINDING' ? 0.6 : 0;
      p.landingCompression = state === 'LANDING' ? 1 : 0;
      p.landingQuality = 'sketchy';
      p.brake = state === 'BRAKING' ? 1 : 0;
      p.charge = state === 'JUMP_CHARGING' ? 0.8 : 0;
      p.speed = state === 'IDLE' ? 0 : 10;
      run(model, anim, p, secs, dt);
      expect(allFinite(model), state).toBe(true);
      dt = dt === 1 / 144 ? 1 / 30 : 1 / 144;
    }
    model.dispose();
  });

  it('has no pops: the pelvis moves continuously across state changes', () => {
    const { model, anim, p } = setup(new Vector3(), 0);
    p.state = 'RIDING';
    p.speed = 10;
    run(model, anim, p, 1);
    const prev = new Vector3();
    const cur = new Vector3();
    model.pelvis.getWorldPosition(prev);
    let maxStep = 0;
    for (const state of ['JUMP_CHARGING', 'AIRBORNE', 'LANDING', 'RIDING'] as const) {
      p.previousState = p.state;
      p.state = state;
      p.timeInState = 0;
      p.landingCompression = state === 'LANDING' ? 0.6 : 0;
      for (let i = 0; i < 30; i++) {
        p.time += 1 / 60;
        p.timeInState += 1 / 60;
        anim.update(model, p, 1 / 60);
        model.pelvis.getWorldPosition(cur);
        maxStep = Math.max(maxStep, cur.distanceTo(prev));
        prev.copy(cur);
      }
    }
    // < 4 cm per 60 Hz frame (2.4 m/s), i.e. no teleporting joints.
    expect(maxStep).toBeLessThan(0.04);
    model.dispose();
  });
});
