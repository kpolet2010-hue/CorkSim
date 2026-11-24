import { afterEach, describe, expect, it } from 'vitest';
import { ControlInput } from '../input/actions';
import { getParkById } from '../park/ParkLoader';
import { Simulation } from '../sim/Simulation';
import { buildSkierPose, createSkierPoseInput } from './poseFromSim';

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

describe('buildSkierPose', () => {
  it('maps the simulation read-only, reuses the output object and fills every field', async () => {
    const sim = await Simulation.create(getParkById('glacier-park'));
    sims.push(sim);
    const input = new ControlInput();
    input.down.forward = true;
    for (let i = 0; i < 90; i++) {
      sim.step(input);
      input.clearEdges();
    }
    const b = sim.player.body;
    const before = [b.position.clone(), b.orientation.clone(), b.velocity.clone(), b.angularVelocity.clone()];
    const out = createSkierPoseInput();
    const p = buildSkierPose(sim.player, 1.5, out);
    expect(p).toBe(out);
    expect(p.state).toBe(sim.player.state);
    expect(p.previousState).toBe(sim.player.fsm.previousState);
    expect(p.timeInState).toBeCloseTo(sim.player.fsm.timeInState, 6);
    expect(p.speed).toBeGreaterThan(0.5);
    expect(p.time).toBe(1.5);
    expect(p.impactTime).toBe(-1);
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
    // Read-only: the simulation state is untouched.
    expect(b.position.equals(before[0] as typeof b.position)).toBe(true);
    expect(b.orientation.equals(before[1] as typeof b.orientation)).toBe(true);
    expect(b.velocity.equals(before[2] as typeof b.velocity)).toBe(true);
    expect(b.angularVelocity.equals(before[3] as typeof b.angularVelocity)).toBe(true);
    // Without `out` a fresh object is returned (backwards compatible call).
    expect(buildSkierPose(sim.player, 0)).not.toBe(out);
  });
});
