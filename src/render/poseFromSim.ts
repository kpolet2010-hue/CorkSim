import { Quaternion, Vector3 } from 'three';
import type { PlayerController } from '../player/PlayerController';
import { createSkierRagdollPose, RAGDOLL_POSE_CAPACITY } from './skier/RagdollDriver';
import type { SkierPoseInput } from './SkierAnimator';

const _q = new Quaternion();
const _w = new Vector3();

/** A neutral pose input (standing still). Useful for tests, previews and replay initialisation. */
export function createSkierPoseInput(): SkierPoseInput {
  return {
    state: 'IDLE',
    previousState: 'IDLE',
    timeInState: 0,
    edgeAngle: 0,
    brake: 0,
    speed: 0,
    tucking: false,
    charge: 0,
    landingCompression: 0,
    landingQuality: null,
    groundGap: 0,
    grab: null,
    grabBlend: 0,
    railStance: null,
    railStanceYaw: 0,
    railBalance: 0,
    railPress: 'none',
    spinRate: 0,
    localSpin: 0,
    localFlip: 0,
    localRoll: 0,
    impactTime: -1,
    airTime: 0,
    yawRate: 0,
    skidSpeed: 0,
    loadBias: 0,
    switchStance: false,
    time: 0,
    ragdoll: createSkierRagdollPose(),
  };
}

/**
 * Builds the animation input from the (read-only) simulation state. This is the single sim -> animation
 * mapping; extend `SkierPoseInput` and this function together. Owned by character/animation.
 * Pass `out` to reuse an object (no per-frame allocation); otherwise a new object is returned.
 * `alpha` is the fixed-step interpolation factor of this render frame (the same one the root transform
 * uses): the crash ragdoll segments are interpolated between their previous and current step with it.
 */
export function buildSkierPose(
  player: PlayerController,
  time: number,
  out?: SkierPoseInput,
  alpha = 1,
): SkierPoseInput {
  const p = out ?? createSkierPoseInput();
  const body = player.body;
  const grab = player.grabs.poseDefinition;
  const g = player.rails.grind;
  p.state = player.state;
  p.previousState = player.fsm.previousState;
  p.timeInState = player.fsm.timeInState;
  p.edgeAngle = body.edgeAngle;
  p.brake = body.brakeAmount;
  p.speed = body.speed;
  p.tucking = body.tucking;
  p.charge = player.charge;
  p.landingCompression = player.landingCompression;
  p.landingQuality = player.lastLanding?.quality ?? null;
  p.groundGap = body.groundGap;
  p.grab = player.grabs.current ?? (player.grabs.blend > 0 ? grab : null);
  p.grabBlend = player.grabs.blend;
  p.railStance = g?.stance ?? null;
  p.railStanceYaw = g?.stanceYaw ?? 0;
  p.railBalance = g?.balance ?? 0;
  p.railPress = g?.press ?? 'none';
  p.spinRate = body.angularVelocity.length();
  // Angular velocity in the body frame: +Y yaw (spin), +X pitch (+ = nose down / frontflip), +Z roll.
  _w.copy(body.angularVelocity).applyQuaternion(_q.copy(body.orientation).invert());
  p.localSpin = _w.y;
  p.localFlip = _w.x;
  p.localRoll = _w.z;
  p.impactTime = player.state === 'AIRBORNE' && player.impact.valid ? player.impact.time : -1;
  p.airTime = player.rotation.airTime;
  p.yawRate = body.yawRate;
  p.skidSpeed = body.skidSpeed;
  const l = body.skis[0].load;
  const r = body.skis[1].load;
  p.loadBias = l + r > 1e-3 ? (r - l) / (l + r) : 0;
  p.switchStance = player.switchStance;
  p.time = time;

  // Crash ragdoll: interpolated world transforms of every segment.
  const rv = player.ragdoll;
  const rp = p.ragdoll;
  if (rv) {
    const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
    const n = Math.min(rv.segments.length, RAGDOLL_POSE_CAPACITY);
    for (let i = 0; i < n; i++) {
      const seg = rv.segments[i];
      rp.positions[i].lerpVectors(seg.prevPosition, seg.position, a);
      rp.quaternions[i].slerpQuaternions(seg.prevQuaternion, seg.quaternion, a);
    }
    rp.count = n;
    rp.info = rv.info;
    rp.bootLean = rv.bootLean;
    rp.pelvisVelocity.copy(rv.segments[0].velocity);
    rp.time = rv.time;
    rp.active = true;
  } else {
    rp.active = false;
  }
  return p;
}
