import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { integrateOrientation } from '../core/math';
import { RotationTracker } from './RotationTracker';
import { recognizeAirTrick, type RotationSummary } from './TrickRecognition';

const D = Math.PI / 180;

function summary(
  spinDeg: number,
  pitchDeg: number,
  rollDeg: number,
  inversions: number,
  switchTakeoff = false,
): RotationSummary {
  return { spin: spinDeg * D, pitch: pitchDeg * D, roll: rollDeg * D, inversions, airTime: 2, switchTakeoff };
}

/** Simulates a constant world angular velocity for `seconds` and returns the tracked summary. */
function track(omega: Vector3, seconds: number): RotationSummary {
  const q = new Quaternion();
  const t = new RotationTracker();
  t.begin(q, new Vector3(0, 0, 10), false, 0);
  const dt = 1 / 240;
  for (let i = 0; i < seconds / dt; i++) {
    integrateOrientation(q, omega, dt);
    t.update(omega, q, 0, dt);
  }
  return {
    spin: t.spin,
    pitch: t.pitch,
    roll: t.roll,
    inversions: t.inversions,
    airTime: t.airTime,
    switchTakeoff: false,
  };
}

describe('TrickRecognition', () => {
  it.each([
    [180, 'Left 180'],
    [355, 'Left 360'],
    [530, 'Left 540'],
    [735, 'Left 720'],
    [890, 'Left 900'],
    [1075, 'Left 1080'],
    [1270, 'Left 1260'],
    [1430, 'Left 1440'],
    [1620, 'Left 1620'],
  ])('rounds a %d° flat spin to %s', (deg, name) => {
    expect(recognizeAirTrick(summary(deg, 0, 0, 0), []).name).toBe(name);
  });

  it('names right spins and switch takeoffs', () => {
    expect(recognizeAirTrick(summary(-720, 0, 0, 0, true), []).name).toBe('Switch Right 720');
  });

  it('does not count small rotations', () => {
    const t = recognizeAirTrick(summary(90, 0, 0, 0), []);
    expect(t.category).toBe('straight');
  });

  it('recognises flips from inversions and pitch direction', () => {
    expect(recognizeAirTrick(summary(0, -360, 0, 1), []).name).toBe('Backflip');
    expect(recognizeAirTrick(summary(0, 360, 0, 1), []).name).toBe('Frontflip');
    expect(recognizeAirTrick(summary(0, -720, 0, 2), []).name).toBe('Double Backflip');
    expect(recognizeAirTrick(summary(0, 720, 0, 2), []).name).toBe('Double Frontflip');
  });

  it('recognises off-axis tricks by axis direction', () => {
    expect(recognizeAirTrick(summary(-500, 0, -480, 1), []).name).toBe('Right Cork 7');
    expect(recognizeAirTrick(summary(400, -350, 0, 1), []).name).toBe('Left Bio 5');
    expect(recognizeAirTrick(summary(400, 350, 0, 1), []).name).toBe('Left Misty 5');
    expect(recognizeAirTrick(summary(-750, 0, -720, 2), []).name).toBe('Right Double Cork 10');
    expect(recognizeAirTrick(summary(260, 0, 250, 1), []).name).toBe('Left Cork 3');
    expect(recognizeAirTrick(summary(-640, 0, -620, 1), []).name).toBe('Right Cork 9');
  });

  it('appends grabs', () => {
    const t = recognizeAirTrick(summary(720, 0, 0, 0), [{ id: 'mute', name: 'Mute', duration: 0.6 }]);
    expect(t.name).toBe('Left 720 Mute');
    expect(t.grabs).toHaveLength(1);
  });

  it('measures real accumulated rotation (flat 720)', () => {
    const s = track(new Vector3(0, 4 * Math.PI, 0), 1); // 720° in one second
    const t = recognizeAirTrick(s, []);
    expect(t.name).toBe('Left 720');
  });

  it('measures a real backflip', () => {
    const s = track(new Vector3(-2 * Math.PI, 0, 0), 1);
    const t = recognizeAirTrick(s, []);
    expect(t.name).toBe('Backflip');
    expect(s.inversions).toBe(1);
  });

  it('measures a rotation about a tilted axis as a cork', () => {
    const axis = new Vector3(0, Math.cos(55 * D), Math.sin(55 * D)).normalize();
    const s = track(axis.multiplyScalar(2 * Math.PI), 1); // one revolution about a 55° axis
    const t = recognizeAirTrick(s, []);
    expect(t.category).toBe('offaxis');
    expect(t.offAxisType).toBe('cork');
    expect(t.spinDegrees).toBe(360);
    expect(t.flips).toBe(1);
  });

  it('gives identical results for identical input (no double recognition state)', () => {
    const a = recognizeAirTrick(summary(540, 10, 0, 0), []);
    const b = recognizeAirTrick(summary(540, 10, 0, 0), []);
    expect(a).toEqual(b);
  });
});
