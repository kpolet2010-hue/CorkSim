import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../config/scoringConfig';
import { DEFAULT_GRAB_CONFIG } from '../tricks/GrabSystem';
import { getGrabById } from '../tricks/grabs';
import type { AirTrick } from '../tricks/TrickRecognition';
import type { LandingQuality } from '../landing/LandingEvaluator';
import type { RailTrick } from '../rails/RailSystem';

export interface ScoredTrick {
  id: number;
  name: string;
  points: number;
  basePoints: number;
  landing: LandingQuality;
  repetitionFactor: number;
  kind: 'air' | 'rail';
}

export interface ComboState {
  active: boolean;
  tricks: number;
  uniqueTricks: number;
  points: number;
  multiplier: number;
}

export interface RunScore {
  total: number;
  tricks: ScoredTrick[];
  bestTrick: ScoredTrick | null;
  combos: number;
  bestCombo: number;
}

/** Rotation points: progressive so a 1080 is worth much more than three 360s. */
export function spinPoints(deg: number, cfg: ScoringConfig): number {
  if (deg <= 0) return 0;
  return cfg.spinBase * Math.pow(deg / 180, cfg.spinExponent);
}

/** Pure, deterministic base score of an aerial trick before landing/repetition factors. */
export function scoreAirTrick(t: AirTrick, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG): number {
  let pts = 0;
  switch (t.category) {
    case 'straight':
      pts = cfg.straightAirPoints;
      break;
    case 'spin':
      pts = spinPoints(t.spinDegrees, cfg);
      break;
    case 'flip': {
      pts = cfg.flipPoints * t.flips * Math.pow(cfg.multiFlipBonus, t.flips - 1);
      if (t.flipDirection === 'side') pts *= cfg.sideFlipMultiplier;
      break;
    }
    case 'offaxis': {
      const type = t.offAxisType ?? 'cork';
      pts =
        spinPoints(t.spinDegrees, cfg) * cfg.offAxisMultiplier * cfg.offAxisTypeMultiplier[type] +
        cfg.inversionPoints * t.flips * Math.pow(cfg.multiFlipBonus, t.flips - 1);
      break;
    }
  }
  let grabPts = 0;
  for (const g of t.grabs) {
    const def = getGrabById(g.id);
    const held = Math.min(g.duration, DEFAULT_GRAB_CONFIG.maxScoredDuration);
    grabPts += (def?.baseScore ?? 100) + held * cfg.grabHoldPointsPerSecond;
  }
  if (grabPts > 0 && t.category !== 'straight') pts = (pts + grabPts) * cfg.grabRotationCombo;
  else pts += grabPts;
  if (t.switchTakeoff && t.category !== 'straight') pts *= cfg.switchMultiplier;
  pts += Math.max(0, t.airTime - cfg.airtimeThreshold) * cfg.airtimePointsPerSecond;
  return Math.round(pts);
}

export function scoreRailTrick(t: RailTrick, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG): number {
  const r = cfg.rail;
  let pts = r.stancePoints[t.stance];
  if (t.press !== 'none') pts += r.pressPoints;
  pts += t.distance * r.pointsPerMeter;
  pts += ((t.entrySpinDeg + t.outSpinDeg) / 90) * r.spinPointsPer90;
  pts *= t.difficulty * (t.kind === 'rail' ? r.railMultiplier : r.boxMultiplier);
  return Math.round(pts);
}

/**
 * Run scoring: individual trick points (after landing quality and repetition penalties) are banked
 * immediately. Consecutive tricks form a combo ("line") whose multiplier grows with length and variety;
 * the combo bonus is banked when the line ends cleanly and lost on a crash. Fully deterministic.
 */
export class ScoringSystem {
  readonly cfg: ScoringConfig;
  private total = 0;
  private readonly tricks: ScoredTrick[] = [];
  private readonly repetitions = new Map<string, number>();
  private nextId = 1;
  private comboTricks = 0;
  private comboPoints = 0;
  private comboSignatures = new Set<string>();
  private groundTimer = 0;
  private combosCompleted = 0;
  private bestCombo = 0;

  constructor(cfg: ScoringConfig = DEFAULT_SCORING_CONFIG) {
    this.cfg = cfg;
  }

  reset(): void {
    this.total = 0;
    this.tricks.length = 0;
    this.repetitions.clear();
    this.nextId = 1;
    this.resetCombo();
    this.combosCompleted = 0;
    this.bestCombo = 0;
  }

  private resetCombo(): void {
    this.comboTricks = 0;
    this.comboPoints = 0;
    this.comboSignatures.clear();
    this.groundTimer = 0;
  }

  get combo(): ComboState {
    return {
      active: this.comboTricks > 0,
      tricks: this.comboTricks,
      uniqueTricks: this.comboSignatures.size,
      points: this.comboPoints,
      multiplier: this.comboMultiplier(),
    };
  }

  get totalScore(): number {
    return this.total;
  }

  comboMultiplier(): number {
    if (this.comboTricks <= 1) return 1;
    const c = this.cfg.combo;
    const m =
      1 +
      (this.comboTricks - 1) * c.multiplierStep +
      Math.max(0, this.comboSignatures.size - 1) * c.varietyStep;
    return Math.min(c.maxMultiplier, m);
  }

  repetitionFactorFor(signature: string): number {
    const n = this.repetitions.get(signature) ?? 0;
    return Math.max(this.cfg.minRepetitionFactor, Math.pow(this.cfg.repetitionFactor, n));
  }

  /** Registers a landed (or crashed) trick and returns its scored entry. */
  addTrick(
    name: string,
    signature: string,
    basePoints: number,
    landing: LandingQuality,
    kind: 'air' | 'rail',
  ): ScoredTrick {
    const rep = this.repetitionFactorFor(signature);
    const landingFactor = this.cfg.landing[landing];
    const points = Math.round(basePoints * rep * landingFactor);
    const entry: ScoredTrick = {
      id: this.nextId++,
      name,
      points,
      basePoints,
      landing,
      repetitionFactor: rep,
      kind,
    };
    this.tricks.push(entry);
    if (landing === 'crash') {
      this.breakCombo();
      return entry;
    }
    this.repetitions.set(signature, (this.repetitions.get(signature) ?? 0) + 1);
    this.total += points;
    this.comboTricks++;
    this.comboPoints += points;
    this.comboSignatures.add(signature);
    this.groundTimer = 0;
    return entry;
  }

  /** Called every step while riding on the ground; ends the line after the timeout. Returns banked bonus. */
  updateGround(dt: number): number {
    if (this.comboTricks === 0) return 0;
    this.groundTimer += dt;
    if (this.groundTimer >= this.cfg.combo.groundTimeout) return this.endCombo();
    return 0;
  }

  /** Keeps the line alive while in the air or on a rail. */
  keepAlive(): void {
    this.groundTimer = 0;
  }

  /** Ends the current combo cleanly, banking the bonus. Returns the bonus points. */
  endCombo(): number {
    if (this.comboTricks === 0) return 0;
    const bonus = Math.round(this.comboPoints * (this.comboMultiplier() - 1));
    this.total += bonus;
    if (this.comboTricks > 1) this.combosCompleted++;
    this.bestCombo = Math.max(this.bestCombo, this.comboPoints + bonus);
    this.resetCombo();
    return bonus;
  }

  /** Crash: the unbanked combo bonus is lost. */
  breakCombo(): void {
    this.resetCombo();
  }

  getRunScore(): RunScore {
    let best: ScoredTrick | null = null;
    for (const t of this.tricks) if (!best || t.points > best.points) best = t;
    return {
      total: this.total,
      tricks: [...this.tricks],
      bestTrick: best,
      combos: this.combosCompleted,
      bestCombo: this.bestCombo,
    };
  }
}
