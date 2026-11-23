import { Quaternion, Vector3 } from 'three';
import type { SurfaceType } from '../park/SurfaceFeatures';

/** Contact state of a single ski. Each ski is resolved independently against the snow surface. */
export interface SkiContact {
  /** Ski centre in world space (at the ski base). */
  point: Vector3;
  /** Averaged snow normal under the ski (tip + tail samples). */
  normal: Vector3;
  /** Snow height under the ski centre. */
  height: number;
  /** Distance between ski base and snow along the vertical (m). Negative = penetrating. */
  gap: number;
  inContact: boolean;
  /** Edge angle of this ski relative to the snow (rad, + = tilted onto its left edge). */
  edgeAngle: number;
  /** Normal load carried by this ski (N). */
  load: number;
  /** Lateral skid speed of this ski (m/s). Drives spray and audio. */
  skidSpeed: number;
  /** Ski orientation axis in world space. */
  direction: Vector3;
}

function createSkiContact(): SkiContact {
  return {
    point: new Vector3(),
    normal: new Vector3(0, 1, 0),
    height: 0,
    gap: 0,
    inContact: false,
    edgeAngle: 0,
    load: 0,
    skidSpeed: 0,
    direction: new Vector3(0, 0, 1),
  };
}

/**
 * The simulated physical state of the skier.
 * `position` is the "foot point": the point midway between the two ski bases.
 * Orientation uses the body convention +Z forward, +Y up, +X left.
 */
export class SkierBody {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  /** World-space angular velocity (rad/s). Only integrated while airborne / tumbling. */
  readonly angularVelocity = new Vector3();
  /** Ski heading on the ground (unit, tangent to the snow). */
  readonly heading = new Vector3(0, 0, 1);
  /** Low-pass filtered ground normal used for orientation. */
  readonly groundNormal = new Vector3(0, 1, 0);
  /** Signed edge (lean) angle. + = leaning left. */
  edgeAngle = 0;
  /** Current ground yaw rate (rad/s). */
  yawRate = 0;
  /** Braking blend 0..1 (ramps in gradually). */
  brakeAmount = 0;
  tucking = false;
  /** Filtered normal force from the snow (N). */
  normalForce = 0;
  grounded = true;
  /** Vertical gap between the foot point and the snow (m). */
  groundGap = 0;
  surfaceType: SurfaceType = 'snow';
  featureId: string | null = null;
  /** Lateral (skidding) speed relative to the skis (m/s). */
  skidSpeed = 0;
  readonly skis: [SkiContact, SkiContact] = [createSkiContact(), createSkiContact()];

  reset(position: Vector3, heading: Vector3, normal: Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.heading.copy(heading).normalize();
    this.groundNormal.copy(normal).normalize();
    this.edgeAngle = 0;
    this.yawRate = 0;
    this.brakeAmount = 0;
    this.tucking = false;
    this.normalForce = 0;
    this.grounded = true;
    this.groundGap = 0;
    this.surfaceType = 'snow';
    this.featureId = null;
    this.skidSpeed = 0;
    for (const ski of this.skis) {
      ski.inContact = true;
      ski.load = 0;
      ski.gap = 0;
      ski.skidSpeed = 0;
      ski.edgeAngle = 0;
    }
  }

  get speed(): number {
    return this.velocity.length();
  }
}
