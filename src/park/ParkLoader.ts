import type { ParkConfig, RailObstacleConfig, SurfaceFeatureConfig } from './types';
import glacierPark from './parks/glacier-park.json';
import bigAirPark from './parks/big-air.json';

export class ParkValidationError extends Error {}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ParkValidationError(message);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateFeature(f: SurfaceFeatureConfig, i: number): void {
  const where = `features[${i}] (${String(f.id)})`;
  assert(typeof f.id === 'string' && f.id.length > 0, `${where}: missing id`);
  assert(isNum(f.x) && isNum(f.z), `${where}: x/z must be numbers`);
  if (f.type === 'kicker') {
    assert(isNum(f.width) && f.width > 1, `${where}: width must be > 1`);
    assert(isNum(f.height) && f.height > 0.2, `${where}: height must be > 0.2`);
    assert(
      isNum(f.takeoffAngleDeg) && f.takeoffAngleDeg > 5 && f.takeoffAngleDeg < 70,
      `${where}: takeoffAngleDeg out of range`,
    );
    assert(isNum(f.gap) && f.gap >= 0, `${where}: gap must be >= 0`);
    assert(isNum(f.deckHeight) && f.deckHeight > 0.2, `${where}: deckHeight must be > 0.2`);
    assert(
      isNum(f.landingAngleDeg) && f.landingAngleDeg > 5 && f.landingAngleDeg < 45,
      `${where}: landingAngleDeg out of range`,
    );
  } else if (f.type === 'ramp' || f.type === 'roller') {
    assert(isNum(f.width) && isNum(f.length) && isNum(f.height), `${where}: width/length/height required`);
  } else {
    throw new ParkValidationError(`${where}: unknown feature type`);
  }
}

function validateRail(r: RailObstacleConfig, i: number): void {
  const where = `rails[${i}] (${String(r.id)})`;
  assert(typeof r.id === 'string' && r.id.length > 0, `${where}: missing id`);
  assert(r.kind === 'rail' || r.kind === 'box', `${where}: kind must be rail or box`);
  assert(Array.isArray(r.points) && r.points.length >= 2, `${where}: needs at least 2 points`);
  for (const p of r.points)
    assert(Array.isArray(p) && p.length === 3 && p.every(isNum), `${where}: invalid point`);
}

/** Validates an untrusted JSON park description and returns it typed. */
export function validatePark(data: unknown): ParkConfig {
  assert(typeof data === 'object' && data !== null, 'Park must be an object');
  const p = data as ParkConfig;
  assert(typeof p.id === 'string' && typeof p.name === 'string', 'Park needs id and name');
  assert(isNum(p.seed), 'Park needs a numeric seed');
  assert(typeof p.terrain === 'object' && p.terrain !== null, 'Park needs terrain');
  assert(isNum(p.terrain.length) && p.terrain.length > 100, 'terrain.length must be > 100');
  assert(isNum(p.terrain.halfWidth) && p.terrain.halfWidth > 10, 'terrain.halfWidth must be > 10');
  assert(
    Array.isArray(p.terrain.slopeProfile) && p.terrain.slopeProfile.length > 0,
    'terrain.slopeProfile required',
  );
  for (let i = 1; i < p.terrain.slopeProfile.length; i++) {
    assert(p.terrain.slopeProfile[i].z > p.terrain.slopeProfile[i - 1].z, 'slopeProfile z must increase');
  }
  assert(isNum(p.spawn?.x) && isNum(p.spawn?.z), 'spawn required');
  assert(isNum(p.finishZ), 'finishZ required');
  assert(Array.isArray(p.features), 'features must be an array');
  assert(Array.isArray(p.rails), 'rails must be an array');
  p.features.forEach(validateFeature);
  p.rails.forEach(validateRail);
  const ids = new Set<string>();
  for (const item of [...p.features, ...p.rails]) {
    assert(!ids.has(item.id), `Duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return p;
}

export const PARKS: ParkConfig[] = [validatePark(glacierPark), validatePark(bigAirPark)];

export function getParkById(id: string): ParkConfig {
  return PARKS.find((p) => p.id === id) ?? PARKS[0];
}
