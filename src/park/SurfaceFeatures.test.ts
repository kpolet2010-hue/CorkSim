import { describe, expect, it } from 'vitest';
import { KickerLanding, KickerTakeoff } from './SurfaceFeatures';
import type { KickerConfig } from './types';
import type { FeatureSample } from './SurfaceFeatures';

const cfg: KickerConfig = {
  id: 'k',
  type: 'kicker',
  x: 0,
  z: 0,
  width: 6,
  height: 2,
  takeoffAngleDeg: 35,
  gap: 6,
  deckHeight: 1.8,
  landingAngleDeg: 12,
};
const out: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };

describe('Kicker geometry', () => {
  it('reaches the configured lip height and takeoff angle', () => {
    const k = new KickerTakeoff(cfg);
    expect(k.sample(0, k.length - 1e-6, out)).toBe(true);
    expect(out.offset).toBeCloseTo(2, 3);
    expect(Math.atan(out.gradZ) * (180 / Math.PI)).toBeCloseTo(35, 1);
  });

  it('starts flush with the snow (no step at the start of the ramp)', () => {
    const k = new KickerTakeoff(cfg);
    k.sample(0, 0.05, out);
    expect(out.offset).toBeLessThan(0.01);
  });

  it('has a flat deck then a continuous landing slope', () => {
    const k = new KickerTakeoff(cfg);
    const l = new KickerLanding(cfg, k.length);
    l.sample(0, k.length + 2, out);
    expect(out.offset).toBeCloseTo(1.8, 3);
    expect(out.type).toBe('deck');
    let prev = 1.8;
    for (let u = l.knuckleStart; u < l.landingEnd; u += 0.1) {
      const ok = l.sample(0, u, out);
      const h = ok ? out.offset : 0;
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      expect(prev - h).toBeLessThan(0.1 * Math.tan((12 * Math.PI) / 180) + 0.01);
      prev = h;
    }
  });

  it('falls off smoothly at the sides', () => {
    const k = new KickerTakeoff(cfg);
    k.sample(0, k.length * 0.9, out);
    const center = out.offset;
    const ok = k.sample(3.6, k.length * 0.9, out);
    expect(ok).toBe(true);
    expect(out.offset).toBeLessThan(center);
    expect(out.offset).toBeGreaterThan(0);
  });

  it('respects yaw rotation', () => {
    const k = new KickerTakeoff({ ...cfg, yawDeg: 90 });
    expect(k.sample(k.length - 0.01, 0, out)).toBe(true);
    expect(out.offset).toBeGreaterThan(1.9);
    expect(out.gradX).toBeGreaterThan(0.5);
  });
});
