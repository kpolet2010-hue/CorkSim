/**
 * Pure mappings from simulation quantities to effect intensities, kept separate from the particle systems so
 * they are unit-testable and so every visual is traceable to a physical cause.
 */

export interface SprayParams {
  /** Particles per second per ski in contact. */
  rate: number;
  /** Lateral throw speed away from the turn (m/s). */
  throwSpeed: number;
  /** Share of the skier's velocity the snow keeps (0..1). */
  carry: number;
  spread: number;
  upward: number;
  sizeScale: number;
  alpha: number;
  /** Lifetime multiplier: carve trails linger, scrape fans dissipate faster. */
  life: number;
}

const MAX_SPRAY_RATE = 320;

/**
 * Snow thrown by the skis. Carving (edge angle x speed) cuts a thin rooster tail from the edge; skidding and
 * braking (lateral speed, brake blend x speed) scrape a wide fan of loose snow forward and sideways.
 * Below walking pace or on a flat ski nothing is thrown.
 */
export function skiSpray(
  speed: number,
  edgeAngle: number,
  skidSpeed: number,
  brakeAmount: number,
  out: SprayParams,
): SprayParams {
  const edge = Math.abs(edgeAngle);
  const carve = speed > 5 ? Math.max(0, edge - 0.12) * speed : 0;
  const scrape = Math.max(0, skidSpeed - 0.6) + brakeAmount * speed * 0.55;
  const carveRate = carve * 30;
  const scrapeRate = scrape * 30;
  out.rate = Math.min(MAX_SPRAY_RATE, carveRate + scrapeRate);
  const scrapeShare = out.rate > 0 ? scrapeRate / (carveRate + scrapeRate) : 0;
  out.throwSpeed = Math.min(3.5, carve * 0.18 + scrape * 0.45);
  // Carve snow barely keeps the skier's speed, so it hangs in the air as an arc along the turn.
  out.carry = 0.1 + scrapeShare * 0.3;
  out.spread = 0.5 + scrapeShare * 1.4;
  out.upward = 1.4 + Math.min(1.8, (carve + scrape) * 0.1);
  out.sizeScale = 0.95 + scrapeShare * 0.8;
  out.alpha = 0.95;
  out.life = 0.62 - scrapeShare * 0.05;
  return out;
}

export interface BurstParams {
  count: number;
  /** Sideways throw away from each ski (m/s): the burst is a low skirt, never a cloud over the skier. */
  throwSpeed: number;
  spread: number;
  upward: number;
  sizeScale: number;
}

/** Landing burst per ski, scaled by the vertical impact speed (m/s). */
export function landingBurst(impactSpeed: number, out: BurstParams): BurstParams {
  const i = Math.max(0, impactSpeed);
  out.count = Math.round(Math.min(200, 30 + i * 12));
  out.throwSpeed = 2.5 + Math.min(4, i * 0.35);
  out.spread = 1.2 + Math.min(3, i * 0.25);
  out.upward = 0.5 + Math.min(1, i * 0.08);
  out.sizeScale = 1.5 + Math.min(0.7, i * 0.06);
  return out;
}

export interface GrindParams {
  sparks: number;
  flecks: number;
}

/**
 * Grind particles per second. Metal rails throw sparks (more with speed); boxes (plastic top) throw only a
 * few snow flecks off the skis. Nothing below a crawl.
 */
export function grindRate(kind: 'rail' | 'box', speed: number, out: GrindParams): GrindParams {
  const s = speed < 1.5 ? 0 : Math.min(speed, 20);
  out.sparks = kind === 'rail' ? s * 24 : 0;
  out.flecks = kind === 'rail' ? s * 5 : s * 11;
  return out;
}

/**
 * Crash impact skirt: a low ring of snow at snow level around the contact point (never a cloud over the
 * tumbling body), scaled by the skier's speed at the crash. `throwSpeed` is the radial ring speed; the
 * forward share of the momentum is added separately (see crashCarry).
 */
export function crashBurst(speed: number, out: BurstParams): BurstParams {
  const v = Math.max(0, speed);
  out.count = Math.round(Math.min(160, 50 + v * 5));
  out.throwSpeed = 2.2 + Math.min(3.5, v * 0.18);
  out.spread = 1.2 + Math.min(2, v * 0.1);
  out.upward = 0.5 + Math.min(0.6, v * 0.03);
  out.sizeScale = 1.5 + Math.min(0.6, v * 0.03);
  return out;
}

/**
 * Forward speed (m/s) the impact snow keeps from the body's momentum: it is shoved ahead, not left behind,
 * but stays well below the body's speed so the plume falls back and never travels with the tumbling skier.
 */
export function crashCarry(speed: number): number {
  return Math.min(2.5, Math.max(0, speed) * 0.12);
}

/** Gravity for the crash skirt (m/s^2): wet, compacted impact snow settles faster than carve powder (4). */
export const SKIRT_GRAVITY = 5.5;

export interface ChunkParams {
  count: number;
  /** Horizontal throw speed (m/s). */
  throwSpeed: number;
  /** Upward throw speed (m/s); chunks are dense and fall at full gravity. */
  upward: number;
  /** Sprite size scale: small, so flecks never hide the body. */
  sizeScale: number;
}

/** Gravity used for the dense crash chunks (m/s^2). */
export const CHUNK_GRAVITY = 9.81;

/** Thrown snow chunks and flecks at a crash: few, small, ballistic, scaled by speed and bounded. */
export function crashChunks(speed: number, out: ChunkParams): ChunkParams {
  const v = Math.max(0, speed);
  out.count = Math.round(Math.min(48, 18 + v * 2));
  out.throwSpeed = 1.5 + Math.min(3.5, v * 0.2);
  out.upward = 1.8 + Math.min(1.6, v * 0.08);
  out.sizeScale = 0.34;
  return out;
}

/** A crashed body farther than this (m) above the snow is airborne between bounces: nothing is ploughed. */
export const CRASH_CONTACT_CLEARANCE = 0.5;

/** Trailing puffs per second while the crashed body slides on the snow (a thin plume, not a wall). */
export function crashTrailRate(speed: number, clearance = 0): number {
  if (clearance > CRASH_CONTACT_CLEARANCE) return 0;
  return speed < 1.5 ? 0 : Math.min(24, speed * 1.6);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Turns a horizontal throw into one along the snow surface (unit `normal`), keeping its speed. Snow thrown
 * across a steep landing must follow the slope down; a horizontal throw would leave it hovering metres above
 * the snow as the hill drops away beneath it.
 */
export function alongSurface(v: Vec3Like, normal: Vec3Like): Vec3Like {
  const speed = Math.hypot(v.x, v.y, v.z);
  const d = v.x * normal.x + v.y * normal.y + v.z * normal.z;
  v.x -= normal.x * d;
  v.y -= normal.y * d;
  v.z -= normal.z * d;
  const l = Math.hypot(v.x, v.y, v.z);
  if (l > 1e-6) {
    const k = speed / l;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
  return v;
}

export interface HeightSampler {
  height(x: number, z: number): number;
}

/** Sample points along the body's up axis (m from the feet): skis, hips, head. */
const BODY_REACH = [0, 0.75, 1.5] as const;

/**
 * Where a crashed body touches the snow: the lowest of feet, hips and head relative to the surface. Writes
 * that point, dropped onto the snow, to `out` and returns its clearance above the snow (m, may be negative).
 * A head-first crash therefore marks the snow at the head, not under the skis in the air.
 */
export function crashContact(
  foot: Vec3Like,
  up: Vec3Like,
  surface: HeightSampler,
  out: Vec3Like,
): number {
  let best = Infinity;
  for (let i = 0; i < BODY_REACH.length; i++) {
    const r = BODY_REACH[i];
    const x = foot.x + up.x * r;
    const y = foot.y + up.y * r;
    const z = foot.z + up.z * r;
    const h = surface.height(x, z);
    if (y - h < best) {
      best = y - h;
      out.x = x;
      out.y = h;
      out.z = z;
    }
  }
  return best;
}
