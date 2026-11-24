import { Quaternion, Vector3 } from 'three';
import type { PlayerController } from '../player/PlayerController';
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
  };
}

/**
 * Builds the animation input from the (read-only) simulation state. This is the single sim -> animation
 * mapping; extend `SkierPoseInput` and this function together. Owned by character/animation.
 * Pass `out` to reuse an object (no per-frame allocation); otherwise a new object is returned.
 */
export function buildSkierPose(player: PlayerController, time: number, out?: SkierPoseInput): SkierPoseInput {
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
  return p;
}
