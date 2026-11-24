import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from './IK';

function chain(upperLen = 0.44, lowerLen = 0.45) {
  const root = new Object3D();
  const upper = new Object3D();
  const lower = new Object3D();
  const end = new Object3D();
  root.add(upper);
  upper.add(lower);
  lower.add(end);
  upper.position.set(0.1, 1, 0);
  lower.position.y = -upperLen;
  end.position.y = -lowerLen;
  root.rotation.set(0.3, 0.8, -0.2);
  root.updateMatrixWorld(true);
  return { root, upper, lower, end, upperLen, lowerLen };
}

const endPos = (o: Object3D) => o.getWorldPosition(new Vector3());

describe('solveTwoBoneIK', () => {
  it('reaches reachable targets exactly and keeps bone lengths', () => {
    const c = chain();
    const base = endPos(c.upper);
    for (const t of [
      new Vector3(0.2, -0.5, 0.3),
      new Vector3(-0.4, -0.2, 0.1),
      new Vector3(0.1, 0.4, 0.5),
      new Vector3(0.0, -0.85, 0.05),
    ]) {
      const target = t.clone().add(base);
      const rest = solveTwoBoneIK(c.upper, c.lower, c.upperLen, c.lowerLen, target, new Vector3(0, 0, 1));
      expect(rest).toBeLessThan(1e-6);
      expect(endPos(c.end).distanceTo(target)).toBeLessThan(1e-4);
      expect(endPos(c.lower).distanceTo(base)).toBeCloseTo(c.upperLen, 5);
    }
  });

  it('extends fully towards unreachable targets and reports the gap', () => {
    const c = chain();
    const base = endPos(c.upper);
    const target = base.clone().add(new Vector3(0, -2, 0));
    const gap = solveTwoBoneIK(c.upper, c.lower, c.upperLen, c.lowerLen, target, new Vector3(0, 0, 1));
    expect(gap).toBeGreaterThan(1);
    const reach = endPos(c.end).distanceTo(base);
    expect(reach).toBeCloseTo((c.upperLen + c.lowerLen) * 0.999, 3);
  });

  it('respects the minimum-reach joint limit', () => {
    const c = chain();
    const base = endPos(c.upper);
    const target = base.clone().add(new Vector3(0, -0.05, 0.02));
    solveTwoBoneIK(c.upper, c.lower, c.upperLen, c.lowerLen, target, new Vector3(0, 0, 1), { minReach: 0.3 });
    expect(endPos(c.end).distanceTo(base)).toBeGreaterThan(0.3 * (c.upperLen + c.lowerLen) - 1e-3);
  });

  it('bends the middle joint towards the pole', () => {
    const c = chain();
    const base = endPos(c.upper);
    const target = base.clone().add(new Vector3(0, -0.6, 0));
    solveTwoBoneIK(c.upper, c.lower, c.upperLen, c.lowerLen, target, new Vector3(0, 0, 1));
    expect(endPos(c.lower).z - base.z).toBeGreaterThan(0.1);
    solveTwoBoneIK(c.upper, c.lower, c.upperLen, c.lowerLen, target, new Vector3(0, 0, -1));
    expect(endPos(c.lower).z - base.z).toBeLessThan(-0.1);
  });

  it('does not flip the elbow when the target sweeps across the pole axis (fallback pole)', () => {
    const c = chain(0.29, 0.27);
    const base = endPos(c.upper);
    const pole = new Vector3(0, 0, 1);
    const fallback = new Vector3(0, -1, 0);
    let prev: Vector3 | null = null;
    let maxJump = 0;
    for (let k = 0; k <= 60; k++) {
      // Target swings from the side to straight along the pole and beyond.
      const a = -0.6 + (k / 60) * 1.2;
      const target = base.clone().add(new Vector3(Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4));
      solveTwoBoneIK(c.upper, c.lower, 0.29, 0.27, target, pole, { fallbackPole: fallback });
      const elbow = endPos(c.lower);
      expect(Number.isFinite(elbow.x + elbow.y + elbow.z)).toBe(true);
      if (prev) maxJump = Math.max(maxJump, elbow.distanceTo(prev));
      prev = elbow;
    }
    expect(maxJump).toBeLessThan(0.05);
  });
});
