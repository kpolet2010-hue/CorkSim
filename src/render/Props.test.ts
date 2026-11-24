import { describe, expect, it } from 'vitest';
import { Park } from '../park/Park';
import { getParkById } from '../park/ParkLoader';
import { PROP_CORRIDOR_MARGIN, placeProps } from './Props';

const PARKS = ['glacier-park', 'big-air'];

describe('placeProps', () => {
  for (const id of PARKS) {
    const park = new Park(getParkById(id));
    const placement = placeProps(park, 200, 100);

    it(`${id}: places rocks and mounds deterministically`, () => {
      expect(placement.rocks.length).toBeGreaterThan(150);
      expect(placement.mounds.length).toBeGreaterThan(80);
      const again = placeProps(park, 200, 100);
      expect(again).toEqual(placement);
    });

    it(`${id}: never inside the corridor or on a feature`, () => {
      const limit = park.config.terrain.halfWidth + PROP_CORRIDOR_MARGIN;
      for (const p of [...placement.rocks, ...placement.mounds]) {
        expect(Math.abs(p.x) - p.radius).toBeGreaterThanOrEqual(limit);
        expect(Math.abs(park.surface.height(p.x, p.z) - park.terrain.height(p.x, p.z))).toBeLessThan(1e-3);
        expect(Number.isFinite(p.y)).toBe(true);
        // Sits in the snow: never floating above it.
        expect(p.y).toBeLessThanOrEqual(park.terrain.height(p.x, p.z));
      }
    });
  }
});
