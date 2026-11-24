import { Vector3 } from 'three';

/**
 * Per-park art direction (render only - nothing here affects physics). See docs/architecture/ART_DIRECTION.md.
 * Colours are linear-ish hex values fed to three.js colour management (sRGB hex -> linear working space).
 */
export interface ParkTheme {
  /** Direction *towards* the sun (unit). */
  sunDirection: Vector3;
  sunColor: number;
  sunIntensity: number;
  /** Hemisphere fill: sky (blue, fills shadows) and ground bounce. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  environmentIntensity: number;
  exposure: number;
  /** Preetham sky parameters. */
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** Sky radiance scale and saturation (applied in the sky shader before tone mapping). */
  skyGain: number;
  skySaturation: number;
  /** Multiplier on the sky right above the horizon (fades out by ~25 deg elevation). */
  horizonTint: number;
  fogColor: number;
  fogDensity: number;
  /** Snow albedo on the groomed piste and off-piste. */
  pisteColor: number;
  /** Tint of steep or shaded faces on the backdrop: rock and glacier ice. */
  rockColor: number;
  iceColor: number;
  /** 0..1 how much of the steep high backdrop is glacier ice instead of rock. */
  glacier: number;
  /** Park accent colours: gates, flags, sign boards. */
  accent: number;
  accentDark: number;
  dyeColor: number;
  netColor: number;
  railColors: number[];
  /** Post grade (display space). */
  grade: { contrast: number; saturation: number; vignette: number; lift: [number, number, number] };
}

const GLACIER: ParkTheme = {
  sunDirection: new Vector3(0.78, 0.66, 0.2).normalize(),
  sunColor: 0xfff4e2,
  sunIntensity: 4.2,
  hemiSky: 0x8fb4ea,
  hemiGround: 0xdfe6f0,
  hemiIntensity: 0.75,
  environmentIntensity: 0.35,
  exposure: 1.3,
  turbidity: 1.8,
  rayleigh: 2.4,
  mieCoefficient: 0.0022,
  mieDirectionalG: 0.84,
  skyGain: 0.24,
  horizonTint: 0x8fb0e6,
  skySaturation: 1.5,
  fogColor: 0x9cbde6,
  fogDensity: 0.0008,
  pisteColor: 0xf6f9ff,
  rockColor: 0x4b4d55,
  iceColor: 0x8fc2dc,
  glacier: 0.55,
  accent: 0x0e4d92,
  accentDark: 0x08223f,
  dyeColor: 0x2f63d8,
  netColor: 0xff5a14,
  railColors: [0x1fb6ff, 0xff5a1f, 0xffd21f, 0x9b5cff, 0x22d39b],
  grade: { contrast: 1.05, saturation: 1.1, vignette: 0.2, lift: [0.0, 0.004, 0.012] },
};

const BIG_AIR: ParkTheme = {
  sunDirection: new Vector3(-0.8, 0.45, 0.32).normalize(),
  sunColor: 0xfff0dc,
  sunIntensity: 4.3,
  hemiSky: 0x86a8de,
  hemiGround: 0xe2e6ee,
  hemiIntensity: 0.72,
  environmentIntensity: 0.35,
  exposure: 1.3,
  turbidity: 2.6,
  rayleigh: 2.8,
  mieCoefficient: 0.003,
  mieDirectionalG: 0.86,
  skyGain: 0.27,
  horizonTint: 0x98b2e0,
  skySaturation: 1.4,
  fogColor: 0xa7bddc,
  fogDensity: 0.00085,
  pisteColor: 0xf8fbff,
  rockColor: 0x3e3833,
  iceColor: 0x9ab9cc,
  glacier: 0.12,
  accent: 0xd8321e,
  accentDark: 0x9a2416,
  dyeColor: 0x2f5fd0,
  netColor: 0xff3d1a,
  railColors: [0xff3d1a, 0xffc21f, 0xf4f4f4, 0x1fb6ff, 0xff7a1f],
  grade: { contrast: 1.06, saturation: 1.08, vignette: 0.22, lift: [0.006, 0.004, 0.0] },
};

const THEMES: Record<string, ParkTheme> = {
  'glacier-park': GLACIER,
  'big-air': BIG_AIR,
};

/** Theme for a park id; unknown parks use the Glacier look. */
export function getParkTheme(parkId: string): ParkTheme {
  return THEMES[parkId] ?? GLACIER;
}
