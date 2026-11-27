import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createSkierPoseInput } from './poseFromSim';
import { SkierAnimator, type SkierPoseInput } from './SkierAnimator';
import { SkierModel } from './SkierModel';

/** Driving forward with W (`tucking` = the sim's push input): upright, relaxed, light pole push when slow. */

function run(model: SkierModel, anim: SkierAnimator, p: SkierPoseInput, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    p.time += dt;
    p.timeInState += dt;
    anim.update(model, p, dt);
  }
}

function setup() {
  const model = new SkierModel();
  model.root.updateMatrixWorld(true);
  const p = createSkierPoseInput();
  p.state = 'RIDING';
  return { model, anim: new SkierAnimator(), p };
}

/** Forward tilt of the chest (rad, + = towards the skis' tips) in the root frame. */
function chestPitch(model: SkierModel): number {
  const q = model.chest.getWorldQuaternion(new Quaternion());
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  return Math.atan2(up.z, up.y);
}

/** Head height above the root (m). */
function headHeight(model: SkierModel): number {
  return model.root.worldToLocal(model.head.getWorldPosition(new Vector3())).y;
}

describe('SkierAnimator driving forward (W)', () => {
  it('stays upright at speed: no racing tuck, chest close to upright and head high', () => {
    const glide = setup();
    glide.p.speed = 14;
    run(glide.model, glide.anim, glide.p, 1.5);
    const drive = setup();
    drive.p.speed = 14;
    drive.p.tucking = true;
    run(drive.model, drive.anim, drive.p, 1.5);
    const pitch = chestPitch(drive.model);
    expect(pitch).toBeGreaterThan(-0.05);
    expect(pitch).toBeLessThan(0.3);
    // Not lower or more pitched than plain gliding (the old tuck dropped the head by ~0.4 m).
    expect(chestPitch(drive.model)).toBeLessThanOrEqual(chestPitch(glide.model) + 0.01);
    expect(headHeight(drive.model)).toBeGreaterThan(headHeight(glide.model) - 0.03);
    glide.model.dispose();
    drive.model.dispose();
  });

  it('double-pole pushes while slow and only carries the poles at speed', () => {
    const swing = (speed: number): number => {
      const { model, anim, p } = setup();
      p.speed = speed;
      p.tucking = true;
      run(model, anim, p, 1.2);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 90; i++) {
        run(model, anim, p, 1 / 60);
        const z = model.root.worldToLocal(model.hands[0].getWorldPosition(new Vector3())).z;
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
      model.dispose();
      return max - min;
    };
    expect(swing(2)).toBeGreaterThan(0.15);
    expect(swing(14)).toBeLessThan(0.06);
  });

  it('keeps the legs straight from behind: knees do not bow out past the hip-ankle line', () => {
    for (const tucking of [false, true]) {
      const { model, anim, p } = setup();
      p.speed = 12;
      p.tucking = tucking;
      run(model, anim, p, 1.5);
      const local = (b: { getWorldPosition: (v: Vector3) => Vector3 }) =>
        model.root.worldToLocal(b.getWorldPosition(new Vector3()));
      for (let i = 0; i < 2; i++) {
        const hip = local(model.thighs[i]);
        const knee = local(model.shins[i]);
        const ankle = local(model.feet[i]);
        // Lateral position of the straight hip-ankle line at the knee's height.
        const t = (hip.y - knee.y) / (hip.y - ankle.y);
        const lineX = hip.x + (ankle.x - hip.x) * t;
        const outward = (knee.x - lineX) * Math.sign(ankle.x);
        expect(outward).toBeLessThan(0.012);
      }
      model.dispose();
    }
  });

  it('is frame-rate independent', () => {
    const pose = (dt: number): Vector3 => {
      const { model, anim, p } = setup();
      p.speed = 3;
      p.tucking = true;
      run(model, anim, p, 2, dt);
      const v = model.root.worldToLocal(model.hands[0].getWorldPosition(new Vector3()));
      model.dispose();
      return v;
    };
    expect(pose(1 / 30).distanceTo(pose(1 / 144))).toBeLessThan(0.05);
  });
});
