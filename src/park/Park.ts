import { Vector3 } from 'three';
import { Random } from '../core/Random';
import { RailPath } from '../rails/RailPath';
import { Terrain } from '../terrain/Terrain';
import { SurfaceField } from './SurfaceField';
import { KickerLanding, KickerTakeoff, Ramp, Roller, type SurfaceFeature } from './SurfaceFeatures';
import type { KickerConfig, ParkConfig, RailObstacleConfig, RailShape } from './types';

/**
 * Safety nets along both corridor edges: at |x| = halfWidth − FENCE_INSET, posts every FENCE_SPACING m from
 * z = FENCE_START to the course length, FENCE_HEIGHT m tall. Rendered by ParkMeshes; solid only for the crash
 * ragdoll (PhysicsWorld), so a sliding body is caught by the net instead of passing through it.
 */
export const FENCE_INSET = 1.5;
export const FENCE_START = 20;
export const FENCE_SPACING = 4;
export const FENCE_HEIGHT = 1.25;

export interface Kicker {
  config: KickerConfig;
  takeoff: KickerTakeoff;
  landing: KickerLanding;
}

export interface RailObstacle {
  id: string;
  config: RailObstacleConfig;
  kind: 'rail' | 'box';
  shape: RailShape;
  path: RailPath;
  /** Half width of the sliding surface (m). Rails are thin pipes. */
  halfWidth: number;
  /** Scoring difficulty multiplier. */
  difficulty: number;
  /** Positions of the support posts (base on the snow, top under the rail). */
  supports: { base: Vector3; top: Vector3 }[];
  /** Entry ramp feature id if one was generated. */
  rampId: string | null;
}

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

const SHAPE_DIFFICULTY: Record<RailShape, number> = {
  straight: 1,
  down: 1.15,
  up: 1.3,
  kinked: 1.4,
  curved: 1.35,
  rainbow: 1.3,
};

/**
 * A fully constructed snowpark: terrain, snow features, rails/boxes and scenery placement, all built from
 * a ParkConfig. The park is pure data + geometry queries (no rendering) so it can be used headless.
 */
export class Park {
  readonly config: ParkConfig;
  readonly terrain: Terrain;
  readonly surface: SurfaceField;
  readonly kickers: Kicker[] = [];
  readonly ramps: Ramp[] = [];
  readonly rollers: Roller[] = [];
  readonly rails: RailObstacle[] = [];
  readonly trees: TreeInstance[] = [];

  constructor(config: ParkConfig) {
    this.config = config;
    this.terrain = new Terrain(config.terrain, config.seed);
    const features: SurfaceFeature[] = [];

    for (const f of config.features) {
      if (f.type === 'kicker') {
        const takeoff = new KickerTakeoff(f);
        const landing = new KickerLanding(f, takeoff.length);
        this.kickers.push({ config: f, takeoff, landing });
        features.push(takeoff, landing);
      } else if (f.type === 'ramp') {
        const r = new Ramp(f);
        this.ramps.push(r);
        features.push(r);
      } else {
        const r = new Roller(f);
        this.rollers.push(r);
        features.push(r);
      }
    }

    // Rails are positioned relative to the snow, so build their entry ramps first using terrain height.
    for (const rc of config.rails) {
      let rampId: string | null = null;
      if (rc.entryRamp) {
        const [x0, h0, z0] = rc.points[0];
        const [x1, , z1] = rc.points[1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        const yaw = Math.atan2(dx / len, dz / len);
        const rampLength = Math.max(3, h0 * 5.5);
        const gapBefore = 0.15;
        const ramp = new Ramp({
          id: rc.id + ':ramp',
          type: 'ramp',
          x: x0 - (dx / len) * (rampLength + gapBefore),
          z: z0 - (dz / len) * (rampLength + gapBefore),
          yawDeg: (yaw * 180) / Math.PI,
          width: Math.max(1.6, (rc.width ?? 0.3) + 1.2),
          length: rampLength,
          height: Math.max(0.1, h0 - 0.08),
        });
        this.ramps.push(ramp);
        features.push(ramp);
        rampId = ramp.id;
      }
      const control = rc.points.map(([x, hh, z]) => new Vector3(x, this.terrain.height(x, z) + hh, z));
      const path = rc.smooth ? RailPath.fromSmoothControlPoints(control) : new RailPath(control);
      const halfWidth = rc.kind === 'box' ? (rc.width ?? 0.5) / 2 : 0.03;
      const supports: { base: Vector3; top: Vector3 }[] = [];
      const postCount = Math.max(2, Math.ceil(path.totalLength / 3.2) + 1);
      const tmp = new Vector3();
      for (let i = 0; i < postCount; i++) {
        const s = Math.min(path.totalLength - 0.2, Math.max(0.2, (i / (postCount - 1)) * path.totalLength));
        path.pointAt(s, tmp);
        const top = tmp.clone();
        top.y -= rc.kind === 'box' ? 0.12 : 0.04;
        const base = new Vector3(top.x, this.terrain.height(top.x, top.z) - 0.3, top.z);
        supports.push({ base, top });
      }
      this.rails.push({
        id: rc.id,
        config: rc,
        kind: rc.kind,
        shape: rc.shape,
        path,
        halfWidth,
        difficulty: SHAPE_DIFFICULTY[rc.shape] * (rc.kind === 'rail' ? 1.2 : 1),
        supports,
        rampId,
      });
    }

    this.surface = new SurfaceField(this.terrain, features);
    this.placeTrees();
  }

  private placeTrees(): void {
    const rng = new Random(this.config.seed * 31 + 7);
    const t = this.config.terrain;
    const minAbsX = t.halfWidth + this.config.trees.corridorMargin;
    let attempts = 0;
    while (this.trees.length < this.config.trees.count && attempts < this.config.trees.count * 20) {
      attempts++;
      const side = rng.next() < 0.5 ? -1 : 1;
      // Denser near the corridor, thinning out towards the valley walls.
      const dist = minAbsX + Math.pow(rng.next(), 1.6) * 150;
      const x = side * dist;
      const z = rng.range(-140, t.length + 260);
      const clusterNoise = Math.sin(z * 0.045 + side * 1.3) + Math.sin(z * 0.013 + x * 0.02);
      if (clusterNoise < -0.7 && rng.next() < 0.75) continue; // clearings
      const y = this.terrain.height(x, z);
      this.trees.push({ x, y, z, scale: rng.range(0.75, 1.45), rotation: rng.range(0, Math.PI * 2) });
    }
  }

  /** Spawn point on the snow, facing downhill. */
  spawnPosition(out: Vector3): Vector3 {
    const { x, z } = this.config.spawn;
    return out.set(x, this.surface.height(x, z), z);
  }

  getRail(id: string): RailObstacle | undefined {
    return this.rails.find((r) => r.id === id);
  }
}
