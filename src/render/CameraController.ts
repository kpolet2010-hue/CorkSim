import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraSettings } from '../config/settings';
import { DEG2RAD, clamp, dampFactor, lerp, wrapAngle } from '../core/math';
import type { SurfaceField } from '../park/SurfaceField';

export type CameraMode = 'chase' | 'far' | 'side';

/** Bounds and centre-of-mass velocity of the crash ragdoll (world space). */
export interface CameraBodyFrame {
  /** Centre of the axis-aligned bounding box of the body's extreme points (head, hands, feet, ski tips). */
  centre: Vector3;
  /** Bounding sphere radius around `centre` (m). */
  radius: number;
  /** Half sizes of the bounding box (m). Optional: without it the sphere is framed. */
  halfExtents?: Vector3;
  /** Mass-weighted mean segment velocity (m/s): no spin component, unlike the pelvis. */
  velocity: Vector3;
}

export interface CameraTarget {
  position: Vector3;
  velocity: Vector3;
  heading: Vector3;
  airborne: boolean;
  grinding: boolean;
  crashed: boolean;
  /** Predicted landing point while airborne (keeps framing on the landing). */
  landingPoint: Vector3 | null;
  /**
   * Whole-body framing while CRASHED (ragdoll bounding sphere + centre-of-mass velocity). When present it
   * replaces `position`/`velocity` for framing, because the model root and the pelvis whirl when the body
   * spins. Optional: absent or null outside crashes.
   */
  body?: CameraBodyFrame | null;
}

/** Height query the camera needs from the park (keeps the camera testable without a park). */
export type CameraSurface = Pick<SurfaceField, 'height'>;

/** Crash framing tunables (presentation only; never affects the simulation). */
export const CRASH_CAMERA = {
  /** Blend into the crash framing (1/s). */
  blendIn: 5,
  /** Hand-back to the riding framing after the get-up (1/s; slow so the get-up stays framed). */
  blendOut: 1.3,
  /**
   * Readable screen size: the body's projected half extent as a fraction of the vertical / horizontal
   * half-FOV (the body extent across the view, so a body lying along the view axis is not framed small).
   */
  screenFractionY: 0.45,
  screenFractionX: 0.55,
  /** Extra distance per m/s of slide speed, and its cap (m). */
  speedLead: 0.08,
  maxSpeedLead: 1.2,
  minDistance: 4.2,
  /** The camera stays at least this far outside the body's bounding sphere (m). */
  sphereMargin: 1.4,
  /** Maximum distance beyond the configured riding distance (m). */
  maxExtraDistance: 3,
  /** Camera height above the body centre per metre of distance (tan of the look-down angle, ~20°). */
  elevation: 0.36,
  /**
   * Smoothing of the framed body centre and the fitted distance (1/s); the centre and, during a crash,
   * the camera itself are velocity feed-forwarded so a sliding body is not left behind.
   */
  focusRate: 5,
  fitRate: 2.5,
  /** Smoothing of the body velocity used for feed-forward, yaw and lead (1/s): contact jolts never whip. */
  velocityRate: 2.5,
  minRadius: 0.55,
  maxRadius: 1.6,
  /** Slow yaw drift towards the slide direction (1/s), hard yaw speed cap (rad/s), min slide speed. */
  yawRate: 0.7,
  maxYawSpeed: 0.9,
  minSlideSpeed: 1.5,
  /** Look-ahead along the slide (s) and its cap (m). */
  lookAhead: 0.1,
  maxLookAhead: 1,
  /** Camera clearance over the snow (m) and the steepest boom pitch (rad, ~63°). */
  groundClearance: 0.8,
  maxPitch: 1.1,
  /** Sight-line clearance over the snow (m) and the maximum camera lift to keep it (m). */
  clearance: 0.35,
  maxLift: 4,
  /** 'far' mode multiplier while crashed (instead of the riding ×1.9 / ×2.1). */
  farScale: 1.35,
} as const;

const _desired = new Vector3();
const _look = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();
const _anchor = new Vector3();
const _focusTarget = new Vector3();
const _lead = new Vector3();
const _crashLook = new Vector3();
const _crashDesired = new Vector3();
const _sight = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Support of an axis-aligned box with half sizes `h` along unit direction `d` (max |offset · d|). */
function boxSupport(h: Vector3, d: Vector3): number {
  return h.x * Math.abs(d.x) + h.y * Math.abs(d.y) + h.z * Math.abs(d.z);
}

/**
 * How far the camera must rise so the straight sight line `from → to` clears the snow by `clearance`
 * (looking point fixed). Only the first 75 % of the line is checked: near the body the line meets the
 * snow the body lies on. Returns 0 when the line is already clear, at most `maxLift`.
 */
export function occlusionLift(
  surface: CameraSurface,
  from: Vector3,
  to: Vector3,
  clearance: number,
  maxLift: number,
  samples = 6,
): number {
  let lift = 0;
  for (let i = 1; i <= samples; i++) {
    const f = (i / samples) * 0.75;
    const x = from.x + (to.x - from.x) * f;
    const y = from.y + (to.y - from.y) * f;
    const z = from.z + (to.z - from.z) * f;
    const need = surface.height(x, z) + clearance - y;
    // Raising the camera by L raises the line at fraction f by L·(1 − f).
    if (need > 0) lift = Math.max(lift, need / (1 - f));
  }
  return Math.min(lift, maxLift);
}

/**
 * Third-person skiing camera. Follows the direction of travel (not the skier's facing, so spins stay
 * readable), pulls back with speed, frames jumps so both the skier and the landing are visible, stays
 * above the snow and is smoothed with frame-rate independent exponential damping. It never teleports
 * except through an explicit `snap()`.
 *
 * Crashes (`CRASH_CAMERA`): the camera blends to a whole-body framing of the ragdoll (bounding box
 * centre; distance from the body's extent across the view plus a moderate speed lead, so it keeps a
 * readable screen size), is carried along with the body's smoothed centre-of-mass velocity, drifts its
 * yaw slowly and speed-capped towards the slide direction (pelvis spin never swings it), pitches up
 * instead of backing off when the snow is in the way, and hands back slowly to the riding framing after
 * the get-up. With no crash in progress the riding behaviour is unchanged.
 */
export class CameraController {
  readonly camera: PerspectiveCamera;
  private settings: CameraSettings;
  private yaw = 0;
  private readonly position = new Vector3();
  private readonly lookAt = new Vector3();
  private initialized = false;
  mode: CameraMode = 'chase';
  private shake = 0;
  private airBlend = 0;
  /** 0 = riding framing, 1 = crash framing. */
  private crashBlend = 0;
  /** Smoothed framing centre and fitted body distance (crash framing). */
  private readonly focus = new Vector3();
  private fitDistance = 0;
  /** Smoothed body (or skier) velocity for the crash framing. */
  private readonly crashVel = new Vector3();

  constructor(
    camera: PerspectiveCamera,
    settings: CameraSettings,
    private readonly surface: CameraSurface,
  ) {
    this.camera = camera;
    this.settings = settings;
  }

  setSettings(s: CameraSettings): void {
    this.settings = s;
  }

  cycleMode(): void {
    this.mode = this.mode === 'chase' ? 'far' : this.mode === 'far' ? 'side' : 'chase';
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Blend between the riding (0) and crash (1) framing (read-only, for tests and debugging). */
  get crashFraming(): number {
    return this.crashBlend;
  }

  /**
   * Camera position at `distance` from the framed body centre, behind it along the yaw, pitched up from
   * the base look-down angle just enough that the camera clears the snow and sees the look point.
   */
  private crashBoom(distance: number, side: Vector3 | null, look: Vector3, out: Vector3): Vector3 {
    const C = CRASH_CAMERA;
    const place = (pitch: number) => {
      const c = Math.cos(pitch) * distance;
      out.set(
        this.focus.x - _dir.x * c,
        this.focus.y + Math.sin(pitch) * distance,
        this.focus.z - _dir.z * c,
      );
      if (side) out.add(side);
      return out;
    };
    // Sight target for the occlusion test: the look point, but never below the snow surface there (a body
    // half sunk in a landing would otherwise always look occluded and pitch the boom to the top).
    _sight.copy(look);
    _sight.y = Math.max(_sight.y, this.surface.height(look.x, look.z) + C.clearance);
    const clear = (pitch: number) => {
      place(pitch);
      return (
        out.y >= this.surface.height(out.x, out.z) + C.groundClearance &&
        occlusionLift(this.surface, out, _sight, C.clearance, C.maxLift) === 0
      );
    };
    const base = Math.atan(C.elevation);
    if (clear(base)) return out;
    if (!clear(C.maxPitch)) return place(C.maxPitch);
    // Lowest clear pitch (bisection: continuous, so the boom glides instead of stepping).
    let lo: number = base;
    let hi: number = C.maxPitch;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) * 0.5;
      if (clear(mid)) hi = mid;
      else lo = mid;
    }
    return place(hi);
  }

  /**
   * Distance at which the body's extent across the current view direction fills the readable screen
   * fraction. Uses last frame's view basis, which changes slowly.
   */
  private fitBodyDistance(body: CameraBodyFrame): number {
    const C = CRASH_CAMERA;
    const radius = clamp(body.radius, C.minRadius, C.maxRadius);
    if (this.initialized) _fwd.subVectors(this.lookAt, this.position);
    else _fwd.set(Math.sin(this.yaw), -C.elevation, Math.cos(this.yaw));
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(_fwd, UP);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, _fwd).normalize();
    let rx = radius;
    let ry = radius;
    if (body.halfExtents) {
      rx = Math.min(radius, boxSupport(body.halfExtents, _right));
      ry = Math.min(radius, boxSupport(body.halfExtents, _up));
    }
    const tanY = Math.tan(this.camera.fov * DEG2RAD * 0.5);
    const tanX = tanY * this.camera.aspect;
    const fit = Math.max(
      ry / Math.tan(C.screenFractionY * Math.atan(tanY)),
      rx / Math.tan(C.screenFractionX * Math.atan(tanX)),
    );
    return Math.max(fit, radius + C.sphereMargin);
  }

  /** Immediately places the camera behind the target (explicit teleport, e.g. after a reset). */
  snap(t: CameraTarget): void {
    this.initialized = false;
    this.update(t, 1 / 60);
  }

  update(t: CameraTarget, dt: number): void {
    const s = this.settings;
    const C = CRASH_CAMERA;
    const body = t.crashed && t.body ? t.body : null;

    // Crash framing blend: quick in, slow out (the get-up stays framed, no snap back).
    if (!this.initialized) this.crashBlend = t.crashed ? 1 : 0;
    else
      this.crashBlend = lerp(
        this.crashBlend,
        t.crashed ? 1 : 0,
        dampFactor(t.crashed ? C.blendIn : C.blendOut, dt),
      );
    if (!t.crashed && this.crashBlend < 1e-3) this.crashBlend = 0;
    const cb = this.crashBlend;

    // Velocity that drives the framing: the body's centre of mass while crashed (the pelvis velocity
    // contains the spin), smoothed so contact jolts do not whip the camera; the skier's velocity otherwise.
    // Never faster than the body actually moves: a sudden stop (tree, deep snow) stops the feed-forward at
    // once instead of carrying the camera on into the body.
    const rawVel = body ? body.velocity : t.velocity;
    if (!this.initialized || cb === 0) this.crashVel.copy(rawVel);
    else {
      this.crashVel.lerp(rawVel, dampFactor(C.velocityRate, dt));
      const rawSpeed = rawVel.length();
      if (this.crashVel.lengthSq() > rawSpeed * rawSpeed) this.crashVel.setLength(rawSpeed);
    }
    const vel = cb > 0 ? this.crashVel : t.velocity;

    // Framing centre: the ragdoll's bounds while crashed, the standing body otherwise.
    if (body) _focusTarget.copy(body.centre);
    else {
      _focusTarget.copy(t.position);
      _focusTarget.y += t.crashed ? 0.4 : 0.9;
    }
    if (!this.initialized || cb === 0) this.focus.copy(_focusTarget);
    else {
      // Velocity feed-forward: no lag behind a sliding body, only the jitter is smoothed.
      this.focus.addScaledVector(vel, dt);
      this.focus.lerp(_focusTarget, dampFactor(C.focusRate, dt));
    }
    // Body fit distance: starts at the first ragdoll frame, then smoothed; held (not reset) after the
    // get-up so the hand-back blends from the crash framing actually in use.
    if (body) {
      const fitTarget = this.fitBodyDistance(body);
      if (!this.initialized || this.fitDistance <= 0) this.fitDistance = fitTarget;
      else this.fitDistance = lerp(this.fitDistance, fitTarget, dampFactor(C.fitRate, dt));
    } else if (cb === 0) this.fitDistance = 0;

    // Desired yaw: direction of travel when moving, ski heading when nearly stopped. While crashed:
    // a slow drift towards the body's slide direction (never the spinning pelvis or heading).
    const hv = Math.hypot(vel.x, vel.z);
    let targetYaw = this.yaw;
    if (t.crashed) {
      if (body && hv > C.minSlideSpeed) targetYaw = Math.atan2(vel.x, vel.z);
    } else if (hv > 1.2) targetYaw = Math.atan2(vel.x, vel.z);
    else targetYaw = Math.atan2(t.heading.x, t.heading.z);
    this.airBlend = lerp(this.airBlend, t.airborne ? 1 : 0, dampFactor(3, dt));
    if (!this.initialized) {
      this.yaw = targetYaw;
    } else {
      // Slower yaw follow in the air so rotations read clearly; sensitivity scales responsiveness.
      // Crashed: the drift rules apply at once (no fast swing at the impact); after the get-up they fade
      // out with the framing blend.
      const yb = t.crashed ? 1 : cb;
      const rideRate = (t.airborne ? 1.1 : 2.6) * s.sensitivity;
      let step =
        wrapAngle(targetYaw - this.yaw) * dampFactor(lerp(rideRate, C.yawRate * s.sensitivity, yb), dt);
      if (yb > 0) {
        const maxStep = lerp(8, C.maxYawSpeed, yb) * dt;
        step = clamp(step, -maxStep, maxStep);
      }
      this.yaw = wrapAngle(this.yaw + step);
    }
    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const speed = vel.length();

    // Riding framing (anchored at the foot point). While crashed the model root whirls with the body,
    // so the equivalent foot point below the framed centre is used instead.
    if (t.crashed) {
      _anchor.copy(this.focus);
      _anchor.y -= 0.9;
    } else _anchor.copy(t.position);
    const air = this.airBlend * (1 - cb);
    let distance = s.distance + clamp(speed * 0.06, 0, 2.2) + air * 1.6;
    let height = s.height + air * 0.9;
    let side = 0;
    if (this.mode === 'far') {
      distance *= 1.9;
      height *= 2.1;
    } else if (this.mode === 'side') {
      distance *= 0.9;
      side = 4.5;
    }
    if (side !== 0) _side.set(_dir.z, 0, -_dir.x).multiplyScalar(side);
    _desired.copy(_anchor).addScaledVector(_dir, -distance);
    _desired.y += height;
    if (side !== 0) _desired.add(_side);
    _look.copy(_anchor);
    _look.y += 0.9;
    _look.addScaledVector(vel, 0.12);
    if (t.landingPoint && t.airborne) _look.lerp(t.landingPoint, 0.18);

    if (cb > 0) {
      // Crash framing: a boom of fixed length from the body centre (fit distance for a readable screen
      // size plus a moderate lead with slide speed), looking slightly down at the body. When the snow
      // behind is in the way (steep landings, crests), the boom pitches up instead of being pushed out,
      // so the body keeps its size.
      let crashDistance = clamp(
        this.fitDistance + clamp(speed * C.speedLead, 0, C.maxSpeedLead),
        C.minDistance,
        s.distance + C.maxExtraDistance,
      );
      if (this.mode === 'far') crashDistance *= C.farScale;
      _lead.copy(vel).multiplyScalar(C.lookAhead);
      if (_lead.length() > C.maxLookAhead) _lead.setLength(C.maxLookAhead);
      _crashLook.copy(this.focus).add(_lead);
      this.crashBoom(crashDistance, side !== 0 ? _side : null, _crashLook, _crashDesired);
      _desired.lerp(_crashDesired, cb);
      _look.lerp(_crashLook, cb);
    }

    // Never go below the snow.
    const ground = this.surface.height(_desired.x, _desired.z) + 0.7;
    if (_desired.y < ground) _desired.y = ground;
    // While crashed: rise until the sight line to the body clears the snow (crests, steep rollovers).
    if (cb > 0) {
      _sight.copy(_look);
      _sight.y = Math.max(_sight.y, this.surface.height(_look.x, _look.z) + C.clearance);
      _desired.y += cb * occlusionLift(this.surface, _desired, _sight, C.clearance, C.maxLift);
    }

    if (!this.initialized) {
      this.position.copy(_desired);
      this.lookAt.copy(_look);
      this.initialized = true;
    } else {
      if (cb > 0) {
        // Crash: carry the camera with the body so the smoothing does not leave it behind (the riding
        // camera's lag with speed is intentional; a sliding body would shrink with it).
        this.position.addScaledVector(vel, dt * cb);
        this.lookAt.addScaledVector(vel, dt * cb);
      }
      this.position.lerp(_desired, dampFactor(s.smoothing, dt));
      this.lookAt.lerp(_look, dampFactor(s.smoothing * 1.8, dt));
      const g = this.surface.height(this.position.x, this.position.z) + 0.5;
      if (this.position.y < g) this.position.y = g;
    }
    this.camera.position.copy(this.position);
    if (this.shake > 0.001) {
      const a = this.shake * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.lookAt);
    const fov = s.fov + clamp(speed * 0.35, 0, 12) + air * 3;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, fov, dampFactor(3, dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
