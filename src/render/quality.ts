import type { GraphicsQuality } from '../config/settings';

/** Rendering cost/quality knobs per graphics preset. Owned by graphics; read by Game, Environment, Effects. */
export interface QualityProfile {
  shadowMapSize: number;
  shadows: boolean;
  pixelRatioCap: number;
  terrainSpacing: number;
  featureResolution: number;
  treeFraction: number;
  spray: number;
  snowfall: number;
  sparkle: boolean;
  antialias: boolean;
}

export const QUALITY: Record<GraphicsQuality, QualityProfile> = {
  low: {
    shadowMapSize: 1024,
    shadows: false,
    pixelRatioCap: 1,
    terrainSpacing: 3,
    featureResolution: 0.6,
    treeFraction: 0.45,
    spray: 600,
    snowfall: 0,
    sparkle: false,
    antialias: false,
  },
  medium: {
    shadowMapSize: 2048,
    shadows: true,
    pixelRatioCap: 1.5,
    terrainSpacing: 2,
    featureResolution: 0.4,
    treeFraction: 0.75,
    spray: 1200,
    snowfall: 1200,
    sparkle: true,
    antialias: true,
  },
  high: {
    shadowMapSize: 4096,
    shadows: true,
    pixelRatioCap: 2,
    terrainSpacing: 1.5,
    featureResolution: 0.3,
    treeFraction: 1,
    spray: 2000,
    snowfall: 2500,
    sparkle: true,
    antialias: true,
  },
};
