import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { cloneGameplayConfig } from '../config/physicsConfig';
import { quaternionFromForwardUp } from '../core/math';
import { evaluateLanding } from './LandingEvaluator';

const cfg = cloneGameplayConfig().landing;
const D = Math.PI / 180;
// 30° landing slope descending towards +Z.
const n = new Vector3(0, Math.cos(30 * D), Math.sin(30 * D));
const down = new Vector3(0, -Math.sin(30 * D), Math.cos(30 * D));

function orient(forward: Vector3, up: Vector3): Quaternion {
  return quaternionFromForwardUp(forward, up, new Quaternion());
}

function land(q: Quaternion, v: Vector3, w = new Vector3(), grabbing = false) {
  return evaluateLanding(
    { orientation: q, velocity: v, angularVelocity: w, surfaceNormal: n, grabbing },
    cfg,
  );
}

describe('LandingEvaluator', () => {
  const vOnSlope = down.clone().multiplyScalar(15).addScaledVector(n, -4);

  it('clean when aligned with the slope and the direction of travel', () => {
    const r = land(orient(down, n), vOnSlope);
    expect(r.quality).toBe('clean');
    expect(r.switchLanding).toBe(false);
  });

  it('accepts switch landings', () => {
    const r = land(orient(down.clone().negate(), n), vOnSlope);
    expect(r.quality).toBe('clean');
    expect(r.switchLanding).toBe(true);
  });

  it('compares against the landing surface, not world up', () => {
    // Perfectly upright in world terms is 30° off the landing slope normal.
    const r = land(orient(new Vector3(0, 0, 1), new Vector3(0, 1, 0)), vOnSlope);
    expect(r.uprightErrorDeg).toBeCloseTo(30, 0);
    expect(r.quality).toBe('sketchy');
  });

  it('crashes when skis are sideways to the direction of travel', () => {
    const r = land(orient(new Vector3(1, 0, 0), n), vOnSlope);
    expect(r.quality).toBe('crash');
    expect(r.yawErrorDeg).toBeGreaterThan(80);
  });

  it('crashes when landing upside down', () => {
    const r = land(orient(down, n.clone().negate()), vOnSlope);
    expect(r.quality).toBe('crash');
  });

  it('flat hard impacts are sketchy or crash depending on speed into the slope', () => {
    const q = orient(down, n);
    expect(land(q, down.clone().multiplyScalar(10).addScaledVector(n, -10)).quality).toBe('sketchy');
    expect(land(q, down.clone().multiplyScalar(10).addScaledVector(n, -16)).quality).toBe('crash');
  });

  it('is tolerant of tiny numerical errors', () => {
    const q = orient(down.clone().add(new Vector3(1e-7, 0, 0)), n.clone().add(new Vector3(0, 1e-7, 0)));
    expect(land(q, vOnSlope).quality).toBe('clean');
  });

  it('holding a grab or still rotating makes it sketchy', () => {
    const q = orient(down, n);
    expect(land(q, vOnSlope, new Vector3(), true).quality).toBe('sketchy');
    expect(land(q, vOnSlope, new Vector3(0, 8, 0)).quality).toBe('sketchy');
  });
});
