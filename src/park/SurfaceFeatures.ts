import { DEG2RAD, smoothstep, smoothstepDerivative } from '../core/math';
import type { KickerConfig, RampConfig, RollerConfig } from './types';

/** What kind of snow surface the skier is standing on. Used for takeoff/landing logic and scoring. */
export type SurfaceType = 'snow' | 'kicker' | 'deck' | 'landing' | 'ramp' | 'roller';

export interface FeatureSample {
  /** Height offset above the base terrain (m). */
  offset: number;
  /** d(offset)/dx in world space. */
  gradX: number;
  /** d(offset)/dz in world space. */
  gradZ: number;
  type: SurfaceType;
}

/** 1D longitudinal profile result. */
interface ProfileSample {
  h: number;
  dh: number;
  type: SurfaceType;
}

/**
 * Base class for snow features (kickers, landings, ramps, rollers) defined as height offsets on top of
 * the terrain. Each feature has a local frame: u along the direction of travel, w across (to the left).
 * Offsets are analytic so we can compute exact gradients and therefore smooth contact normals.
 */
export abstract class SurfaceFeature {
  readonly id: string;
  readonly originX: number;
  readonly originZ: number;
  readonly yaw: number;
  readonly dirX: number;
  readonly dirZ: number;
  /** Bounding box in world XZ for cheap rejection. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  protected constructor(
    id: string,
    x: number,
    z: number,
    yawDeg: number,
    readonly uStart: number,
    readonly uEnd: number,
    readonly halfWidth: number,
    readonly sideWidth: number,
  ) {
    this.id = id;
    this.originX = x;
    this.originZ = z;
    this.yaw = yawDeg * DEG2RAD;
    this.dirX = Math.sin(this.yaw);
    this.dirZ = Math.cos(this.yaw);
    const r = halfWidth + sideWidth;
    const corners: [number, number][] = [
      [uStart, -r],
      [uStart, r],
      [uEnd, -r],
      [uEnd, r],
    ];
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const [u, w] of corners) {
      const wx = x + this.dirX * u + this.dirZ * w;
      const wz = z + this.dirZ * u - this.dirX * w;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
  }

  /** Converts world XZ into local (u, w). */
  toLocal(x: number, z: number, out: { u: number; w: number }): void {
    const dx = x - this.originX;
    const dz = z - this.originZ;
    out.u = dx * this.dirX + dz * this.dirZ;
    // left axis = (dirZ, -dirX)
    out.w = dx * this.dirZ - dz * this.dirX;
  }

  /** Converts local (u, w) into world XZ. */
  toWorld(u: number, w: number, out: { x: number; z: number }): void {
    out.x = this.originX + this.dirX * u + this.dirZ * w;
    out.z = this.originZ + this.dirZ * u - this.dirX * w;
  }

  protected abstract profile(u: number, out: ProfileSample): boolean;

  /** Half width of the flat top at a given u (allows a landing to be wider than a takeoff). */
  protected widthAt(_u: number): number {
    return this.halfWidth;
  }

  private readonly _local = { u: 0, w: 0 };
  private readonly _profile: ProfileSample = { h: 0, dh: 0, type: 'snow' };

  sample(x: number, z: number, out: FeatureSample): boolean {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    this.toLocal(x, z, this._local);
    const { u, w } = this._local;
    if (u < this.uStart || u > this.uEnd) return false;
    const hw = this.widthAt(u);
    const aw = Math.abs(w);
    if (aw > hw + this.sideWidth) return false;
    if (!this.profile(u, this._profile)) return false;
    const p = this._profile;
    // Side falloff: smooth shoulders so riding off the side of a feature is not a wall.
    const side = 1 - smoothstep(hw, hw + this.sideWidth, aw);
    const dSide = -smoothstepDerivative(hw, hw + this.sideWidth, aw) * Math.sign(w);
    const offset = p.h * side;
    if (offset <= 1e-4) return false;
    const du = p.dh * side;
    const dw = p.h * dSide;
    // Chain rule back to world: u = dx*dirX + dz*dirZ ; w = dx*dirZ - dz*dirX
    out.offset = offset;
    out.gradX = du * this.dirX + dw * this.dirZ;
    out.gradZ = du * this.dirZ - dw * this.dirX;
    out.type = p.type;
    return true;
  }
}

/**
 * Takeoff ramp: circular transition from flat to the takeoff angle at the lip.
 *   radius R = H / (1 - cos a), length L = R sin a, offset(u) = R - sqrt(R^2 - u^2).
 */
export class KickerTakeoff extends SurfaceFeature {
  readonly radius: number;
  readonly length: number;
  readonly height: number;
  readonly takeoffAngle: number;

  constructor(cfg: KickerConfig) {
    const a = cfg.takeoffAngleDeg * DEG2RAD;
    const radius = cfg.height / (1 - Math.cos(a));
    const length = radius * Math.sin(a);
    super(
      cfg.id + ':takeoff',
      cfg.x,
      cfg.z,
      cfg.yawDeg ?? 0,
      0,
      length,
      cfg.width / 2,
      Math.max(1.2, cfg.height * 0.9),
    );
    this.radius = radius;
    this.length = length;
    this.height = cfg.height;
    this.takeoffAngle = a;
  }

  protected profile(u: number, out: ProfileSample): boolean {
    if (u < 0 || u > this.length) return false;
    const r = this.radius;
    const s = Math.sqrt(Math.max(r * r - u * u, 1e-9));
    out.h = r - s;
    out.dh = u / s;
    out.type = 'kicker';
    return true;
  }
}

/**
 * Landing hill: flat deck (table) at deckHeight, rounded knuckle, straight landing slope, and a rounded
 * transition back into the base slope.
 */
export class KickerLanding extends SurfaceFeature {
  readonly deckStart: number;
  readonly knuckleStart: number;
  readonly deckHeight: number;
  readonly landingSlope: number;
  private readonly kLen: number;
  private readonly linearLen: number;
  private readonly bottomLen: number;
  private readonly takeoffHalfWidth: number;
  readonly landingStart: number;
  readonly landingEnd: number;

  constructor(cfg: KickerConfig, takeoffLength: number) {
    const m = Math.tan(cfg.landingAngleDeg * DEG2RAD);
    const t = cfg.deckHeight;
    // Knuckle and bottom transitions are parabolic blends. Ensure they fit within the total drop.
    const k = Math.min(5, (0.8 * t) / m);
    const kb = k;
    const d1 = (m * k) / 2;
    const d3 = (m * kb) / 2;
    const d2 = Math.max(0, t - d1 - d3);
    const linearLen = d2 / m;
    const deckStart = takeoffLength;
    const knuckleStart = deckStart + cfg.gap;
    const end = knuckleStart + k + linearLen + kb;
    const landingWidth = cfg.landingWidth ?? cfg.width * 1.6;
    super(
      cfg.id + ':landing',
      cfg.x,
      cfg.z,
      cfg.yawDeg ?? 0,
      deckStart - 0.01,
      end,
      landingWidth / 2,
      Math.max(2, t * 0.8),
    );
    this.deckStart = deckStart;
    this.knuckleStart = knuckleStart;
    this.deckHeight = t;
    this.landingSlope = m;
    this.kLen = k;
    this.linearLen = linearLen;
    this.bottomLen = kb;
    this.takeoffHalfWidth = cfg.width / 2;
    this.landingStart = knuckleStart;
    this.landingEnd = end;
  }

  protected override widthAt(u: number): number {
    // The deck widens from the takeoff width to the landing width.
    const t = smoothstep(this.deckStart, this.knuckleStart + this.kLen, u);
    return this.takeoffHalfWidth + (this.halfWidth - this.takeoffHalfWidth) * t;
  }

  protected profile(u: number, out: ProfileSample): boolean {
    const m = this.landingSlope;
    const t = this.deckHeight;
    if (u < this.deckStart - 0.01 || u > this.uEnd) return false;
    if (u <= this.knuckleStart) {
      out.h = t;
      out.dh = 0;
      out.type = 'deck';
      return true;
    }
    let s = u - this.knuckleStart;
    if (s <= this.kLen) {
      out.h = t - (m * s * s) / (2 * this.kLen);
      out.dh = -(m * s) / this.kLen;
      out.type = s < this.kLen * 0.5 ? 'deck' : 'landing';
      return true;
    }
    const h1 = t - (m * this.kLen) / 2;
    s -= this.kLen;
    if (s <= this.linearLen) {
      out.h = h1 - m * s;
      out.dh = -m;
      out.type = 'landing';
      return true;
    }
    const h2 = h1 - m * this.linearLen;
    s -= this.linearLen;
    const kb = this.bottomLen;
    // slope goes from -m to 0 over kb: h = h2 - m s + m s^2/(2kb)
    out.h = Math.max(0, h2 - m * s + (m * s * s) / (2 * kb));
    out.dh = -m + (m * s) / kb;
    out.type = 'landing';
    return true;
  }
}

/** Straight wedge ramp used as an on-ramp to boxes and rails. Ends in a vertical face. */
export class Ramp extends SurfaceFeature {
  readonly length: number;
  readonly height: number;
  constructor(cfg: RampConfig) {
    super(cfg.id, cfg.x, cfg.z, cfg.yawDeg ?? 0, 0, cfg.length, cfg.width / 2, 0.6);
    this.length = cfg.length;
    this.height = cfg.height;
  }

  protected profile(u: number, out: ProfileSample): boolean {
    if (u < 0 || u > this.length) return false;
    // Ease in at the bottom so there is no hard kink when riding onto it.
    const ease = Math.min(1.5, this.length * 0.3);
    const m = this.height / (this.length - ease / 2);
    if (u < ease) {
      out.h = (m * u * u) / (2 * ease);
      out.dh = (m * u) / ease;
    } else {
      out.h = (m * ease) / 2 + m * (u - ease);
      out.dh = m;
    }
    out.type = 'ramp';
    return true;
  }
}

/** Smooth cosine roller. */
export class Roller extends SurfaceFeature {
  readonly length: number;
  readonly height: number;
  constructor(cfg: RollerConfig) {
    super(cfg.id, cfg.x, cfg.z, cfg.yawDeg ?? 0, 0, cfg.length, cfg.width / 2, Math.max(2, cfg.height * 2));
    this.length = cfg.length;
    this.height = cfg.height;
  }

  protected profile(u: number, out: ProfileSample): boolean {
    if (u < 0 || u > this.length) return false;
    const k = (2 * Math.PI) / this.length;
    out.h = (this.height / 2) * (1 - Math.cos(k * u));
    out.dh = (this.height / 2) * k * Math.sin(k * u);
    out.type = 'roller';
    return true;
  }
}
