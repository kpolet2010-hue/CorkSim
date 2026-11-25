import { Quaternion, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { FallKind } from '../config/physicsConfig';
import { ControlInput } from '../input/actions';
import { createSurfaceSample } from '../park/SurfaceField';
import { BODY } from '../player/bodyDimensions';
import { STATE_TRANSITIONS } from '../player/PlayerState';
import { Simulation } from '../sim/Simulation';
import { makeSlopePark } from '../test/fixtures';
import { hingeAngle, limitExcess, maxJointSeparation, segmentAxis } from '../test/ragdollProbe';
import { RAGDOLL_SEGMENTS, SEG, SEGMENT_COUNT } from './Ragdoll';

const sims: Simulation[] = [];
async function create(slopeDeg = 12, extra?: Parameters<typeof makeSlopePark>[1]): Promise<Simulation> {
  const s = await Simulation.create(makeSlopePark(slopeDeg, extra));
  sims.push(s);
  return s;
}
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const _n = createSurfaceSample();
const _a = new Vector3();

/** Rides at `speed` on a uniform slope, then loses balance. */
async function fallingSkier(
  kind: FallKind,
  speed = 12,
  side: 1 | -1 = 1,
  slopeDeg = 12,
): Promise<Simulation> {
  const sim = await create(slopeDeg);
  const input = new ControlInput();
  sim.teleport(0, 50, speed);
  sim.step(input);
  expect(sim.player.debugFall(kind, side)).toBe(true);
  return sim;
}

interface CrashRun {
  duration: number;
  settledAt: number;
  recovered: boolean;
  /** Pelvis |ω| per step. */
  pelvisW: number[];
  maxSeparation: number;
  hinge: number;
  /** Worst ball-joint excess (each joint in the parametrization its limit uses). */
  ball: number;
  ballMean: number;
  ballAtEnd: number;
  /** Chest/pelvis axes against the snow normal when the body settled. */
  atRest: { chestFwd: number; chestUp: number; pelvisHeight: number } | null;
}

/** Steps a crashed simulation until the skier has recovered (or `maxSeconds`), measuring the ragdoll. */
function runCrash(sim: Simulation, maxSeconds = 8): CrashRun {
  const input = new ControlInput();
  const p = sim.player;
  const c = sim.cfg.crash;
  const run: CrashRun = {
    duration: 0,
    settledAt: -1,
    recovered: false,
    pelvisW: [],
    maxSeparation: 0,
    hinge: 0,
    ball: 0,
    ballMean: 0,
    ballAtEnd: 0,
    atRest: null,
  };
  let ballSum = 0;
  let samples = 0;
  const steps = Math.round(maxSeconds / sim.dt);
  for (let i = 0; i < steps; i++) {
    sim.step(input);
    const rd = p.ragdoll;
    if (!rd) {
      run.recovered = p.state === 'IDLE';
      break;
    }
    run.duration += sim.dt;
    const pelvis = rd.segments[SEG.pelvis];
    run.pelvisW.push(pelvis.angularVelocity.length());
    run.maxSeparation = Math.max(run.maxSeparation, maxJointSeparation(rd));
    const lim = limitExcess(rd, c);
    run.hinge = Math.max(run.hinge, lim.knee, lim.elbow);
    run.ball = Math.max(run.ball, lim.ball);
    run.ballAtEnd = lim.ball;
    ballSum += lim.ball;
    samples++;
    if (p.crashSettled && run.settledAt < 0) {
      run.settledAt = run.duration;
      sim.park.surface.sample(pelvis.position.x, pelvis.position.z, _n);
      run.atRest = {
        chestFwd: segmentAxis(rd, SEG.chest, 'z', _a).dot(_n.normal),
        chestUp: segmentAxis(rd, SEG.chest, 'y', _a).dot(_n.normal),
        pelvisHeight: pelvis.position.y - _n.height,
      };
    }
  }
  run.ballMean = samples > 0 ? ballSum / samples : 0;
  return run;
}

/** Snapshot of every segment transform (exact numbers). */
function snapshot(sim: Simulation): number[] {
  const out: number[] = [];
  for (const s of sim.player.ragdoll!.segments) {
    out.push(
      s.position.x,
      s.position.y,
      s.position.z,
      s.quaternion.x,
      s.quaternion.y,
      s.quaternion.z,
      s.quaternion.w,
    );
  }
  return out;
}

describe('Crash ragdoll', () => {
  it('builds 11 segments in the rig frame with the ski bases on the snow and no spawn pop', async () => {
    const sim = await fallingSkier('backward');
    const rd = sim.player.ragdoll!;
    expect(rd.segments.map((s) => s.name)).toEqual([...RAGDOLL_SEGMENTS]);
    expect(SEGMENT_COUNT).toBe(11);
    // Resting on the snow: the lowest probe touches it (lifted by at most the 1 cm skin).
    const gap = sim.physics.ragdoll.minProbeGap();
    expect(gap).toBeGreaterThan(-0.002);
    expect(gap).toBeLessThan(0.012);
    // Chain connected at spawn and prev = current.
    expect(maxJointSeparation(rd)).toBeLessThan(1e-6);
    for (const s of rd.segments) {
      expect(s.prevPosition.equals(s.position)).toBe(true);
      expect(s.prevQuaternion.equals(s.quaternion)).toBe(true);
    }
    // Knees bent forward (positive about +X), elbows flexed.
    expect(hingeAngle(rd, SEG.shinL, 1)).toBeGreaterThan(0.5);
    expect(hingeAngle(rd, SEG.forearmR, -1)).toBeGreaterThan(0.5);
  });

  it('preserves the skier momentum at the crash (trip impulses cancel, no energy scaling)', async () => {
    const sim = await create(12);
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    sim.step(input);
    const before = sim.player.body.velocity.clone();
    sim.player.debugFall('backward');
    const rd = sim.player.ragdoll!;
    const total = new Vector3();
    let mass = 0;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const m = sim.physics.ragdoll.segmentMass(i);
      total.addScaledVector(rd.segments[i].velocity, m);
      mass += m;
    }
    expect(mass).toBeCloseTo(sim.cfg.physics.mass, 4); // Rapier masses are float32
    // Grounded: ω is the yaw rate about the normal (zero when riding straight), so p = M v.
    expect(total.distanceTo(before.multiplyScalar(mass))).toBeLessThan(1e-6 * mass);
    // The trip (spread over tripDuration) makes the legs move forward relative to the torso.
    const dir = before.normalize();
    const rel = () => rd.segments[SEG.shinL].velocity.dot(dir) - rd.segments[SEG.chest].velocity.dot(dir);
    expect(rel()).toBeCloseTo(0, 6);
    sim.step(input);
    expect(rel()).toBeGreaterThan(0.3);
  });

  it('is deterministic: identical runs give bit-identical segment transforms', async () => {
    const a = await fallingSkier('side', 12, -1);
    const b = await fallingSkier('side', 12, -1);
    const input = new ControlInput();
    for (let i = 0; i < 150; i++) {
      a.step(input);
      b.step(input);
      if (!a.player.ragdoll || !b.player.ragdoll) break;
      const sa = snapshot(a);
      const sb = snapshot(b);
      for (let k = 0; k < sa.length; k++) expect(Object.is(sa[k], sb[k])).toBe(true);
    }
    expect(a.player.state).toBe(b.player.state);
  });

  for (const [kind, side] of [
    ['backward', 1],
    ['side', 1],
    ['side', -1],
    ['forward', 1],
  ] as const) {
    it(`a ${kind}${kind === 'side' ? ` (${side})` : ''} fall at 12 m/s settles, lies still and recovers within the cap`, async () => {
      const sim = await fallingSkier(kind, 12, side);
      const recovered: unknown[] = [];
      sim.events.on('recovered', (e) => recovered.push(e));
      const run = runCrash(sim);
      const c = sim.cfg.crash;
      expect(run.recovered).toBe(true);
      expect(recovered).toHaveLength(1);
      // Came to rest by itself (not via the hard cap), then lay still for the lie time.
      expect(run.settledAt).toBeGreaterThanOrEqual(c.minCrashTime);
      expect(run.duration).toBeLessThan(c.maxTumbleTime);
      expect(run.duration - run.settledAt).toBeCloseTo(c.lieTime, 1);
      // Lying on the snow when settled.
      expect(run.atRest!.pelvisHeight).toBeLessThan(0.35);
      // The chain stays connected and the limits hold.
      expect(run.maxSeparation).toBeLessThan(0.05);
      expect(run.hinge).toBeLessThan(0.12);
      expect(run.ball).toBeLessThan(0.2);
      expect(run.ballMean).toBeLessThan(0.03);
    });
  }

  it('slides after the impact instead of stopping dead', async () => {
    const sim = await fallingSkier('backward', 12);
    const input = new ControlInput();
    let fastUntil = 0;
    for (let i = 0; i < 300 && sim.player.ragdoll; i++) {
      sim.step(input);
      const rd = sim.player.ragdoll;
      if (rd && rd.segments[SEG.pelvis].velocity.length() > 3) fastUntil = i * sim.dt;
    }
    expect(fastUntil).toBeGreaterThan(0.8);
  });

  it('pelvis rotation dies out (no continuous spinning)', async () => {
    for (const kind of ['backward', 'side', 'forward'] as const) {
      const sim = await fallingSkier(kind, 12);
      const run = runCrash(sim);
      const w = run.pelvisW;
      const peak = Math.max(...w);
      const tail = w.slice(-30);
      const tailMean = tail.reduce((s, x) => s + x, 0) / tail.length;
      expect(peak, kind).toBeGreaterThan(2);
      expect(tailMean, kind).toBeLessThan(0.6);
    }
  });

  for (const speed of [6, 9, 12]) {
    it(`a backward fall at ${speed} m/s ends with the back or side on the snow`, async () => {
      const sim = await fallingSkier('backward', speed);
      const run = runCrash(sim);
      expect(run.atRest).not.toBeNull();
      // Not face down (chest forward axis not into the snow) and lying (chest axis along the slope).
      expect(run.atRest!.chestFwd).toBeGreaterThan(-0.4);
      expect(Math.abs(run.atRest!.chestUp)).toBeLessThan(0.6);
    });
  }

  it('a crash in a fast airborne spin stops spinning after the first impacts', async () => {
    const sim = await create(12);
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    input.set('jump', true);
    sim.step(input);
    input.set('jump', false);
    for (let i = 0; i < 8; i++) sim.step(input);
    expect(sim.player.state).toBe('AIRBORNE');
    const b = sim.player.body;
    b.angularVelocity
      .set(0, 11, 0)
      .applyQuaternion(b.orientation)
      .add(new Vector3(4, 0, 0));
    sim.player.crash('Spin test', 0);
    // The rigid air rotation is carried into the ragdoll exactly.
    expect(
      sim.player.ragdoll!.segments[SEG.pelvis].angularVelocity.distanceTo(b.angularVelocity),
    ).toBeLessThan(1e-9);
    // After the first impacts, the body must not keep turning about the snow normal like a top: the net
    // (signed) rotation about the normal stays below half a turn, and the rotation dies out.
    let t = 0;
    let firstContact = -1;
    let netAboutNormal = 0;
    let maxSep = 0;
    const tail: number[] = [];
    while (sim.player.ragdoll && t < 8) {
      sim.step(input);
      t += sim.dt;
      const rd = sim.player.ragdoll;
      if (!rd) break;
      const pelvis = rd.segments[SEG.pelvis];
      if (firstContact < 0 && rd.segments.some((s) => s.snowContact)) firstContact = t;
      sim.park.surface.sample(pelvis.position.x, pelvis.position.z, _n);
      if (firstContact >= 0 && t > firstContact + 0.8)
        netAboutNormal += pelvis.angularVelocity.dot(_n.normal) * sim.dt;
      maxSep = Math.max(maxSep, maxJointSeparation(rd));
      tail.push(pelvis.angularVelocity.length());
    }
    expect(sim.player.state).toBe('IDLE');
    expect(firstContact).toBeGreaterThanOrEqual(0);
    expect(Math.abs(netAboutNormal)).toBeLessThan(Math.PI);
    const last = tail.slice(-30);
    expect(last.reduce((a, w) => a + w, 0) / last.length).toBeLessThan(0.6);
    expect(maxSep).toBeLessThan(0.05);
  });

  it('keeps every solver-limited ball joint away from the quaternion double-cover singularity', async () => {
    // Rapier limits each imaginary component of the relative quaternion separately (a box). If a corner of
    // the box reaches |imag| = 1 the rotation can reach w = 0, where the sign flips and the limit explodes.
    const sim = await create(12);
    const c = sim.cfg.crash;
    const corner = (r: (typeof c)['hip']) => {
      const m = (a: number, b: number) => Math.max(Math.abs(Math.sin(a / 2)), Math.abs(Math.sin(b / 2))) ** 2;
      return m(r.swingXMin, r.swingXMax) + m(r.twistMin, r.twistMax) + m(r.swingZMin, r.swingZMax);
    };
    const joints = { waist: c.waist, neck: c.neck, shoulder: c.shoulder, hip: c.hip };
    for (const [name, range] of Object.entries(joints)) {
      if (c.solverLimits[name as keyof typeof joints]) expect(corner(range), name).toBeLessThan(0.85);
    }
    expect(c.kneeMax).toBeLessThan(Math.PI * 0.9);
    expect(c.elbowMax).toBeLessThan(Math.PI * 0.9);
  });

  it('the soft-limit fallback (own swing-ellipse + twist constraint) keeps a joint near its range', async () => {
    const sim = await create(12);
    const c = sim.cfg.crash;
    c.solverLimits.shoulder = false;
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    sim.step(input);
    sim.player.debugFall('backward');
    const run = runCrash(sim);
    expect(run.recovered).toBe(true);
    expect(run.maxSeparation).toBeLessThan(0.05);
    const rd = sim.player.ragdoll;
    expect(rd).toBeNull();
    expect(run.ball).toBeLessThan(1.2);
    expect(run.ballMean).toBeLessThan(0.15);
  });

  it('keeps the body on the pelvis: root = pelvis × inverse(rest offset), pelvis velocities', async () => {
    const sim = await fallingSkier('forward', 10);
    const input = new ControlInput();
    for (let i = 0; i < 40; i++) {
      const before = sim.player.ragdoll!.segments.map((s) => s.position.clone());
      sim.step(input);
      const rd = sim.player.ragdoll!;
      const pelvis = rd.segments[SEG.pelvis];
      const b = sim.player.body;
      const root = new Vector3(0, -BODY.pelvisHeight, 0)
        .applyQuaternion(pelvis.quaternion)
        .add(pelvis.position);
      expect(b.position.distanceTo(root)).toBeLessThan(1e-9);
      expect(Math.abs(b.orientation.angleTo(pelvis.quaternion))).toBeLessThan(1e-6);
      expect(b.velocity.equals(pelvis.velocity)).toBe(true);
      expect(b.angularVelocity.equals(pelvis.angularVelocity)).toBe(true);
      rd.segments.forEach((s, k) => expect(s.prevPosition.equals(before[k])).toBe(true));
    }
  });

  it('recover() stands the skier up at the pelvis, IDLE and upright, and removes the ragdoll', async () => {
    const sim = await fallingSkier('side', 10);
    const input = new ControlInput();
    for (let i = 0; i < 60; i++) sim.step(input);
    const pelvis = sim.player.ragdoll!.segments[SEG.pelvis].position.clone();
    sim.player.recover();
    const b = sim.player.body;
    expect(sim.player.state).toBe('IDLE');
    expect(sim.player.ragdoll).toBeNull();
    expect(sim.physics.tumbling).toBe(false);
    expect(sim.physics.world.bodies.len()).toBe(0);
    expect(Math.hypot(b.position.x - pelvis.x, b.position.z - pelvis.z)).toBeLessThan(1e-9);
    sim.park.surface.sample(b.position.x, b.position.z, _n);
    expect(b.position.y).toBeCloseTo(_n.height, 9);
    const up = new Vector3(0, 1, 0).applyQuaternion(b.orientation);
    expect(up.dot(_n.normal)).toBeGreaterThan(0.999);
    expect(b.speed).toBe(0);
    // A second crash builds a fresh ragdoll.
    sim.teleport(0, 80, 8);
    sim.step(input);
    expect(sim.player.debugFall('forward')).toBe(true);
    expect(sim.physics.world.bodies.len()).toBe(SEGMENT_COUNT);
  });

  it('debugFall only works from ground states', async () => {
    const sim = await create(12);
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    input.set('jump', true);
    sim.step(input);
    input.set('jump', false);
    for (let i = 0; i < 5; i++) sim.step(input);
    expect(sim.player.state).toBe('AIRBORNE');
    expect(sim.player.debugFall('backward')).toBe(false);
    expect(sim.player.state).toBe('AIRBORNE');
  });

  it('falls off a rail towards the side the balance tipped to', async () => {
    const sim = await create(4, {
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
    const input = new ControlInput();
    sim.teleport(0, 40, 12);
    let balance = 0;
    for (let i = 0; i < 900 && sim.player.state !== 'CRASHED'; i++) {
      balance = sim.player.railBalance || balance;
      sim.step(input);
    }
    expect(sim.player.state).toBe('CRASHED');
    expect(sim.player.lastFall.kind).toBe('side');
    expect(sim.player.lastFall.side).toBe(balance > 0 ? -1 : 1);
    const run = runCrash(sim);
    expect(run.recovered).toBe(true);
    expect(run.maxSeparation).toBeLessThan(0.05);
  });

  it('keeps the state machine table unchanged', () => {
    expect(STATE_TRANSITIONS.CRASHED).toEqual(['IDLE']);
    for (const s of [
      'IDLE',
      'RIDING',
      'CARVING',
      'BRAKING',
      'JUMP_CHARGING',
      'AIRBORNE',
      'RAIL_GRINDING',
      'LANDING',
    ] as const)
      expect(STATE_TRANSITIONS[s]).toContain('CRASHED');
    expect(STATE_TRANSITIONS.AIRBORNE).toEqual(['LANDING', 'RAIL_GRINDING', 'CRASHED']);
    expect(STATE_TRANSITIONS.RAIL_GRINDING).toEqual(['AIRBORNE', 'CRASHED']);
  });

  it('goes RIDING → CRASHED → IDLE through the state machine', async () => {
    const sim = await create(12);
    const changes: string[] = [];
    sim.events.on('stateChanged', (e) => changes.push(`${e.from}>${e.to}`));
    const input = new ControlInput();
    sim.teleport(0, 50, 12);
    sim.step(input);
    sim.player.debugFall('forward');
    runCrash(sim);
    expect(changes).toContain('RIDING>CRASHED');
    expect(changes[changes.length - 1]).toBe('CRASHED>IDLE');
    expect(sim.player.fsm.rejected).toBe(0);
  });
});

describe('Obstacles', () => {
  it('are detected before the world was ever stepped (scene queries built at load)', async () => {
    const sim = await create(10, {
      rails: [
        {
          id: 'r',
          kind: 'rail',
          shape: 'straight',
          points: [
            [0, 0.6, 60],
            [0, 0.6, 70],
          ],
        },
      ],
    });
    const support = sim.park.rails[0].supports[0];
    const foot = new Vector3(support.base.x, support.base.y - 0.5, support.base.z);
    expect(sim.physics.checkObstacleHit(foot, new Quaternion())).toBe('support');
  });
});
