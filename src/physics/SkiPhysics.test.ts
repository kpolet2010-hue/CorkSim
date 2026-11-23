import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cloneGameplayConfig } from '../config/physicsConfig';
import { Park } from '../park/Park';
import { SkierBody } from '../player/SkierBody';
import { makeSlopePark } from '../test/fixtures';
import { stepGround, type GroundControl } from './SkiPhysics';

const cfg = cloneGameplayConfig().physics;
const dt = 1 / 60;
const coast: GroundControl = { steer: 0, brake: 0, push: false, steerFactor: 1 };

function setup(deg: number, speed = 0): { park: Park; body: SkierBody } {
  const park = new Park(makeSlopePark(deg));
  const body = new SkierBody();
  const p = new Vector3(0, park.surface.height(0, 10), 10);
  const s = park.surface.sample(0, 10, { height: 0, normal: new Vector3(), type: 'snow', featureId: null });
  const heading = new Vector3(0, 0, 1).addScaledVector(s.normal, -s.normal.z).normalize();
  body.reset(p, heading, s.normal);
  body.velocity.copy(heading).multiplyScalar(speed);
  return { park, body };
}

function run(
  park: Park,
  body: SkierBody,
  control: GroundControl,
  seconds: number,
  onStep?: (i: number) => void,
): void {
  for (let i = 0; i < seconds / dt; i++) {
    const r = stepGround(body, control, park.surface, cfg, dt);
    expect(r.leftGround).toBe(false);
    onStep?.(i);
  }
}

describe('SkiPhysics - ground movement', () => {
  it('accelerates down a slope at g(sin θ - μ cos θ) from rest', () => {
    const { park, body } = setup(15);
    run(park, body, coast, 1);
    const theta = (15 * Math.PI) / 180;
    const expected = cfg.gravity * (Math.sin(theta) - cfg.glideFriction * Math.cos(theta));
    // After 1 s from rest drag is negligible: v ≈ a·t.
    expect(body.speed).toBeGreaterThan(expected * 0.93);
    expect(body.speed).toBeLessThan(expected * 1.03);
  });

  it('keeps contact with a smooth slope without bouncing', () => {
    const { park, body } = setup(12, 10);
    let maxGap = 0;
    run(park, body, coast, 8, () => {
      maxGap = Math.max(maxGap, body.groundGap);
    });
    expect(maxGap).toBeLessThan(0.02);
    // Normal force should settle near m g cos θ.
    expect(body.normalForce).toBeGreaterThan(cfg.mass * cfg.gravity * 0.9);
    expect(body.normalForce).toBeLessThan(cfg.mass * cfg.gravity * 1.05);
  });

  it('reaches a bounded terminal speed because drag grows with velocity', () => {
    const { park, body } = setup(20);
    run(park, body, coast, 60);
    const v1 = body.speed;
    run(park, body, coast, 20);
    expect(Math.abs(body.speed - v1)).toBeLessThan(0.6);
    expect(body.speed).toBeGreaterThan(20);
    expect(body.speed).toBeLessThan(cfg.maxSpeed);
  });

  it('tucking increases speed compared with standing upright', () => {
    const a = setup(15);
    const b = setup(15);
    run(a.park, a.body, coast, 25);
    run(b.park, b.body, { ...coast, push: true }, 25);
    expect(b.body.speed).toBeGreaterThan(a.body.speed + 1);
  });

  it('glides to a stop on flat ground through friction', () => {
    const { park, body } = setup(0, 5);
    run(park, body, coast, 20);
    expect(body.speed).toBeLessThan(0.05);
  });

  it('pushing gets the skier moving on flat ground', () => {
    const { park, body } = setup(0, 0);
    run(park, body, { ...coast, push: true }, 3);
    expect(body.speed).toBeGreaterThan(3);
  });

  it('braking reduces speed gradually, never instantly', () => {
    const { park, body } = setup(5, 15);
    const speeds: number[] = [];
    run(park, body, { ...coast, brake: 1 }, 4, () => speeds.push(body.speed));
    // First step loses only a tiny fraction of speed.
    expect(15 - speeds[0]).toBeLessThan(0.15);
    // Speed decreases monotonically and substantially.
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-6);
    expect(speeds[speeds.length - 1]).toBeLessThan(5);
    expect(speeds[30]).toBeGreaterThan(10);
  });

  it('carving turns the velocity, not just the skier', () => {
    const { park, body } = setup(10, 14);
    run(park, body, { ...coast, steer: 1 }, 1.5);
    // Steering left (+) rotates heading toward +X, and velocity follows.
    expect(body.heading.x).toBeGreaterThan(0.3);
    const vDir = body.velocity.clone().normalize();
    expect(vDir.x).toBeGreaterThan(0.25);
    expect(Math.abs(body.edgeAngle)).toBeGreaterThan(0.5);
    // Grip keeps the skid small while carving.
    expect(body.skidSpeed).toBeLessThan(3);
  });

  it('carves more effectively at speed', () => {
    const slow = setup(0, 4);
    const fast = setup(0, 16);
    let slowRate = 0;
    let fastRate = 0;
    run(slow.park, slow.body, { ...coast, steer: 1 }, 0.5, () => (slowRate = slow.body.yawRate));
    run(fast.park, fast.body, { ...coast, steer: 1 }, 0.5, () => (fastRate = fast.body.yawRate));
    // Turn radius r = v / yawRate: a faster skier carves a wider but proportionally more effective arc.
    const lateralAccelSlow = 4 * slowRate;
    const lateralAccelFast = 16 * fastRate;
    expect(lateralAccelFast).toBeGreaterThan(lateralAccelSlow);
  });

  it('computes independent contacts for both skis', () => {
    const { park, body } = setup(10, 8);
    run(park, body, { ...coast, steer: 1 }, 0.6);
    const [left, right] = body.skis;
    expect(left.point.distanceTo(right.point)).toBeCloseTo(cfg.skiHalfSpacing * 2, 2);
    expect(left.inContact && right.inContact).toBe(true);
    // Turning left loads the outside (right) ski more.
    expect(right.load).toBeGreaterThan(left.load);
  });
});
