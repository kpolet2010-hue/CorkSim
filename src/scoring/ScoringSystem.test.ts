import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '../config/scoringConfig';
import { recognizeAirTrick } from '../tricks/TrickRecognition';
import { ScoringSystem, scoreAirTrick, scoreRailTrick, spinPoints } from './ScoringSystem';
import { formatRailTrickName, railSignature, type RailTrick } from '../rails/RailSystem';

const D = Math.PI / 180;
const trick = (
  spin: number,
  pitch = 0,
  roll = 0,
  inv = 0,
  grabs: { id: string; name: string; duration: number }[] = [],
) =>
  recognizeAirTrick(
    { spin: spin * D, pitch: pitch * D, roll: roll * D, inversions: inv, airTime: 1.5, switchTakeoff: false },
    grabs,
  );

describe('Scoring', () => {
  it('scores harder rotations higher', () => {
    expect(spinPoints(1080, DEFAULT_SCORING_CONFIG)).toBeGreaterThan(
      3 * spinPoints(360, DEFAULT_SCORING_CONFIG),
    );
    expect(scoreAirTrick(trick(720))).toBeGreaterThan(scoreAirTrick(trick(360)));
    expect(scoreAirTrick(trick(-720, 0, -700, 1))).toBeGreaterThan(scoreAirTrick(trick(720)));
    expect(scoreAirTrick(trick(0, -720, 0, 2))).toBeGreaterThan(scoreAirTrick(trick(0, -360, 0, 1)));
  });

  it('grabs and grab duration add points', () => {
    const plain = scoreAirTrick(trick(720));
    const short = scoreAirTrick(trick(720, 0, 0, 0, [{ id: 'mute', name: 'Mute', duration: 0.3 }]));
    const long = scoreAirTrick(trick(720, 0, 0, 0, [{ id: 'mute', name: 'Mute', duration: 1.2 }]));
    expect(short).toBeGreaterThan(plain);
    expect(long).toBeGreaterThan(short);
  });

  it('applies landing quality', () => {
    const s = new ScoringSystem();
    const clean = s.addTrick('A', 'a', 1000, 'clean', 'air');
    const sketchy = s.addTrick('B', 'b', 1000, 'sketchy', 'air');
    const crash = s.addTrick('C', 'c', 1000, 'crash', 'air');
    expect(clean.points).toBe(1000);
    expect(sketchy.points).toBe(500);
    expect(crash.points).toBe(0);
  });

  it('penalises repetition to encourage variety', () => {
    const s = new ScoringSystem();
    const p1 = s.addTrick('720', 'spin720', 1000, 'clean', 'air').points;
    const p2 = s.addTrick('720', 'spin720', 1000, 'clean', 'air').points;
    const p3 = s.addTrick('720', 'spin720', 1000, 'clean', 'air').points;
    expect(p2).toBeLessThan(p1);
    expect(p3).toBeLessThan(p2);
    expect(s.addTrick('Backflip', 'flip', 1000, 'clean', 'air').points).toBe(1000);
  });

  it('builds combo multipliers and banks the bonus when the line ends', () => {
    const s = new ScoringSystem();
    s.addTrick('A', 'a', 500, 'clean', 'air');
    s.addTrick('B', 'b', 500, 'clean', 'rail');
    s.addTrick('C', 'c', 500, 'clean', 'air');
    expect(s.combo.multiplier).toBeGreaterThan(1.4);
    const before = s.totalScore;
    let bonus = 0;
    for (let i = 0; i < 60 * 5 && bonus === 0; i++) bonus = s.updateGround(1 / 60);
    expect(bonus).toBeGreaterThan(0);
    expect(s.totalScore).toBe(before + bonus);
    expect(s.combo.active).toBe(false);
  });

  it('loses the combo bonus on a crash but keeps landed trick points', () => {
    const s = new ScoringSystem();
    s.addTrick('A', 'a', 500, 'clean', 'air');
    s.addTrick('B', 'b', 500, 'clean', 'air');
    s.addTrick('C', 'c', 500, 'crash', 'air');
    expect(s.totalScore).toBe(1000);
    expect(s.combo.active).toBe(false);
    expect(s.endCombo()).toBe(0);
  });

  it('is deterministic', () => {
    const play = () => {
      const s = new ScoringSystem();
      s.addTrick('A', 'a', scoreAirTrick(trick(540)), 'clean', 'air');
      s.addTrick('A', 'a', scoreAirTrick(trick(540)), 'sketchy', 'air');
      s.addTrick('B', 'b', scoreAirTrick(trick(0, -360, 0, 1)), 'clean', 'air');
      s.endCombo();
      return s.getRunScore();
    };
    expect(play()).toEqual(play());
  });

  it('scores rail tricks by stance, distance, spins and difficulty', () => {
    const base: RailTrick = {
      railId: 'r',
      railLabel: 'Rail',
      kind: 'rail',
      stance: 'fifty',
      press: 'none',
      entrySpinDeg: 0,
      outSpinDeg: 0,
      distance: 8,
      time: 1,
      difficulty: 1,
      signature: '',
      name: '',
    };
    const slide = { ...base, stance: 'slide' as const };
    const spun = { ...slide, entrySpinDeg: 270, outSpinDeg: 270 };
    expect(scoreRailTrick(slide)).toBeGreaterThan(scoreRailTrick(base));
    expect(scoreRailTrick(spun)).toBeGreaterThan(scoreRailTrick(slide));
    expect(scoreRailTrick({ ...base, distance: 16 })).toBeGreaterThan(scoreRailTrick(base));
    expect(formatRailTrickName(spun)).toBe('270 On Boardslide 270 Out');
    expect(formatRailTrickName({ ...base, press: 'nose' })).toBe('Nose Slide');
    expect(railSignature(spun)).not.toBe(railSignature(slide));
  });
});
