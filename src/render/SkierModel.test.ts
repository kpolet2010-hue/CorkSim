import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RIG, SkierModel } from './SkierModel';

describe('SkierModel', () => {
  it('builds without a DOM (no canvas texture) and stays within the draw-call budget', () => {
    const m = new SkierModel();
    const s = m.stats();
    expect(s.meshes).toBeGreaterThanOrEqual(4);
    expect(s.meshes).toBeLessThanOrEqual(8);
    expect(s.bones).toBe(25);
    expect(s.triangles).toBeGreaterThan(5000);
    expect(s.triangles).toBeLessThan(60000);
    m.dispose();
  });

  it('has finite geometry with normalised skin weights on valid bones', () => {
    const m = new SkierModel();
    for (const mesh of m.meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const nrm = mesh.geometry.getAttribute('normal');
      const si = mesh.geometry.getAttribute('skinIndex');
      const sw = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        expect(Number.isFinite(nrm.getX(i) + nrm.getY(i) + nrm.getZ(i))).toBe(true);
        const w = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        expect(Math.abs(w - 1)).toBeLessThan(1e-5);
        expect(si.getX(i)).toBeLessThan(m.skeleton.bones.length);
        expect(si.getY(i)).toBeLessThan(m.skeleton.bones.length);
      }
    }
    m.dispose();
  });

  it('keeps the rig proportions physics relies on', () => {
    const m = new SkierModel();
    m.root.updateMatrixWorld(true);
    const hip = m.thighs[0].getWorldPosition(new Vector3());
    const knee = m.shins[0].getWorldPosition(new Vector3());
    const ankle = m.feet[0].getWorldPosition(new Vector3());
    const ski = m.skis[0].getWorldPosition(new Vector3());
    const ua = m.upperArms[0].getWorldPosition(new Vector3());
    const elbow = m.forearms[0].getWorldPosition(new Vector3());
    const wrist = m.hands[0].getWorldPosition(new Vector3());
    expect(hip.distanceTo(knee)).toBeCloseTo(RIG.thigh, 5);
    expect(knee.distanceTo(ankle)).toBeCloseTo(RIG.shin, 5);
    expect(ankle.y - ski.y).toBeCloseTo(RIG.ankle, 5);
    expect(ua.distanceTo(elbow)).toBeCloseTo(RIG.upperArm, 5);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(RIG.forearm, 5);
    expect(Math.abs(ua.x)).toBeCloseTo(RIG.shoulderHalfWidth, 5);
    expect(RIG.stance).toBe(0.13);
    expect(RIG.skiLength).toBe(1.78);
    const names = m.skeleton.bones.map((b) => b.name);
    for (const n of ['pelvis', 'spine', 'chest', 'neck', 'head', 'thighL', 'shinR', 'footL', 'skiR', 'handL', 'poleR'])
      expect(names).toContain(n);
    m.dispose();
  });
});
