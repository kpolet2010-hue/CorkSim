/**
 * Data-driven snowpark description. Parks are authored as JSON (see ./parks) and validated by ParkLoader.
 * Coordinates: X across the slope (+X = skier's left when facing downhill), Y up, Z downhill.
 */

export interface SlopeControlPoint {
  /** Distance downhill (m). */
  z: number;
  /** Slope angle in degrees at that point (positive = descending). */
  deg: number;
}

export interface TerrainConfig {
  /** Total length of the skiable run (m). */
  length: number;
  /** Half width of the groomed park corridor (m). */
  halfWidth: number;
  /** Height of the snowbanks lining the corridor (m). */
  bankHeight: number;
  /** Amplitude of the subtle surface undulation inside the corridor (m). */
  noiseAmplitude: number;
  slopeProfile: SlopeControlPoint[];
}

interface FeatureBase {
  id: string;
  /** World X of the feature origin (start of the feature). */
  x: number;
  /** World Z of the feature origin. */
  z: number;
  /** Direction of travel over the feature, degrees. 0 = straight downhill (+Z). */
  yawDeg?: number;
  /** Display label, e.g. "M" or "XL". */
  label?: string;
}

export interface KickerConfig extends FeatureBase {
  type: 'kicker';
  /** Width of the takeoff ramp (m). */
  width: number;
  /** Lip height above the base slope (m). */
  height: number;
  /** Takeoff angle at the lip relative to the base slope (deg). */
  takeoffAngleDeg: number;
  /** Length of the flat table between lip and knuckle (m). */
  gap: number;
  /** Table (deck) height above the base slope (m). */
  deckHeight: number;
  /** Landing slope steepness relative to the base slope (deg). */
  landingAngleDeg: number;
  /** Width of the landing hill (m). Defaults to 1.6x takeoff width. */
  landingWidth?: number;
}

export interface RampConfig extends FeatureBase {
  type: 'ramp';
  width: number;
  length: number;
  height: number;
}

export interface RollerConfig extends FeatureBase {
  type: 'roller';
  width: number;
  length: number;
  height: number;
}

export type SurfaceFeatureConfig = KickerConfig | RampConfig | RollerConfig;

export type RailShape = 'straight' | 'kinked' | 'curved' | 'down' | 'up' | 'rainbow';

export interface RailObstacleConfig {
  id: string;
  /** 'rail' = round pipe; 'box' = wide flat sliding surface. */
  kind: 'rail' | 'box';
  shape: RailShape;
  /** Control points [x, heightAboveSnow, z]. Straight segments unless `smooth` is set. */
  points: [number, number, number][];
  /** Interpolate a smooth curve through the points (curved / rainbow features). */
  smooth?: boolean;
  /** Box surface width (m). Ignored for rails. */
  width?: number;
  /** Build a snow on-ramp leading up to the first point. */
  entryRamp?: boolean;
  label?: string;
}

export interface TreeConfig {
  count: number;
  /** Trees are kept this far outside the corridor edge (m). */
  corridorMargin: number;
}

export interface ParkConfig {
  id: string;
  name: string;
  description: string;
  seed: number;
  terrain: TerrainConfig;
  spawn: { x: number; z: number };
  finishZ: number;
  features: SurfaceFeatureConfig[];
  rails: RailObstacleConfig[];
  trees: TreeConfig;
}
