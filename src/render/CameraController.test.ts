import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CameraSettings } from '../config/settings';
import { RAGDOLL_SEGMENT_INFO, type RagdollView } from '../physics/Ragdoll';
import { BODY } from '../player/bodyDimensions';
import type { PlayerController } from '../player/PlayerController';
import { CRASH_CAMERA, CameraController, occlusionLift, type CameraTarget } from './CameraController';
import { buildCameraTarget, computeBodyFrame } from './cameraTarget';

const SETTINGS: CameraSettings = { distance: 5.2, height: 1.9, sensitivity: 1, smoothing: 7, fov: 62 };
const SLOPE = Math.tan((28 * Math.PI) / 180);

type HeightFn = (x: number, z: number) => number;

function makeCamera(height: HeightFn): { ctl: CameraController; cam: PerspectiveCamera } {
  const cam = new PerspectiveCamera(62, 16 / 9, 0.1, 6000);
  const ctl = new CameraController(cam, SETTINGS, { height });
  return { ctl, cam };
}

/** Mutable camera target; `body` is filled while crashed. */
function makeTarget(): CameraTarget & { body: NonNullable<CameraTarget['body']> } {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    heading: new Vector3(0, 0, 1),
    airborne: false,
    grinding: false,
    crashed: false,
    landingPoint: null,
    body: { centre: new Vector3(), radius: 1.1, velocity: new Vector3() },
  };
}

/** NDC of a world point. */
function ndc(cam: PerspectiveCamera, p: Vector3): Vector3 {
  cam.updateMatrixWorld();
  return p.clone().project(cam);
}

/** Extremes of the body sphere as seen by the camera (left/right/top/bottom of the sphere). */
function sphereExtremes(cam: PerspectiveCamera, c: Vector3, r: number): Vector3[] {
  cam.updateMatrixWorld();
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  return [
    c.clone().addScaledVector(right, r),
    c.clone().addScaledVector(right, -r),
    c.clone().addScaledVector(up, r),
    c.clone().addScaledVector(up, -r),
  ].map((p) => ndc(cam, p));
}

function horizontalYaw(cam: PerspectiveCamera): number {
  const d = cam.getWorldDirection(new Vector3());
  return Math.atan2(d.x, d.z);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

describe('CameraController crash framing', () => {
  const slope: HeightFn = (_x, z) => -z * SLOPE;

  /**
   * Rides downhill, crashes and slides (decelerating, drifting sideways, spinning root), lies still and
   * reports every crashed frame's projected body sphere.
   */
  function crashRun(dt: number, frames: (cam: PerspectiveCamera, t: CameraTarget, time: number) => void) {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dir = new Vector3(0.25, 0, 1).normalize();
    t.velocity.copy(dir).multiplyScalar(15);
    t.position.set(0, 0, 0);
    ctl.snap(t);
    let time = 0;
    // Approach: 1 s of riding.
    for (; time < 1; time += dt) {
      t.position.addScaledVector(t.velocity, dt);
      t.position.y = slope(t.position.x, t.position.z);
      ctl.update(t, dt);
    }
    // Crash: the body slides, turning towards the fall line's side and slowing to rest after ~3 s.
    t.crashed = true;
    const bodyVel = t.velocity.clone();
    t.body.centre.copy(t.position);
    for (let c = 0; c < 5; c += dt, time += dt) {
      const speed = Math.max(0, 15 - 5 * c);
      const slideDir = new Vector3(Math.sin(0.25 + 0.5 * c), 0, Math.cos(0.25 + 0.5 * c));
      bodyVel.copy(slideDir).multiplyScalar(speed);
      bodyVel.y = -bodyVel.z * SLOPE; // along the slope (fall line +z)
      t.body.velocity.copy(bodyVel);
      t.body.centre.addScaledVector(bodyVel, dt);
      t.body.centre.y = slope(t.body.centre.x, t.body.centre.z) + 0.3;
      t.body.radius = 1.0 + 0.2 * Math.sin(c * 5);
      // The model root (foot point) whirls around the pelvis while the body spins.
      const spin = 7 * Math.max(0, 1 - c / 2.5) * c;
      t.position.set(
        t.body.centre.x + 0.9 * Math.cos(spin),
        t.body.centre.y,
        t.body.centre.z + 0.9 * Math.sin(spin),
      );
      t.velocity.copy(bodyVel).add(new Vector3(-Math.sin(spin), 0, Math.cos(spin)).multiplyScalar(6));
      ctl.update(t, dt);
      frames(cam, t, c);
    }
    return { ctl, cam, t };
  }

  it('keeps the whole body inside the view and at a readable size through the crash', () => {
    let minSize = Infinity;
    let maxSize = 0;
    crashRun(1 / 60, (cam, t, c) => {
      const pts = sphereExtremes(cam, t.body!.centre, t.body!.radius);
      for (const p of pts) {
        expect(Math.abs(p.x), `x at +${c.toFixed(2)} s`).toBeLessThan(0.95);
        expect(Math.abs(p.y), `y at +${c.toFixed(2)} s`).toBeLessThan(0.95);
        expect(p.z).toBeLessThan(1); // in front of the camera
      }
      const size = Math.abs(pts[2].y - pts[3].y) / 2; // projected sphere diameter / screen height
      minSize = Math.min(minSize, size);
      maxSize = Math.max(maxSize, size);
    });
    expect(minSize).toBeGreaterThan(0.12);
    expect(maxSize).toBeLessThan(0.6);
  });

  it('keeps the body centred vertically (not sinking to the bottom of the frame)', () => {
    crashRun(1 / 60, (cam, t, c) => {
      if (c < 0.4) return;
      const p = ndc(cam, t.body!.centre);
      expect(Math.abs(p.y), `centre y at +${c.toFixed(2)} s`).toBeLessThan(0.35);
    });
  });

  it('bounds camera speed and yaw rate during a spinning slide', () => {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, 0, 10);
    ctl.snap(t);
    t.crashed = true;
    t.body.centre.set(0, 0.3, 0);
    ctl.update(t, dt);
    let prevPos = cam.position.clone();
    let prevYaw = horizontalYaw(cam);
    let prevVel = new Vector3();
    let maxSpeed = 0;
    let maxSlideSpeed = 0;
    let maxAccel = 0;
    let maxYawRate = 0;
    for (let c = 0; c < 4; c += dt) {
      // The body slides straight down at 10 m/s, but the reported centre-of-mass velocity is jolted ±35° by
      // snow contacts, and the pelvis (and the model root around it) spins at 9 rad/s.
      t.body.centre.z += 10 * dt;
      t.body.centre.y = slope(t.body.centre.x, t.body.centre.z) + 0.3;
      const wob = 0.6 * Math.sin(c * 9);
      t.body.velocity.set(10 * Math.sin(wob), -10 * Math.cos(wob) * SLOPE, 10 * Math.cos(wob));
      const spin = 9 * c;
      t.position.set(
        t.body.centre.x + 0.9 * Math.cos(spin),
        t.body.centre.y,
        t.body.centre.z + 0.9 * Math.sin(spin),
      );
      t.velocity.set(-Math.sin(spin) * 8, 0, Math.cos(spin) * 8).add(t.body.velocity);
      t.heading.set(Math.cos(spin), 0, Math.sin(spin));
      ctl.update(t, dt);
      const camVel = cam.position.clone().sub(prevPos).divideScalar(dt);
      const speed = camVel.length();
      const yawRate = Math.abs(wrap(horizontalYaw(cam) - prevYaw)) / dt;
      if (c > 0.1) {
        maxSpeed = Math.max(maxSpeed, speed);
        if (c > 1.2) maxSlideSpeed = Math.max(maxSlideSpeed, speed); // after the blend-in
        if (c > 0.6) maxAccel = Math.max(maxAccel, camVel.distanceTo(prevVel) / dt);
        maxYawRate = Math.max(maxYawRate, yawRate);
      }
      prevPos = cam.position.clone();
      prevVel = camVel;
      prevYaw = horizontalYaw(cam);
    }
    // Body speed along the slope is ~11.3 m/s; the root whirls at 8 m/s and would add ~73 m/s² if followed.
    expect(maxSpeed).toBeLessThan(15); // including the blend into the crash framing
    expect(maxSlideSpeed).toBeLessThan(12.5);
    expect(maxAccel).toBeLessThan(20);
    expect(maxYawRate).toBeLessThan(1.2);
  });

  it('frames a body lying along the view axis by its visible extent, fully inside the view', () => {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, 0, 6);
    ctl.snap(t);
    t.crashed = true;
    // Lying head-downhill along the fall line (the view axis): long in z, flat in y.
    t.body.centre.set(0, slope(0, 2) + 0.15, 2);
    t.body.halfExtents = new Vector3(0.35, 0.15, 1.2);
    t.body.radius = 1.26;
    t.body.velocity.set(0, 0, 0);
    t.position.copy(t.body.centre);
    t.velocity.set(0, 0, 0);
    for (let c = 0; c < 4; c += dt) ctl.update(t, dt);
    const h = t.body.halfExtents;
    const corners: Vector3[] = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1])
          corners.push(ndc(cam, t.body.centre.clone().add(new Vector3(sx * h.x, sy * h.y, sz * h.z))));
    const ys = corners.map((p) => p.y);
    for (const p of corners) {
      expect(Math.abs(p.x)).toBeLessThan(0.9);
      expect(Math.abs(p.y)).toBeLessThan(0.9);
    }
    // Readable: the visible box spans at least a fifth of the screen height.
    expect((Math.max(...ys) - Math.min(...ys)) / 2).toBeGreaterThan(0.2);
    expect(cam.position.distanceTo(t.body.centre)).toBeLessThan(SETTINGS.distance + 1.5);
  });

  it('swings to a three-quarter view of the body as the slide slows, keeping it framed', () => {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, -10 * SLOPE, 10);
    ctl.snap(t);
    t.crashed = true;
    t.body.centre.set(0, 0.3, 0);
    let maxYawRate = 0;
    let prevYaw = horizontalYaw(cam);
    let yawAtSpeed = 0;
    for (let c = 0; c < 6; c += dt) {
      const speed = Math.max(0, 10 - 4 * c);
      t.body.velocity.set(0, -speed * SLOPE, speed);
      t.body.centre.addScaledVector(t.body.velocity, dt);
      t.body.centre.y = slope(0, t.body.centre.z) + 0.3;
      t.position.copy(t.body.centre);
      t.velocity.copy(t.body.velocity);
      ctl.update(t, dt);
      if (c < 0.5) yawAtSpeed = Math.max(yawAtSpeed, Math.abs(horizontalYaw(cam)));
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(horizontalYaw(cam) - prevYaw)) / dt);
      prevYaw = horizontalYaw(cam);
    }
    // Behind the body while it slides fast, then about 38° off the slide line once it is slow.
    expect(yawAtSpeed).toBeLessThan(0.15);
    const off = Math.abs(horizontalYaw(cam));
    expect(off).toBeGreaterThan(CRASH_CAMERA.orbitAngle * 0.8);
    expect(off).toBeLessThan(CRASH_CAMERA.orbitAngle * 1.2);
    expect(maxYawRate).toBeLessThan(CRASH_CAMERA.maxYawSpeed + 0.35);
    const p = ndc(cam, t.body.centre);
    expect(Math.abs(p.x)).toBeLessThan(0.35);
    expect(Math.abs(p.y)).toBeLessThan(0.35);
  });

  it('does not run into the body when it stops dead (tree impact)', () => {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, -22 * SLOPE, 22);
    ctl.snap(t);
    for (let c = 0; c < 1; c += dt) {
      t.position.addScaledVector(t.velocity, dt);
      t.position.y = slope(0, t.position.z);
      ctl.update(t, dt);
    }
    t.crashed = true;
    t.body.centre.copy(t.position);
    t.body.centre.y += 0.4;
    t.body.velocity.set(0, 0, 0);
    t.velocity.set(0, 0, 0);
    let minDist = Infinity;
    for (let c = 0; c < 3; c += dt) {
      ctl.update(t, dt);
      minDist = Math.min(minDist, cam.position.distanceTo(t.body.centre));
    }
    expect(minDist).toBeGreaterThan(CRASH_CAMERA.minDistance - 0.3);
  });

  it('limits the drift speed when the slide direction reverses', () => {
    const { ctl, cam } = makeCamera(() => 0);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, 0, 8);
    ctl.snap(t);
    t.crashed = true;
    t.body.centre.set(0, 0.3, 0);
    t.body.velocity.set(0, 0, -6); // bounced back uphill
    let prevYaw = horizontalYaw(cam);
    let maxYawRate = 0;
    for (let c = 0; c < 3; c += dt) {
      t.body.centre.addScaledVector(t.body.velocity, dt);
      t.position.copy(t.body.centre);
      ctl.update(t, dt);
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(horizontalYaw(cam) - prevYaw)) / dt);
      prevYaw = horizontalYaw(cam);
    }
    expect(maxYawRate).toBeLessThan(CRASH_CAMERA.maxYawSpeed + 0.35);
  });

  it('never clips into the snow and keeps line of sight over a crest', () => {
    // Fall line +z with a ridge the body slid over: the camera behind it must rise to see past the crest.
    const crestZ = 12;
    const ridge: HeightFn = (_x, z) => -z * 0.35 + 2.2 * Math.exp(-((z - crestZ) ** 2) / 6);
    const { ctl, cam } = makeCamera(ridge);
    const t = makeTarget();
    const dt = 1 / 60;
    t.position.set(0, ridge(0, 0), 0);
    t.velocity.set(0, 0, 9);
    ctl.snap(t);
    for (let c = 0; c < 1.6; c += dt) {
      t.position.addScaledVector(t.velocity, dt);
      t.position.y = ridge(t.position.x, t.position.z);
      ctl.update(t, dt);
      expect(cam.position.y).toBeGreaterThanOrEqual(ridge(cam.position.x, cam.position.z) + 0.45);
    }
    t.crashed = true;
    t.body.centre.copy(t.position);
    for (let c = 0; c < 4; c += dt) {
      const speed = Math.max(0, 9 - 4 * c);
      t.body.velocity.set(0, 0, speed);
      t.body.centre.addScaledVector(t.body.velocity, dt);
      t.body.centre.y = ridge(0, t.body.centre.z) + 0.3;
      t.position.copy(t.body.centre);
      t.velocity.copy(t.body.velocity);
      ctl.update(t, dt);
      expect(cam.position.y).toBeGreaterThanOrEqual(ridge(cam.position.x, cam.position.z) + 0.45);
    }
    // At rest behind the crest: the sight line to the body clears the snow.
    expect(t.body.centre.z).toBeGreaterThan(crestZ + 2);
    const from = cam.position;
    const to = t.body.centre;
    for (let f = 0.05; f <= 0.75; f += 0.05) {
      const x = from.x + (to.x - from.x) * f;
      const y = from.y + (to.y - from.y) * f;
      const z = from.z + (to.z - from.z) * f;
      expect(y, `sight line at ${f.toFixed(2)}`).toBeGreaterThan(ridge(x, z) + 0.1);
    }
  });

  it('hands back smoothly to the riding framing after the get-up', () => {
    const { ctl, cam } = makeCamera(slope);
    const t = makeTarget();
    const dt = 1 / 60;
    t.velocity.set(0, 0, 12);
    ctl.snap(t);
    t.crashed = true;
    t.body.centre.set(3, slope(3, 4) + 0.25, 4);
    t.body.velocity.set(0, 0, 0);
    t.position.set(3.8, t.body.centre.y, 4.3);
    t.velocity.set(0, 0, 0);
    for (let c = 0; c < 2; c += dt) ctl.update(t, dt);
    expect(ctl.crashFraming).toBeGreaterThan(0.99);
    // Get-up: standing at the pelvis location, facing down the fall line, then skiing off.
    t.crashed = false;
    t.position.set(3, slope(3, 4), 4);
    t.heading.set(0, 0, 1);
    let prev = cam.position.clone();
    let maxStep = 0;
    for (let c = 0; c < 5; c += dt) {
      const speed = Math.min(8, c * 3);
      t.velocity.set(0, 0, speed);
      t.position.addScaledVector(t.velocity, dt);
      t.position.y = slope(t.position.x, t.position.z);
      ctl.update(t, dt);
      maxStep = Math.max(maxStep, cam.position.distanceTo(prev));
      prev = cam.position.clone();
    }
    expect(maxStep).toBeLessThan(0.25); // < 15 m/s, no jump
    expect(ctl.crashFraming).toBeLessThan(0.01);
    // Back to the riding framing: behind (uphill of) the skier, looking down the fall line.
    expect(cam.position.z).toBeLessThan(t.position.z - 3);
    expect(Math.abs(horizontalYaw(cam))).toBeLessThan(0.15);
  });

  it('is frame-rate independent', () => {
    // Camera relative to the body (the test's own Euler integration of the slide depends on dt).
    const rel = (dt: number) => {
      const r = crashRun(dt, () => {});
      return r.cam.position.clone().sub(r.t.body!.centre);
    };
    const at30 = rel(1 / 30);
    const at144 = rel(1 / 144);
    expect(at30.distanceTo(at144)).toBeLessThan(0.35);
  });
});

describe('occlusionLift', () => {
  it('is zero over open snow and positive behind a crest', () => {
    const flat = { height: () => 0 };
    expect(occlusionLift(flat, new Vector3(0, 2, 0), new Vector3(0, 0.3, 6), 0.35, 4)).toBe(0);
    const crest = { height: (_x: number, z: number) => (z > 1.5 && z < 3 ? 1.5 : 0) };
    const lift = occlusionLift(crest, new Vector3(0, 1, 0), new Vector3(0, 0.3, 6), 0.35, 4);
    expect(lift).toBeGreaterThan(0.8);
    expect(lift).toBeLessThanOrEqual(4);
  });
});

/** A ragdoll lying on its back on flat snow, head towards +z, translated by `offset`. */
function lyingView(offset: Vector3, prevOffset: Vector3, velocity: Vector3): RagdollView {
  const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2); // body +Y -> world +Z
  const rest: Vector3[] = [];
  for (const info of RAGDOLL_SEGMENT_INFO) {
    const o = new Vector3(info.origin.x, info.origin.y, info.origin.z);
    if (info.parent >= 0) o.add(rest[info.parent]);
    rest.push(o);
  }
  const segments = RAGDOLL_SEGMENT_INFO.map((info, i) => {
    const local = rest[i].clone().applyQuaternion(rot);
    return {
      name: info.name,
      position: local.clone().add(offset),
      quaternion: rot.clone(),
      prevPosition: local.clone().add(prevOffset),
      prevQuaternion: rot.clone(),
      velocity: velocity.clone(),
      angularVelocity: new Vector3(),
      snowContact: true,
    };
  });
  return { segments, info: RAGDOLL_SEGMENT_INFO, bootLean: 0, time: 1 };
}

describe('computeBodyFrame', () => {
  const offset = new Vector3(2, 0.2, 10);

  it('encloses the head and both ski tips of a lying body', () => {
    const view = lyingView(offset, offset, new Vector3());
    const f = computeBodyFrame(view, 1, { centre: new Vector3(), radius: 0, velocity: new Vector3() });
    const rot = view.segments[0].quaternion;
    const head = view.segments[2].position.clone().add(new Vector3(0, 0.25, 0).applyQuaternion(rot));
    const tip = (i: number, s: number) =>
      view.segments[i].position
        .clone()
        .add(
          new Vector3(
            0,
            -BODY.shin + BODY.skiOffsetY,
            BODY.skiOffsetZ + (s * BODY.skiLength) / 2,
          ).applyQuaternion(rot),
        );
    for (const p of [head, tip(9, 1), tip(9, -1), tip(10, 1), tip(10, -1), view.segments[0].position]) {
      expect(p.distanceTo(f.centre)).toBeLessThanOrEqual(f.radius + 1e-6);
    }
    expect(f.radius).toBeGreaterThan(0.8);
    expect(f.radius).toBeLessThan(1.6);
  });

  it('interpolates with the fixed-step alpha and averages the segment velocity', () => {
    const prev = offset.clone().add(new Vector3(0, 0, -0.2));
    const view = lyingView(offset, prev, new Vector3(1, 0, 4));
    const out = { centre: new Vector3(), radius: 0, velocity: new Vector3() };
    const c1 = computeBodyFrame(view, 1, out).centre.clone();
    const c0 = computeBodyFrame(view, 0.5, out).centre.clone();
    expect(c1.z - c0.z).toBeCloseTo(0.1, 5);
    expect(out.velocity.x).toBeCloseTo(1, 6);
    expect(out.velocity.z).toBeCloseTo(4, 6);
  });

  it('buildCameraTarget only reports a body frame while the ragdoll exists', () => {
    const view = lyingView(offset, offset, new Vector3(0, 0, 3));
    const player = {
      body: { velocity: new Vector3(), heading: new Vector3(0, 0, 1), position: new Vector3() },
      state: 'CRASHED',
      impact: { valid: false, point: new Vector3() },
      ragdoll: view as RagdollView | null,
    };
    const crashed = buildCameraTarget(player as unknown as PlayerController, new Vector3(), 1);
    expect(crashed.crashed).toBe(true);
    expect(crashed.body?.velocity.z).toBeCloseTo(3, 6);
    player.state = 'RIDING';
    player.ragdoll = null;
    expect(buildCameraTarget(player as unknown as PlayerController, new Vector3()).body).toBeNull();
  });
});
