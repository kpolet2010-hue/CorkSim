import { Vector3 } from 'three';
import type { Terrain } from '../terrain/Terrain';
import type { FeatureSample, SurfaceFeature, SurfaceType } from './SurfaceFeatures';

export interface SurfaceSample {
  /** Snow surface height at the query point. */
  height: number;
  /** Unit surface normal. */
  normal: Vector3;
  type: SurfaceType;
  /** Id of the feature providing the surface, or null for plain terrain. */
  featureId: string | null;
}

export function createSurfaceSample(): SurfaceSample {
  return { height: 0, normal: new Vector3(0, 1, 0), type: 'snow', featureId: null };
}

/**
 * The complete skiable snow surface: terrain plus all snow features (union by maximum offset).
 * This is the collision query used by the ski contact model. It is analytic, allocation free and
 * deterministic, which keeps ground contact smooth and makes headless simulation tests reliable.
 */
export class SurfaceField {
  readonly terrain: Terrain;
  readonly features: SurfaceFeature[];
  private readonly _feature: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };
  private readonly _grad = { x: 0, z: 0 };

  constructor(terrain: Terrain, features: SurfaceFeature[]) {
    this.terrain = terrain;
    this.features = features;
  }

  sample(x: number, z: number, out: SurfaceSample): SurfaceSample {
    const base = this.terrain.height(x, z);
    this.terrain.gradient(x, z, this._grad);
    let best = 0;
    let gx = 0;
    let gz = 0;
    let type: SurfaceType = 'snow';
    let featureId: string | null = null;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i];
      if (f.sample(x, z, this._feature) && this._feature.offset > best) {
        best = this._feature.offset;
        gx = this._feature.gradX;
        gz = this._feature.gradZ;
        type = this._feature.type;
        featureId = f.id;
      }
    }
    out.height = base + best;
    const nx = -(this._grad.x + gx);
    const nz = -(this._grad.z + gz);
    out.normal.set(nx, 1, nz).normalize();
    out.type = type;
    out.featureId = featureId;
    return out;
  }

  /** Height only (cheaper when the normal is not required). */
  height(x: number, z: number): number {
    let best = 0;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i];
      if (f.sample(x, z, this._feature) && this._feature.offset > best) best = this._feature.offset;
    }
    return this.terrain.height(x, z) + best;
  }

  /** Feature-only offset at a point (0 on plain terrain). */
  featureOffset(x: number, z: number): number {
    return this.height(x, z) - this.terrain.height(x, z);
  }
}
