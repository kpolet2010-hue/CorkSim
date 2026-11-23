import { describe, expect, it } from 'vitest';
import { Terrain } from './Terrain';
import { makeSlopePark } from '../test/fixtures';
import { getParkById } from '../park/ParkLoader';

describe('Terrain', () => {
  it('matches the authored slope angle', () => {
    const t = new Terrain(makeSlopePark(15).terrain, 1);
    const g = t.gradient(0, 100, { x: 0, z: 0 });
    expect(Math.atan(-g.z) * (180 / Math.PI)).toBeCloseTo(15, 1);
    expect(t.height(0, 0)).toBeCloseTo(0, 6);
    expect(t.height(0, 100)).toBeLessThan(t.height(0, 0));
  });

  it('is smooth: neighbouring normals differ only slightly', () => {
    const park = getParkById('glacier-park');
    const t = new Terrain(park.terrain, park.seed);
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    for (let z = 0; z < 900; z += 7) {
      t.gradient(3, z, a);
      t.gradient(3, z + 0.25, b);
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.05);
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.05);
    }
  });

  it('raises snowbanks outside the corridor', () => {
    const park = getParkById('glacier-park');
    const t = new Terrain(park.terrain, park.seed);
    expect(t.height(park.terrain.halfWidth + 40, 300)).toBeGreaterThan(t.height(0, 300) + 3);
  });
});
