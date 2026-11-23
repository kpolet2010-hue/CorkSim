import { describe, expect, it } from 'vitest';
import { PARKS, ParkValidationError, validatePark } from './ParkLoader';
import { Park } from './Park';

describe('ParkLoader', () => {
  it('ships valid parks that construct', () => {
    expect(PARKS.length).toBeGreaterThanOrEqual(2);
    for (const cfg of PARKS) {
      const park = new Park(cfg);
      expect(park.kickers.length).toBeGreaterThan(0);
      expect(park.rails.length).toBeGreaterThan(0);
      expect(park.trees.length).toBeGreaterThan(100);
      for (const r of park.rails) expect(r.path.totalLength).toBeGreaterThan(3);
    }
  });

  it('includes every obstacle type in the main park', () => {
    const park = new Park(PARKS[0]);
    const shapes = new Set(park.rails.map((r) => `${r.kind}:${r.shape}`));
    for (const s of [
      'rail:straight',
      'rail:down',
      'rail:up',
      'rail:kinked',
      'box:straight',
      'box:curved',
      'box:rainbow',
    ]) {
      expect(shapes.has(s)).toBe(true);
    }
  });

  it('rejects invalid data with a useful message', () => {
    const bad = JSON.parse(JSON.stringify(PARKS[0]));
    bad.features[0].takeoffAngleDeg = 120;
    expect(() => validatePark(bad)).toThrow(ParkValidationError);
    expect(() => validatePark(null)).toThrow(/object/);
    const dup = JSON.parse(JSON.stringify(PARKS[0]));
    dup.rails[1].id = dup.rails[0].id;
    expect(() => validatePark(dup)).toThrow(/Duplicate/);
  });
});
