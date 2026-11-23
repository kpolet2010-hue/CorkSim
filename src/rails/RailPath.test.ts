import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { RailPath, createRailProjection } from './RailPath';

describe('RailPath', () => {
  const kinked = new RailPath([new Vector3(0, 1, 0), new Vector3(0, 1, 5), new Vector3(0, 0, 10)]);

  it('computes arc length and kinks', () => {
    expect(kinked.totalLength).toBeCloseTo(5 + Math.hypot(1, 5), 6);
    expect(kinked.kinks).toEqual([1]);
  });

  it('evaluates points and tangents by arc length', () => {
    const p = kinked.pointAt(2.5, new Vector3());
    expect(p.z).toBeCloseTo(2.5);
    const t = kinked.tangentAt(7, new Vector3());
    expect(t.y).toBeLessThan(0);
  });

  it('projects points onto the path', () => {
    const proj = kinked.project(new Vector3(0.2, 1.3, 3), createRailProjection());
    expect(proj.s).toBeCloseTo(3, 5);
    expect(proj.distance).toBeCloseTo(Math.hypot(0.2, 0.3), 5);
  });

  it('samples smooth curves', () => {
    const curve = RailPath.fromSmoothControlPoints([
      new Vector3(0, 0, 0),
      new Vector3(2, 0, 5),
      new Vector3(0, 0, 10),
    ]);
    expect(curve.points.length).toBeGreaterThan(20);
    expect(curve.totalLength).toBeGreaterThan(10);
    expect(curve.pointAt(curve.totalLength, new Vector3()).z).toBeCloseTo(10);
  });

  it('rejects degenerate paths', () => {
    expect(() => new RailPath([new Vector3()])).toThrow();
  });
});
