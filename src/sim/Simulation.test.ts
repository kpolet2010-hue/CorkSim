import { afterEach, describe, expect, it } from 'vitest';
import { ControlInput, type GameAction } from '../input/actions';
import { getParkById } from '../park/ParkLoader';
import { makeSlopePark } from '../test/fixtures';
import { Simulation } from './Simulation';
import type { SimEvents } from './events';

const sims: Simulation[] = [];
async function create(...args: Parameters<typeof Simulation.create>): Promise<Simulation> {
  const s = await Simulation.create(...args);
  sims.push(s);
  return s;
}
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

type Script = (sim: Simulation, input: ControlInput, t: number) => void;

function runFor(
  sim: Simulation,
  input: ControlInput,
  seconds: number,
  script?: Script,
  until?: () => boolean,
): void {
  const steps = Math.round(seconds / sim.dt);
  for (let i = 0; i < steps; i++) {
    script?.(sim, input, i * sim.dt);
    sim.step(input);
    input.clearEdges();
    if (until?.()) return;
  }
}

function collect<K extends keyof SimEvents>(sim: Simulation, type: K): SimEvents[K][] {
  const list: SimEvents[K][] = [];
  sim.events.on(type, (e) => list.push(e));
  return list;
}

/** Approach k3 of Glacier Park, pop at the lip, hold the given keys for `hold` seconds of air time. */
function kickerScript(
  lipDistance: number,
  keys: GameAction[],
  hold: number,
  grabs: GameAction[] = [],
): Script {
  let air = 0;
  return (sim, input) => {
    const st = sim.player.state;
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    const z = sim.player.body.position.z - k.config.z;
    if (st === 'AIRBORNE') air += sim.dt;
    input.set('jump', z > -lipDistance && air === 0 && st !== 'LANDING');
    for (const key of keys) input.set(key, (z > -4 && air === 0) || (air > 0 && air < hold));
    for (const g of grabs) input.set(g, air > 0.3 && air < hold + 0.5);
  };
}

describe('Simulation integration', () => {
  it('starts a run with the player standing at the spawn point', async () => {
    const sim = await create(getParkById('glacier-park'));
    expect(sim.player.state).toBe('IDLE');
    const p = sim.player.body.position;
    expect(p.z).toBeCloseTo(sim.park.config.spawn.z);
    expect(Math.abs(p.y - sim.park.surface.height(p.x, p.z))).toBeLessThan(1e-6);
    expect(sim.park.kickers.length).toBe(5);
    expect(sim.park.rails.length).toBeGreaterThan(8);
  });

  it('pushing off starts movement and gravity builds speed downhill', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    runFor(sim, input, 3, (_s, i) => i.set('forward', true));
    expect(sim.player.body.speed).toBeGreaterThan(2);
    input.set('forward', false);
    runFor(sim, input, 6);
    expect(sim.player.body.speed).toBeGreaterThan(8);
    expect(['RIDING', 'CARVING']).toContain(sim.player.state);
  });

  it('charges and executes a jump on flat terrain without random takeoffs', async () => {
    const sim = await create(makeSlopePark(8));
    const input = new ControlInput();
    const takeoffs = collect(sim, 'takeoff');
    sim.teleport(0, 20, 10);
    runFor(sim, input, 3);
    expect(takeoffs).toHaveLength(0); // riding a smooth slope never launches the skier
    input.set('jump', true);
    runFor(sim, input, 0.3);
    expect(sim.player.state).toBe('JUMP_CHARGING');
    expect(sim.player.charge).toBeGreaterThan(0.4);
    input.set('jump', false);
    runFor(sim, input, 1 / 60);
    expect(sim.player.state).toBe('AIRBORNE');
    expect(takeoffs[0].pop).toBeGreaterThan(sim.cfg.jump.popMin);
    const landings = collect(sim, 'landed');
    runFor(sim, input, 3, undefined, () => landings.length > 0);
    expect(landings[0].result.quality).toBe('clean');
  });

  it('launches off a kicker with momentum and lands a straight air cleanly', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    sim.teleport(k.config.x, k.config.z - 30, 17);
    const takeoffs = collect(sim, 'takeoff');
    const landings = collect(sim, 'landed');
    runFor(sim, input, 6, kickerScript(6, [], 0), () => landings.length > 0);
    expect(takeoffs[0].surface).toBe('kicker');
    expect(landings[0].airTime).toBeGreaterThan(1.5);
    expect(landings[0].result.quality).toBe('clean');
  });

  it('recognises and scores a spin from actual rotation', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    sim.teleport(k.config.x, k.config.z - 30, 17);
    const tricks = collect(sim, 'trickLanded');
    runFor(sim, input, 6, kickerScript(6, ['left'], 0.6), () => sim.player.state === 'LANDING');
    expect(tricks).toHaveLength(1);
    expect(tricks[0].air?.name).toBe('Left 540');
    expect(tricks[0].scored.landing).toBe('clean');
    expect(sim.scoring.totalScore).toBe(tricks[0].scored.points);
  });

  it('recognises a backflip and a cork', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    const tricks = collect(sim, 'trickLanded');
    sim.teleport(k.config.x, k.config.z - 30, 17);
    runFor(sim, input, 6, kickerScript(6, ['back'], 0.4), () => sim.player.state === 'LANDING');
    input.clearAll();
    sim.teleport(k.config.x, k.config.z - 30, 17);
    runFor(
      sim,
      input,
      6,
      kickerScript(6, ['right', 'tweakRight'], 0.3),
      () => sim.player.state === 'LANDING',
    );
    expect(tricks.map((t) => t.air?.name)).toEqual(['Backflip', 'Right Cork 3']);
    expect(tricks.every((t) => t.scored.landing === 'clean')).toBe(true);
  });

  it('combines a spin with a grab', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    const tricks = collect(sim, 'trickLanded');
    const grabs = collect(sim, 'grabStart');
    sim.teleport(k.config.x, k.config.z - 30, 17);
    runFor(sim, input, 6, kickerScript(6, ['left'], 0.6, ['grab1']), () => sim.player.state === 'LANDING');
    expect(grabs[0].name).toBe('Mute');
    expect(tricks[0].air?.grabs[0]?.name).toBe('Mute');
    expect(tricks[0].air?.name).toMatch(/^Left (540|720) Mute$/);
  });

  it('crashes when the rotation is not completed, invalidating the trick', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    const crashes = collect(sim, 'crash');
    const tricks = collect(sim, 'trickLanded');
    sim.teleport(k.config.x, k.config.z - 30, 17);
    runFor(sim, input, 6, kickerScript(6, ['forward'], 0.3), () => crashes.length > 0);
    expect(crashes).toHaveLength(1);
    expect(sim.player.state).toBe('CRASHED');
    expect(tricks).toHaveLength(0);
    expect(sim.scoring.totalScore).toBe(0);
    // The skier recovers automatically.
    const recovered = collect(sim, 'recovered');
    runFor(sim, input, 6, undefined, () => recovered.length > 0);
    expect(recovered).toHaveLength(1);
    expect(sim.player.state).toBe('IDLE');
  });

  it('locks onto a box from its on-ramp and grinds along it', async () => {
    const cfg = makeSlopePark(10, {
      rails: [
        {
          id: 'box',
          kind: 'box',
          shape: 'straight',
          width: 0.6,
          entryRamp: true,
          points: [
            [0, 0.45, 60],
            [0, 0.45, 72],
          ],
        },
      ],
    });
    const sim = await create(cfg);
    const input = new ControlInput();
    const starts = collect(sim, 'railStart');
    const tricks = collect(sim, 'trickLanded');
    sim.teleport(0, 40, 9);
    let grindSteps = 0;
    let lastS = -1;
    let monotonic = true;
    runFor(
      sim,
      input,
      8,
      (s) => {
        const g = s.player.rails.grind;
        if (g) {
          grindSteps++;
          if (g.s < lastS) monotonic = false;
          lastS = g.s;
          // Keep balanced: steer against the balance drift.
          input.set('left', g.balance > 0.05);
          input.set('right', g.balance < -0.05);
        } else {
          input.set('left', false);
          input.set('right', false);
        }
      },
      () => tricks.length > 0,
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].stance).toBe('fifty');
    expect(grindSteps).toBeGreaterThan(30);
    expect(monotonic).toBe(true);
    expect(tricks[0].rail?.name).toBe('50-50');
    expect(tricks[0].rail?.distance).toBeGreaterThan(8);
    expect(tricks[0].scored.points).toBeGreaterThan(0);
  });

  it('falls off a rail when balance is ignored', async () => {
    const cfg = makeSlopePark(4, {
      rails: [
        {
          id: 'long',
          kind: 'rail',
          shape: 'straight',
          entryRamp: true,
          points: [
            [0, 0.5, 60],
            [0, 0.5, 140],
          ],
        },
      ],
    });
    const sim = await create(cfg);
    const input = new ControlInput();
    const ends = collect(sim, 'railEnd');
    sim.teleport(0, 40, 12);
    runFor(sim, input, 12, undefined, () => ends.length > 0);
    expect(ends[0]?.bailed).toBe(true);
    expect(sim.player.state).toBe('CRASHED');
  });

  it('restarts the run, clearing score and position', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const k = sim.park.kickers.find((kk) => kk.config.id === 'k3')!;
    sim.teleport(k.config.x, k.config.z - 30, 17);
    runFor(sim, input, 6, kickerScript(6, ['left'], 0.6), () => sim.player.state === 'LANDING');
    expect(sim.scoring.totalScore).toBeGreaterThan(0);
    sim.restartRun();
    expect(sim.scoring.totalScore).toBe(0);
    expect(sim.player.state).toBe('IDLE');
    expect(sim.player.body.position.z).toBeCloseTo(sim.park.config.spawn.z);
    expect(sim.runTime).toBe(0);
  });

  it('is deterministic for identical input sequences', async () => {
    const play = async () => {
      const sim = await create(getParkById('glacier-park'));
      const input = new ControlInput();
      runFor(sim, input, 70, (s, i, t) => {
        i.set('forward', s.player.body.speed < 6);
        i.set('left', t % 6 > 4 && t % 6 < 4.6);
        i.set('jump', t % 9 > 7.5 && t % 9 < 8);
      });
      return {
        score: sim.scoring.totalScore,
        pos: sim.player.body.position.toArray(),
        tricks: sim.scoring.getRunScore().tricks.map((t) => t.name),
      };
    };
    const a = await play();
    const b = await play();
    expect(a).toEqual(b);
  });

  it('can ski the full Glacier Park run to the finish line', async () => {
    const sim = await create(getParkById('glacier-park'));
    const input = new ControlInput();
    const finished = collect(sim, 'runFinished');
    runFor(
      sim,
      input,
      240,
      (s, i) => {
        i.set('forward', s.player.body.speed < 6);
        // Avoid rails/features by steering towards a lane near the edge of the corridor.
        const x = s.player.body.position.x;
        const desiredHeadingX = Math.max(-0.35, Math.min(0.35, (34 - x) * 0.04));
        const err = desiredHeadingX - s.player.body.heading.x;
        i.set('left', err > 0.04);
        i.set('right', err < -0.04);
        const g = s.player.rails.grind;
        if (g) {
          i.set('left', g.balance > 0);
          i.set('right', g.balance < 0);
        }
      },
      () => finished.length > 0,
    );
    expect(finished).toHaveLength(1);
    expect(finished[0].time).toBeGreaterThan(30);
  });
});

describe('Crash tumble', () => {
  it('tumbles on top of the snow after landing upside down', async () => {
    const sim = await Simulation.create(makeSlopePark(12));
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    // Launch and flip half a rotation so the skier lands on their head.
    input.set('jump', true);
    runFor(sim, input, 0.3);
    input.set('jump', false);
    input.set('forward', true);
    const crashes = collect(sim, 'crash');
    runFor(sim, input, 4, undefined, () => crashes.length > 0);
    input.set('forward', false);
    expect(crashes.length).toBe(1);
    // The crash body is now the articulated ragdoll (WP-2C): measure its real collision geometry instead of
    // the removed single capsule. No body part sinks deeper than one step of impact travel (v·dt, the ragdoll
    // has no CCD) and the pelvis stays on top of the snow.
    let minProbeGap = Infinity;
    let minPelvis = Infinity;
    runFor(sim, input, 1.5, (s) => {
      const rd = s.player.ragdoll;
      if (!rd) return;
      minProbeGap = Math.min(minProbeGap, s.physics.ragdoll.minProbeGap());
      const p = rd.segments[0].position;
      minPelvis = Math.min(minPelvis, p.y - s.park.surface.height(p.x, p.z));
    });
    expect(minProbeGap).toBeGreaterThan(-0.12);
    expect(minPelvis).toBeGreaterThan(0.05);
    sim.dispose();
  });
});

describe('Rail transfers', () => {
  it('transfers from one rail to the next and scores both grinds', async () => {
    const cfg = makeSlopePark(8, {
      rails: [
        {
          id: 'a',
          kind: 'rail',
          shape: 'straight',
          entryRamp: true,
          points: [
            [0, 0.6, 60],
            [0, 0.6, 68],
          ],
        },
        {
          id: 'b',
          kind: 'box',
          shape: 'straight',
          width: 0.6,
          points: [
            [0, 0.45, 70.5],
            [0, 0.45, 80],
          ],
        },
      ],
    });
    const sim = await Simulation.create(cfg);
    const input = new ControlInput();
    const starts = collect(sim, 'railStart');
    const tricks = collect(sim, 'trickLanded');
    sim.teleport(0, 42, 10);
    runFor(
      sim,
      input,
      8,
      (s) => {
        const g = s.player.rails.grind;
        input.set('left', !!g && g.balance > 0.05);
        input.set('right', !!g && g.balance < -0.05);
      },
      () => tricks.length >= 2,
    );
    expect(starts.map((s) => s.railId)).toEqual(['a', 'b']);
    expect(tricks.map((t) => t.rail?.railId)).toEqual(['a', 'b']);
    sim.dispose();
  });
});
