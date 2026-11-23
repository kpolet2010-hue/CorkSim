import { Quaternion, Vector3 } from 'three';

const _up = new Vector3();
const _fwd = new Vector3();

/**
 * Accumulates the actual rotation performed while airborne.
 *
 * We integrate the world-space angular velocity: W = ∫ ω dt. For a rotation about a fixed axis â by angle θ
 * this is exactly θ·â, which makes it ideal for classifying spins (vertical axis), flips (horizontal axis)
 * and off-axis rotations (tilted axis). W is expressed in the takeoff frame (Up, Forward, Left) so the
 * classification is independent of which way the jump faces. Inversions are counted separately with
 * hysteresis from the body's up vector, which tells doubles/triples apart.
 */
export class RotationTracker {
  /** Integrated rotation vector in world space (rad). */
  readonly rotation = new Vector3();
  /** Takeoff frame. */
  readonly forward = new Vector3(0, 0, 1);
  readonly left = new Vector3(1, 0, 0);
  airTime = 0;
  inversions = 0;
  private inverted = false;
  /** Lowest value of body-up · world-up seen (1 = upright, -1 = upside down). */
  minUpDot = 1;
  takeoffSwitch = false;
  takeoffHeight = 0;
  maxHeight = 0;
  active = false;

  begin(orientation: Quaternion, velocity: Vector3, switchStance: boolean, height: number): void {
    this.rotation.set(0, 0, 0);
    this.airTime = 0;
    this.inversions = 0;
    this.inverted = false;
    this.minUpDot = 1;
    this.takeoffSwitch = switchStance;
    this.takeoffHeight = height;
    this.maxHeight = height;
    this.active = true;
    _fwd.set(0, 0, 1).applyQuaternion(orientation);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) {
      _fwd.set(velocity.x, 0, velocity.z);
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
    }
    this.forward.copy(_fwd.normalize());
    // left = up × forward
    this.left.set(this.forward.z, 0, -this.forward.x);
  }

  update(angularVelocity: Vector3, orientation: Quaternion, height: number, dt: number): void {
    if (!this.active) return;
    this.rotation.addScaledVector(angularVelocity, dt);
    this.airTime += dt;
    this.maxHeight = Math.max(this.maxHeight, height);
    _up.set(0, 1, 0).applyQuaternion(orientation);
    const d = _up.y;
    this.minUpDot = Math.min(this.minUpDot, d);
    if (!this.inverted && d < -0.15) {
      this.inverted = true;
      this.inversions++;
    } else if (this.inverted && d > 0.25) {
      this.inverted = false;
    }
  }

  /** Signed rotation about world up (rad). + = left / counter-clockwise. */
  get spin(): number {
    return this.rotation.y;
  }

  /** Signed rotation about the takeoff left axis (rad). + = frontflip direction. */
  get pitch(): number {
    return this.rotation.dot(this.left);
  }

  /** Signed rotation about the takeoff forward axis (rad). */
  get roll(): number {
    return this.rotation.dot(this.forward);
  }

  get total(): number {
    return this.rotation.length();
  }

  end(): void {
    this.active = false;
  }
}
