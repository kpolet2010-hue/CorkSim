import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  integrateOrientation,
  quaternionFromForwardUp,
  quaternionToRotationVector,
  safeAngle,
  sanitizeQuaternion,
  wrapAngle,
} from './math';

describe('math', () => {
  it('builds an orientation from forward and up', () => {
    const q = quaternionFromForwardUp(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Quaternion());
    const f = new Vector3(0, 0, 1).applyQuaternion(q);
    const u = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(f.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(u.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('orthogonalises a forward vector that is not perpendicular to up', () => {
    const up = new Vector3(0, 1, 0.3).normalize();
    const q = quaternionFromForwardUp(new Vector3(0, 0.2, 1), up, new Quaternion());
    const u = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(u.distanceTo(up)).toBeLessThan(1e-6);
    expect(Math.abs(q.length() - 1)).toBeLessThan(1e-9);
  });

  it('handles forward parallel to up without NaN', () => {
    const q = quaternionFromForwardUp(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Quaternion());
    expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });

  it('integrates a constant angular velocity exactly', () => {
    const q = new Quaternion();
    const w = new Vector3(0, Math.PI, 0); // half turn per second
    for (let i = 0; i < 60; i++) integrateOrientation(q, w, 1 / 60);
    const f = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(f.z).toBeCloseTo(-1, 6);
  });

  it('converts quaternions to rotation vectors', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2);
    const r = quaternionToRotationVector(q, new Vector3());
    expect(r.x).toBeCloseTo(1.2, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('sanitises degenerate quaternions and wraps angles', () => {
    const q = new Quaternion(NaN, 0, 0, 0);
    sanitizeQuaternion(q);
    expect(q.w).toBe(1);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
    expect(safeAngle(new Vector3(1, 0, 0), new Vector3(1, 1e-12, 0))).toBeGreaterThanOrEqual(0);
  });
});
