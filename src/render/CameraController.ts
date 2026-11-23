import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraSettings } from '../config/settings';
import { clamp, dampFactor, lerp, wrapAngle } from '../core/math';
import type { SurfaceField } from '../park/SurfaceField';

export type CameraMode = 'chase' | 'far' | 'side';

export interface CameraTarget {
  position: Vector3;
  velocity: Vector3;
  heading: Vector3;
  airborne: boolean;
  grinding: boolean;
  crashed: boolean;
  /** Predicted landing point while airborne (keeps framing on the landing). */
  landingPoint: Vector3 | null;
}

const _desired = new Vector3();
const _look = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();

/**
 * Third-person skiing camera. Follows the direction of travel (not the skier's facing, so spins stay
 * readable), pulls back with speed, frames jumps so both the skier and the landing are visible, stays
 * above the snow and is smoothed with frame-rate independent exponential damping. It never teleports
 * except through an explicit `snap()`.
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

  constructor(
    camera: PerspectiveCamera,
    settings: CameraSettings,
    private readonly surface: SurfaceField,
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

  /** Immediately places the camera behind the target (explicit teleport, e.g. after a reset). */
  snap(t: CameraTarget): void {
    this.initialized = false;
    this.update(t, 1 / 60);
  }

  update(t: CameraTarget, dt: number): void {
    const s = this.settings;
    const hv = Math.hypot(t.velocity.x, t.velocity.z);
    // Desired yaw: direction of travel when moving, ski heading when nearly stopped.
    let targetYaw = this.yaw;
    if (hv > 1.2 && !t.crashed) targetYaw = Math.atan2(t.velocity.x, t.velocity.z);
    else if (!t.crashed) targetYaw = Math.atan2(t.heading.x, t.heading.z);
    this.airBlend = lerp(this.airBlend, t.airborne ? 1 : 0, dampFactor(3, dt));
    if (!this.initialized) {
      this.yaw = targetYaw;
    } else {
      // Slower yaw follow in the air so rotations read clearly; sensitivity scales responsiveness.
      const rate = (t.airborne ? 1.1 : 2.6) * s.sensitivity;
      this.yaw += wrapAngle(targetYaw - this.yaw) * dampFactor(rate, dt);
    }
    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const speed = t.velocity.length();
    let distance = s.distance + clamp(speed * 0.06, 0, 2.2) + this.airBlend * 1.6;
    let height = s.height + this.airBlend * 0.9;
    let side = 0;
    if (this.mode === 'far') {
      distance *= 1.9;
      height *= 2.1;
    } else if (this.mode === 'side') {
      distance *= 0.9;
      side = 4.5;
    }
    _desired.copy(t.position).addScaledVector(_dir, -distance);
    _desired.y += height;
    if (side !== 0) _desired.add(_side.set(_dir.z, 0, -_dir.x).multiplyScalar(side));
    // Never go below the snow.
    const ground = this.surface.height(_desired.x, _desired.z) + 0.7;
    if (_desired.y < ground) _desired.y = ground;

    // Look slightly ahead of the skier; in the air bias towards the landing so it stays in frame.
    _look.copy(t.position);
    _look.y += 0.9;
    _look.addScaledVector(t.velocity, 0.12);
    if (t.landingPoint && t.airborne) _look.lerp(t.landingPoint, 0.18);

    if (!this.initialized) {
      this.position.copy(_desired);
      this.lookAt.copy(_look);
      this.initialized = true;
    } else {
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
    const fov = s.fov + clamp(speed * 0.35, 0, 12) + this.airBlend * 3;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, fov, dampFactor(3, dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
