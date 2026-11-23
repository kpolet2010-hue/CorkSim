import type { LandingResult } from '../landing/LandingEvaluator';
import type { PlayerState } from '../player/PlayerState';
import type { RailStance, RailTrick } from '../rails/RailSystem';
import type { RunScore, ScoredTrick } from '../scoring/ScoringSystem';
import type { SurfaceType } from '../park/SurfaceFeatures';
import type { AirTrick } from '../tricks/TrickRecognition';

export interface SimEvents {
  stateChanged: { from: PlayerState; to: PlayerState };
  takeoff: { speed: number; surface: SurfaceType; featureId: string | null; pop: number; fromRail: boolean };
  landed: { result: LandingResult; airTime: number };
  trickLanded: { scored: ScoredTrick; air: AirTrick | null; rail: RailTrick | null };
  crash: { reason: string; impactSpeed: number };
  recovered: Record<string, never>;
  railStart: { railId: string; label: string; stance: RailStance; kind: 'rail' | 'box' };
  railEnd: { railId: string; bailed: boolean };
  grabStart: { name: string };
  grabEnd: { name: string };
  comboEnded: { bonus: number; points: number; multiplier: number; tricks: number };
  reset: { restart: boolean };
  runFinished: { score: RunScore; time: number };
}
