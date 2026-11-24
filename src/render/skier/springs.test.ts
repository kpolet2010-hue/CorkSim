import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createSpring, damp, stepSpring, stepSpring3 } from './springs';

function settle(dt: number, seconds: number, freq: number, zeta: number): number[] {
  const s = createSpring(0);
  const out: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) out.push(stepSpring(s, 1, freq, zeta, dt));
  return out;
}

describe('springs', () => {
  it('converge to the target and are frame-rate independent', () => {
    const a = settle(1 / 30, 1, 4, 0.7);
    const b = settle(1 / 144, 1, 4, 0.7);
    expect(a[a.length - 1]).toBeCloseTo(1, 2);
    expect(Math.abs(a[a.length - 1] - b[b.length - 1])).toBeLessThan(0.01);
  });

  it('overshoot only when under-damped', () => {
    const under = settle(1 / 60, 1.5, 4, 0.4);
    const crit = settle(1 / 60, 1.5, 4, 1);
    expect(Math.max(...under)).toBeGreaterThan(1.05);
    expect(Math.max(...crit)).toBeLessThan(1.001);
  });

  it('stay stable with huge steps and never return NaN', () => {
    const s = createSpring(0);
    for (let i = 0; i < 20; i++) stepSpring(s, 2, 12, 0.5, 0.5);
    expect(s.x).toBeCloseTo(2, 3);
    const v = { x: new Vector3(), v: new Vector3() };
    stepSpring3(v, new Vector3(1, 2, 3), 6, 0.8, 2);
    expect(v.x.distanceTo(new Vector3(1, 2, 3))).toBeLessThan(1e-3);
  });

  it('damp matches the exponential form', () => {
    expect(damp(0, 1, 10, 0.1)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(damp(5, 5, 10, 0.1)).toBe(5);
  });
});
