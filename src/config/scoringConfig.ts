/** All scoring values in one place so balancing never requires hunting through gameplay code. */
export interface ScoringConfig {
  /** Points for a 180; larger spins scale with `spinExponent`. */
  spinBase: number;
  spinExponent: number;
  flipPoints: number;
  /** Multiplier applied per additional flip (double = flipPoints * 2 * multiFlipBonus). */
  multiFlipBonus: number;
  offAxisMultiplier: number;
  offAxisTypeMultiplier: Record<'cork' | 'bio' | 'misty' | 'rodeo', number>;
  inversionPoints: number;
  sideFlipMultiplier: number;
  /** Bonus per second of airtime beyond the threshold. */
  airtimePointsPerSecond: number;
  airtimeThreshold: number;
  straightAirPoints: number;
  /** Points per second a grab is held (up to the grab system's max duration). */
  grabHoldPointsPerSecond: number;
  /** Multiplier when a grab is combined with a rotation. */
  grabRotationCombo: number;
  switchMultiplier: number;
  landing: { clean: number; sketchy: number; crash: number };
  rail: {
    stancePoints: Record<'fifty' | 'switchFifty' | 'slide', number>;
    pressPoints: number;
    pointsPerMeter: number;
    spinPointsPer90: number;
    boxMultiplier: number;
    railMultiplier: number;
  };
  combo: {
    /** Seconds on the ground after which the current line/combo ends. */
    groundTimeout: number;
    multiplierStep: number;
    maxMultiplier: number;
    /** Extra multiplier for each unique trick within the combo. */
    varietyStep: number;
  };
  /** Score factor for repeating a trick: factor^(times already landed this run). */
  repetitionFactor: number;
  minRepetitionFactor: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  spinBase: 100,
  spinExponent: 1.35,
  flipPoints: 450,
  multiFlipBonus: 1.25,
  offAxisMultiplier: 1.45,
  offAxisTypeMultiplier: { cork: 1, bio: 1.1, misty: 1.05, rodeo: 1.08 },
  inversionPoints: 300,
  sideFlipMultiplier: 1.1,
  airtimePointsPerSecond: 60,
  airtimeThreshold: 0.6,
  straightAirPoints: 50,
  grabHoldPointsPerSecond: 160,
  grabRotationCombo: 1.25,
  switchMultiplier: 1.15,
  landing: { clean: 1, sketchy: 0.5, crash: 0 },
  rail: {
    stancePoints: { fifty: 100, switchFifty: 160, slide: 200 },
    pressPoints: 150,
    pointsPerMeter: 40,
    spinPointsPer90: 120,
    boxMultiplier: 1,
    railMultiplier: 1.15,
  },
  combo: {
    groundTimeout: 4,
    multiplierStep: 0.25,
    maxMultiplier: 4,
    varietyStep: 0.1,
  },
  repetitionFactor: 0.7,
  minRepetitionFactor: 0.2,
};
