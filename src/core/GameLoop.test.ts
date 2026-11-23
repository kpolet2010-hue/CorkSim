import { describe, expect, it } from 'vitest';
import { GameLoop } from './GameLoop';

function makeLoop() {
  let steps = 0;
  const alphas: number[] = [];
  let now = 0;
  const loop = new GameLoop(
    1 / 60,
    () => steps++,
    (a) => alphas.push(a),
    5,
    () => now,
    () => 1,
    () => {},
  );
  return {
    loop,
    get steps() {
      return steps;
    },
    alphas,
    setNow: (t: number) => (now = t),
  };
}

describe('GameLoop', () => {
  it('runs a fixed number of steps independent of frame rate', () => {
    const a = makeLoop();
    a.loop.start();
    for (let i = 1; i <= 60; i++) a.loop.tick((i * 1000) / 30); // 30 fps for 2 s
    expect(a.steps).toBeGreaterThanOrEqual(119);
    expect(a.steps).toBeLessThanOrEqual(120);
    const b = makeLoop();
    b.loop.start();
    for (let i = 1; i <= 288; i++) b.loop.tick((i * 1000) / 144); // 144 fps for 2 s
    expect(Math.abs(b.steps - a.steps)).toBeLessThanOrEqual(1);
  });

  it('provides an interpolation alpha in [0,1)', () => {
    const a = makeLoop();
    a.loop.start();
    for (let i = 1; i <= 50; i++) a.loop.tick(i * 7);
    for (const al of a.alphas) {
      expect(al).toBeGreaterThanOrEqual(0);
      expect(al).toBeLessThan(1);
    }
  });

  it('clamps long frames to avoid a spiral of death', () => {
    const a = makeLoop();
    a.loop.start();
    a.loop.tick(10_000);
    expect(a.steps).toBeLessThanOrEqual(5);
  });

  it('does not step while paused and stops cleanly', () => {
    const a = makeLoop();
    a.loop.start();
    a.loop.paused = true;
    a.loop.tick(1000);
    expect(a.steps).toBe(0);
    a.loop.stop();
    expect(a.loop.isRunning).toBe(false);
  });
});
