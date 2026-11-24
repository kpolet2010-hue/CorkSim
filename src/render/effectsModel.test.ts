import { describe, expect, it } from 'vitest';
import {
  type BurstParams,
  crashBurst,
  crashTrailRate,
  grindRate,
  landingBurst,
  skiSpray,
  type SprayParams,
} from './effectsModel';

const spray = (): SprayParams => ({
  rate: 0,
  throwSpeed: 0,
  carry: 0,
  spread: 0,
  upward: 0,
  sizeScale: 0,
  alpha: 0,
  life: 0,
});

describe('skiSpray', () => {
  it('throws nothing when gliding straight or standing', () => {
    expect(skiSpray(12, 0, 0, 0, spray()).rate).toBe(0);
    expect(skiSpray(0.5, 0.8, 0.2, 0, spray()).rate).toBe(0);
  });

  it('grows with edge angle and speed when carving', () => {
    const slow = skiSpray(8, 0.6, 0, 0, spray()).rate;
    const fast = skiSpray(18, 0.6, 0, 0, spray()).rate;
    const deep = skiSpray(18, 1.0, 0, 0, spray()).rate;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(deep).toBeGreaterThan(fast);
  });

  it('braking scrapes a wider, bigger fan than carving', () => {
    const carve = skiSpray(14, 0.8, 0, 0, spray());
    const brake = skiSpray(14, 0.2, 3, 1, spray());
    expect(brake.spread).toBeGreaterThan(carve.spread);
    expect(brake.sizeScale).toBeGreaterThan(carve.sizeScale);
    expect(carve.life).toBeGreaterThan(brake.life);
  });

  it('is bounded', () => {
    expect(skiSpray(60, 1.4, 20, 1, spray()).rate).toBeLessThanOrEqual(320);
  });
});

describe('landingBurst', () => {
  it('scales with impact and is bounded', () => {
    const b = (): BurstParams => ({ count: 0, throwSpeed: 0, spread: 0, upward: 0, sizeScale: 0 });
    const soft = landingBurst(2, b());
    const hard = landingBurst(9, b());
    expect(hard.count).toBeGreaterThan(soft.count);
    expect(hard.upward).toBeGreaterThan(soft.upward);
    expect(hard.throwSpeed).toBeGreaterThan(soft.throwSpeed);
    // Low skirt: even a hard landing only lifts snow to about knee height (v^2 / 2g with g = 4).
    expect((hard.upward * hard.upward) / 8).toBeLessThan(0.4);
    expect(landingBurst(1000, b()).count).toBeLessThanOrEqual(200);
  });
});

describe('grindRate', () => {
  it('sparks only on metal rails, snow flecks on boxes', () => {
    expect(grindRate('rail', 8, { sparks: 0, flecks: 0 }).sparks).toBeGreaterThan(0);
    expect(grindRate('box', 8, { sparks: 0, flecks: 0 }).sparks).toBe(0);
    expect(grindRate('box', 8, { sparks: 0, flecks: 0 }).flecks).toBeGreaterThan(0);
    expect(grindRate('rail', 0.5, { sparks: 0, flecks: 0 }).sparks).toBe(0);
  });
});

describe('crash effects', () => {
  it('crash burst is a bounded low skirt that grows with speed', () => {
    const b = (): BurstParams => ({ count: 0, throwSpeed: 0, spread: 0, upward: 0, sizeScale: 0 });
    const slow = crashBurst(4, b());
    const fast = crashBurst(25, b());
    expect(fast.count).toBeGreaterThan(slow.count);
    expect(crashBurst(1000, b()).count).toBeLessThanOrEqual(160);
    // Peak height v^2 / 2g (g = 4) stays well below the body.
    expect((fast.upward * fast.upward) / 8).toBeLessThan(0.3);
  });

  it('sliding trail is thin and stops when the body stops', () => {
    expect(crashTrailRate(0.5)).toBe(0);
    expect(crashTrailRate(10)).toBeGreaterThan(0);
    expect(crashTrailRate(100)).toBeLessThanOrEqual(24);
  });
});
