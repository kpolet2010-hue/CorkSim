import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cloneGameplayConfig } from '../config/physicsConfig';
import { SkierBody } from '../player/SkierBody';
import { stepAir, type AirControl } from './AirPhysics';

const cfg = cloneGameplayConfig();
const dt = 1 / 60;

function airBody(): SkierBody {
  const b = new SkierBody();
  b.reset(new Vector3(0, 100, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0));
  b.velocity.set(0, 5, 10);
  return b;
}

describe('AirPhysics', () => {
  it('follows a ballistic trajectory', () => {
    const b = airBody();
    const none: AirControl = { spin: 0, flip: 0, roll: 0 };
    for (let i = 0; i < 60; i++) stepAir(b, none, cfg.physics, cfg.air, dt);
    expect(b.velocity.y).toBeCloseTo(5 - 9.81, 0);
    expect(b.position.z).toBeGreaterThan(9.5);
    expect(b.position.z).toBeLessThan(10.01);
  });

  it('spin input accelerates rotation up to a bounded rate', () => {
    const b = airBody();
    for (let i = 0; i < 180; i++) stepAir(b, { spin: 1, flip: 0, roll: 0 }, cfg.physics, cfg.air, dt);
    expect(b.angularVelocity.y).toBeGreaterThan(cfg.air.maxSpinRate * 0.95);
    expect(b.angularVelocity.length()).toBeLessThanOrEqual(cfg.air.maxAngularSpeed + 1e-6);
  });

  it('rotation coasts down after input is released', () => {
    const b = airBody();
    for (let i = 0; i < 30; i++) stepAir(b, { spin: 1, flip: 0, roll: 0 }, cfg.physics, cfg.air, dt);
    const w0 = b.angularVelocity.length();
    for (let i = 0; i < 30; i++) stepAir(b, { spin: 0, flip: 0, roll: 0 }, cfg.physics, cfg.air, dt);
    expect(b.angularVelocity.length()).toBeLessThan(w0 * 0.5);
    expect(b.angularVelocity.length()).toBeGreaterThan(0);
  });

  it('spin plus roll produces a tilted (off-axis) rotation axis', () => {
    const b = airBody();
    for (let i = 0; i < 40; i++) stepAir(b, { spin: 1, flip: 0, roll: 1 }, cfg.physics, cfg.air, dt);
    const w = b.angularVelocity.clone().normalize();
    const tilt = Math.acos(Math.abs(w.y)) * (180 / Math.PI);
    expect(tilt).toBeGreaterThan(35);
    expect(tilt).toBeLessThan(75);
  });

  it('never produces NaN even with extreme inputs', () => {
    const b = airBody();
    for (let i = 0; i < 600; i++) {
      stepAir(b, { spin: (i % 7) - 3, flip: (i % 5) - 2, roll: (i % 3) - 1 }, cfg.physics, cfg.air, dt);
    }
    expect(Number.isFinite(b.orientation.x + b.orientation.y + b.orientation.z + b.orientation.w)).toBe(true);
    expect(Math.abs(b.orientation.length() - 1)).toBeLessThan(1e-6);
    expect(b.angularVelocity.length()).toBeLessThanOrEqual(cfg.air.maxAngularSpeed + 1e-6);
  });
});
