import { describe, expect, it } from 'vitest';
import { GrabSystem, type GrabButton } from './GrabSystem';
import { findGrab, GRAB_DEFINITIONS } from './grabs';

const dt = 1 / 60;
const set = (...b: GrabButton[]) => new Set<GrabButton>(b);

function hold(g: GrabSystem, buttons: Set<GrabButton>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) g.update(buttons, dt, true);
}

describe('GrabSystem', () => {
  it('maps button combinations to grabs', () => {
    expect(findGrab(set('grab1'))?.name).toBe('Mute');
    expect(findGrab(set('grab2'))?.name).toBe('Safety');
    expect(findGrab(set('grab3'))?.name).toBe('Tail Grab');
    expect(findGrab(set('grab4'))?.name).toBe('Method');
    expect(findGrab(set('grab1', 'grab2'))?.name).toBe('Japan');
    expect(findGrab(set('grab1', 'grab3'))?.name).toBe('Nose Grab');
    expect(findGrab(set('grab2', 'grab3'))?.name).toBe('Truck Driver');
    expect(findGrab(set('grab1', 'grab2', 'grab3'))?.name).toBe('Lui Kang');
    expect(new Set(GRAB_DEFINITIONS.map((g) => g.id)).size).toBe(GRAB_DEFINITIONS.length);
  });

  it('measures grab duration excluding reach time', () => {
    const g = new GrabSystem();
    hold(g, set('grab1'), 1.0);
    hold(g, set(), 0.1);
    expect(g.completed).toHaveLength(1);
    expect(g.completed[0].duration).toBeCloseTo(1.0 - g.config.reachTime, 1);
  });

  it('ignores taps shorter than the minimum duration', () => {
    const g = new GrabSystem();
    hold(g, set('grab2'), 0.2);
    hold(g, set(), 0.1);
    expect(g.completed).toHaveLength(0);
  });

  it('records consecutive different grabs', () => {
    const g = new GrabSystem();
    hold(g, set('grab1'), 0.6);
    hold(g, set('grab3'), 0.6);
    g.releaseAll();
    expect(g.completed.map((c) => c.name)).toEqual(['Mute', 'Tail Grab']);
  });

  it('blends the pose in and out', () => {
    const g = new GrabSystem();
    hold(g, set('grab1'), 0.3);
    expect(g.blend).toBe(1);
    hold(g, set(), 0.5);
    expect(g.blend).toBe(0);
  });

  it('cannot grab when not allowed', () => {
    const g = new GrabSystem();
    for (let i = 0; i < 60; i++) g.update(set('grab1'), dt, false);
    expect(g.current).toBeNull();
  });
});
