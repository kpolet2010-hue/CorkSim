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
 * Crash impact: like the landing burst, a low skirt thrown sideways and back at snow level (never a cloud
 * over the tumbling body), scaled by the skier's speed at the crash.
 */
export function crashBurst(speed: number, out: BurstParams): BurstParams {
  const v = Math.max(0, speed);
  out.count = Math.round(Math.min(160, 40 + v * 5));
  out.throwSpeed = 2 + Math.min(4, v * 0.2);
  out.spread = 1.5 + Math.min(2.5, v * 0.12);
  out.upward = 0.6 + Math.min(0.8, v * 0.04);
  out.sizeScale = 1.4 + Math.min(0.6, v * 0.03);
  return out;
}

/** Trailing puffs per second while the crashed body slides (a thin plume, not a wall). */
export function crashTrailRate(speed: number): number {
  return speed < 1.5 ? 0 : Math.min(24, speed * 1.6);
}
