import type { ParkConfig, RailObstacleConfig, SurfaceFeatureConfig } from '../park/types';

/** A wide, uniform slope without noise or banks: ideal for checking physics against closed-form results. */
export function makeSlopePark(
  deg: number,
  extra: { features?: SurfaceFeatureConfig[]; rails?: RailObstacleConfig[] } = {},
): ParkConfig {
  return {
    id: 'test-slope',
    name: 'Test Slope',
    description: 'Uniform slope used by tests',
    seed: 1,
    terrain: {
      length: 2000,
      halfWidth: 400,
      bankHeight: 0,
      noiseAmplitude: 0,
      slopeProfile: [{ z: -200, deg }],
    },
    spawn: { x: 0, z: 0 },
    finishZ: 1900,
    features: extra.features ?? [],
    rails: extra.rails ?? [],
    trees: { count: 0, corridorMargin: 10 },
  };
}
