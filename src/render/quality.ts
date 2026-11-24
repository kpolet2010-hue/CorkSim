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
  /**
   * Default-framebuffer MSAA. Off when post-processing is on: the composer renders into its own (optionally
   * multisampled) HDR target, so default-framebuffer samples would only cost memory.
   */
  antialias: boolean;
  /** Post chain (EffectComposer: render -> [bloom] -> OutputPass -> grade/vignette). Off = direct render. */
  post: boolean;
  /** MSAA samples on the composer's HDR target (0 = none). Only used when `post` is on. */
  postSamples: number;
  /** Half-resolution highlight bloom (sparkle, sparks, sun glints). Only used when `post` is on. */
  bloom: boolean;
  /** Instanced rocks and snow mounds outside the corridor. */
  rocks: number;
  mounds: number;
  /** Rail spark particle pool. */
  sparks: number;
  /** Fine corduroy normal detail on the groomed piste (the grooming-lane pattern is always on). */
  corduroy: boolean;
}

export const QUALITY: Record<GraphicsQuality, QualityProfile> = {
  low: {
    shadowMapSize: 1024,
    shadows: false,
    pixelRatioCap: 1,
    terrainSpacing: 3,
    featureResolution: 0.6,
    treeFraction: 0.45,
    spray: 900,
    snowfall: 0,
    sparkle: false,
    antialias: false,
    post: false,
    postSamples: 0,
    bloom: false,
    rocks: 70,
    mounds: 40,
    sparks: 120,
    corduroy: false,
  },
  medium: {
    shadowMapSize: 2048,
    shadows: true,
    pixelRatioCap: 1.5,
    terrainSpacing: 2,
    featureResolution: 0.4,
    treeFraction: 0.75,
    spray: 1600,
    snowfall: 1200,
    sparkle: true,
    antialias: false,
    post: true,
    postSamples: 2,
    bloom: false,
    rocks: 160,
    mounds: 90,
    sparks: 260,
    corduroy: true,
  },
  high: {
    shadowMapSize: 4096,
    shadows: true,
    pixelRatioCap: 2,
    terrainSpacing: 1.5,
    featureResolution: 0.3,
    treeFraction: 1,
    spray: 2400,
    snowfall: 2500,
    sparkle: true,
    antialias: false,
    post: true,
    postSamples: 2,
    bloom: true,
    rocks: 260,
    mounds: 140,
    sparks: 420,
    corduroy: true,
  },
};
