import { fbm2 } from '../core/Random';
import { DEG2RAD, smoothstep } from '../core/math';
import type { TerrainConfig } from '../park/types';

export interface Gradient2 {
  x: number;
  z: number;
}

const PROFILE_STEP = 0.5;
const PROFILE_START = -160;

/**
 * Procedural mountain terrain expressed as a smooth analytic height function h(x, z).
 *
 * The longitudinal profile is integrated from a list of slope-angle control points so designers can
 * author the run as "steep start, mellow park, flat finish". Laterally the corridor is bounded by
 * snowbanks and the valley walls rise into the mountains. A low-amplitude fractal noise adds natural
 * undulation. Because the function is C1-continuous the ski contact normals are stable (no faceting),
 * and the render mesh samples the very same function.
 */
export class Terrain {
  readonly config: TerrainConfig;
  readonly seed: number;
  private readonly heights: Float64Array;
  private readonly slopes: Float64Array;
  readonly zMin = PROFILE_START;
  readonly zMax: number;

  constructor(config: TerrainConfig, seed: number) {
    this.config = config;
    this.seed = seed;
    this.zMax = config.length + 400;
    const n = Math.ceil((this.zMax - this.zMin) / PROFILE_STEP) + 1;
    this.heights = new Float64Array(n);
    this.slopes = new Float64Array(n);
    // Integrate height from slope angle (trapezoidal rule). slope = dh/dz (negative going downhill).
    let h = 0;
    let prevSlope = -Math.tan(this.slopeAngleAt(this.zMin));
    for (let i = 0; i < n; i++) {
      const z = this.zMin + i * PROFILE_STEP;
      const s = -Math.tan(this.slopeAngleAt(z));
      if (i > 0) h += 0.5 * (s + prevSlope) * PROFILE_STEP;
      this.heights[i] = h;
      this.slopes[i] = s;
      prevSlope = s;
    }
    // Re-base so that z = 0 sits at height 0 (spawn area).
    const h0 = this.baseHeight(0);
    for (let i = 0; i < n; i++) this.heights[i] -= h0;
  }

  /** Slope angle (radians) of the authored profile at a given distance downhill. */
  slopeAngleAt(z: number): number {
    const pts = this.config.slopeProfile;
    if (pts.length === 0) return 0;
    if (z <= pts[0].z) return pts[0].deg * DEG2RAD;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (z <= b.z) {
        const t = smoothstep(a.z, b.z, z);
        return (a.deg + (b.deg - a.deg) * t) * DEG2RAD;
      }
    }
    return pts[pts.length - 1].deg * DEG2RAD;
  }

  /** Longitudinal base height with cubic Hermite interpolation (C1). */
  baseHeight(z: number): number {
    const fz = (Math.min(Math.max(z, this.zMin), this.zMax) - this.zMin) / PROFILE_STEP;
    const i = Math.min(Math.floor(fz), this.heights.length - 2);
    const t = fz - i;
    const h0 = this.heights[i];
    const h1 = this.heights[i + 1];
    const m0 = this.slopes[i] * PROFILE_STEP;
    const m1 = this.slopes[i + 1] * PROFILE_STEP;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1;
  }

  /** Lateral shape: groomed corridor, snowbanks, then rising valley walls. */
  private lateral(x: number, z: number): number {
    const ax = Math.abs(x);
    const w = this.config.halfWidth;
    // Slight wobble of the corridor edge so the banks don't look ruler-straight.
    const edge = w + 6 * fbm2(z * 0.006, x > 0 ? 3.1 : 7.7, this.seed + 17, 2);
    const bank = this.config.bankHeight * smoothstep(edge - 2, edge + 14, ax);
    const wall = Math.max(0, ax - edge - 20);
    const valley = 0.0009 * wall * wall * 10 + 0.12 * wall;
    const crown = 0.0006 * x * x;
    return crown + bank + valley;
  }

  private noise(x: number, z: number): number {
    const ax = Math.abs(x);
    const w = this.config.halfWidth;
    const outside = smoothstep(w, w + 40, ax);
    const amp = this.config.noiseAmplitude * (1 + outside * 14);
    return amp * fbm2(x / 38, z / 38, this.seed, 3) + outside * 4 * fbm2(x / 90, z / 90, this.seed + 5, 3);
  }

  height(x: number, z: number): number {
    return this.baseHeight(z) + this.lateral(x, z) + this.noise(x, z);
  }

  /** Central difference gradient. The height function is smooth so a modest epsilon is accurate. */
  gradient(x: number, z: number, out: Gradient2): Gradient2 {
    const e = 0.2;
    out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return out;
  }
}
