import { Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  alongSurface,
  type BurstParams,
  CHUNK_GRAVITY,
  type ChunkParams,
  CRASH_CONTACT_CLEARANCE,
  crashBurst,
  crashCarry,
  crashChunks,
  crashContact,
  crashTrailRate,
  type HeightSampler,
  grindRate,
  landingBurst,
  SKIRT_GRAVITY,
  skiSpray,
  type SprayParams,
} from './effectsModel';
import { SnowSpray } from './SnowParticles';

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

  it('sliding trail only ploughs while the body touches the snow', () => {
    expect(crashTrailRate(10, 0.1)).toBeGreaterThan(0);
    expect(crashTrailRate(10, -0.2)).toBeGreaterThan(0);
    expect(crashTrailRate(10, CRASH_CONTACT_CLEARANCE + 0.3)).toBe(0);
  });

  it('crash skirt is a visible ring that grows with speed, stays low and pushes snow ahead', () => {
    const b = (): BurstParams => ({ count: 0, throwSpeed: 0, spread: 0, upward: 0, sizeScale: 0 });
    const slow = crashBurst(4, b());
    const fast = crashBurst(25, b());
    // Enough puffs to read as an impact even at low speed.
    expect(slow.count).toBeGreaterThanOrEqual(50);
    expect(fast.throwSpeed).toBeGreaterThan(slow.throwSpeed);
    expect(crashCarry(25)).toBeGreaterThan(crashCarry(4));
    expect(crashCarry(1000)).toBeLessThanOrEqual(4);
    expect(crashCarry(-5)).toBe(0);
    // The plume falls back behind the body instead of travelling with it.
    for (const v of [4, 10, 25]) expect(crashCarry(v)).toBeLessThan(v * 0.2);
  });

  it('crash skirt runs down a slope instead of hovering over it', () => {
    // 30 degree slope falling towards +z.
    const n = { x: 0, y: Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) };
    const down = alongSurface({ x: 0, y: 0, z: 3 }, n);
    expect(Math.hypot(down.x, down.y, down.z)).toBeCloseTo(3);
    expect(down.y).toBeLessThan(-1.4);
    expect(down.x * n.x + down.y * n.y + down.z * n.z).toBeCloseTo(0);
    // Across the fall line nothing changes; on flat snow nothing changes.
    expect(alongSurface({ x: 2, y: 0, z: 0 }, n)).toEqual({ x: 2, y: 0, z: 0 });
    const flatV = alongSurface({ x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(flatV.x).toBeCloseTo(1);
    expect(flatV.y).toBeCloseTo(0);
    // The skirt is heavier than loose carve powder (SnowSpray default gravity 4).
    expect(SKIRT_GRAVITY).toBeGreaterThan(4);
  });

  it('crash chunks are few, small and stay below chest height', () => {
    const c = (): ChunkParams => ({ count: 0, throwSpeed: 0, upward: 0, sizeScale: 0 });
    const slow = crashChunks(4, c());
    const fast = crashChunks(25, c());
    const skirt = crashBurst(25, { count: 0, throwSpeed: 0, spread: 0, upward: 0, sizeScale: 0 });
    expect(slow.count).toBeGreaterThan(0);
    expect(fast.count).toBeGreaterThan(slow.count);
    expect(crashChunks(1000, c()).count).toBeLessThanOrEqual(48);
    // Small flecks: a fraction of a skirt puff, so they can never hide the body.
    expect(fast.sizeScale).toBeLessThan(skirt.sizeScale * 0.25);
    // Effects.onCrash throws them with at most `upward` vertical speed at full gravity: peak below 0.8 m.
    expect((fast.upward * fast.upward) / (2 * CHUNK_GRAVITY)).toBeLessThan(0.8);
  });
});

describe('crashContact', () => {
  const flat = (h: number): HeightSampler => ({ height: () => h });
  const slope: HeightSampler = { height: (_x, z) => -0.3 * z };

  it('upright crash touches down at the skis', () => {
    const out = { x: 0, y: 0, z: 0 };
    const clearance = crashContact({ x: 1, y: 0.02, z: 2 }, { x: 0, y: 1, z: 0 }, flat(0), out);
    expect(clearance).toBeCloseTo(0.02);
    expect(out).toEqual({ x: 1, y: 0, z: 2 });
  });

  it('head-first crash marks the snow at the head, not under the skis in the air', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Upside down and tilted forward: feet 1.4 m up, head 0.1 m into the snow 0.6 m further downhill.
    const up = { x: 0, y: -0.92, z: 0.4 };
    const clearance = crashContact({ x: 0, y: 1.4, z: 0 }, up, flat(0), out);
    expect(clearance).toBeLessThan(0.05);
    expect(out.z).toBeCloseTo(0.6);
    expect(out.y).toBe(0);
  });

  it('lying flat on a slope picks the lowest point relative to the snow, on the snow', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Body lying downhill along +z, 0.25 m above a slope that drops 0.3 m per metre.
    const foot = { x: 0, y: 0.25, z: 0 };
    const clearance = crashContact(foot, { x: 0, y: -0.287, z: 0.958 }, slope, out);
    expect(out.y).toBeCloseTo(slope.height(out.x, out.z));
    expect(clearance).toBeCloseTo(0.25, 2);
  });

  it('reports a bouncing body as clear of the snow', () => {
    const out = { x: 0, y: 0, z: 0 };
    const clearance = crashContact({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1, z: 0 }, flat(0), out);
    expect(clearance).toBeGreaterThan(CRASH_CONTACT_CLEARANCE);
    expect(crashTrailRate(15, clearance)).toBe(0);
  });
});

describe('SnowSpray', () => {
  it('clear() kills every live particle, including crash chunks', () => {
    const s = new SnowSpray(64, new Texture());
    const o = new Vector3();
    s.emit(o, new Vector3(1, 0, 0), 20, { spread: 1, upward: 1 });
    s.emit(o, new Vector3(0, 2, 0), 10, { spread: 1, upward: 1, gravity: CHUNK_GRAVITY, drag: 0.5, growth: 0 });
    s.update(1 / 60);
    expect(s.liveCount).toBe(30);
    s.clear();
    s.update(1 / 60);
    expect(s.liveCount).toBe(0);
    s.dispose();
  });

  it('chunks fall faster than powder', () => {
    const s = new SnowSpray(2, new Texture());
    const o = new Vector3();
    const v = new Vector3(0, 2, 0);
    s.emit(o, v, 1, { spread: 0, upward: 0, life: 10 });
    s.emit(o, v, 1, { spread: 0, upward: 0, life: 10, gravity: CHUNK_GRAVITY, drag: 0.5 });
    for (let i = 0; i < 30; i++) s.update(1 / 60);
    const pos = s.points.geometry.getAttribute('position');
    // Both start within 0.1 m of the origin; after 0.5 s the chunk is well below the powder puff.
    expect(pos.getY(1)).toBeLessThan(pos.getY(0) - 0.3);
    s.dispose();
  });
});
