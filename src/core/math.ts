import { Quaternion, Vector3 } from 'three';

/** World up axis. Never mutate. */
export const WORLD_UP: Readonly<Vector3> = Object.freeze(new Vector3(0, 1, 0)) as Readonly<Vector3>;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Derivative of smoothstep with respect to x. */
export function smoothstepDerivative(edge0: number, edge1: number, x: number): number {
  const w = edge1 - edge0;
  const t = (x - edge0) / w;
  if (t <= 0 || t >= 1) return 0;
  return (6 * t - 6 * t * t) / w;
}

/**
 * Frame-rate independent exponential smoothing factor.
 * Returns the blend factor for `lerp(current, target, k)` given a time constant
 * expressed as "sharpness" (1/seconds).
 */
export function dampFactor(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** Angle between two vectors, safe against floating point drift outside [-1, 1]. */
export function safeAngle(a: Vector3, b: Vector3): number {
  const la = a.length();
  const lb = b.length();
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(clamp(a.dot(b) / (la * lb), -1, 1));
}

export function isFiniteVector(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuaternion(q: Quaternion): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

/** Clamps the length of a vector in place. */
export function clampLength(v: Vector3, maxLength: number): Vector3 {
  const l2 = v.lengthSq();
  if (l2 > maxLength * maxLength) v.multiplyScalar(maxLength / Math.sqrt(l2));
  return v;
}

/** Normalizes a quaternion, resetting it to identity if it degenerated. */
export function sanitizeQuaternion(q: Quaternion): Quaternion {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(len) || len < 1e-6) return q.identity();
  return q.set(q.x / len, q.y / len, q.z / len, q.w / len);
}

const _m = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
/**
 * Builds an orientation whose local +Z points along `forward` and local +Y along `up`
 * (forward is orthogonalised against up). Body convention used throughout the game:
 * +Z forward, +Y up, +X left.
 */
export function quaternionFromForwardUp(forward: Vector3, up: Vector3, out: Quaternion): Quaternion {
  const y = _m.y.copy(up).normalize();
  const z = _m.z.copy(forward).addScaledVector(y, -forward.dot(y));
  if (z.lengthSq() < 1e-10) {
    // forward parallel to up: pick any perpendicular axis.
    z.set(1, 0, 0).addScaledVector(y, -y.x);
    if (z.lengthSq() < 1e-10) z.set(0, 0, 1).addScaledVector(y, -y.z);
  }
  z.normalize();
  const x = _m.x.crossVectors(y, z);
  // Rotation matrix columns are x, y, z. Convert to quaternion (Shepperd's method).
  const m00 = x.x,
    m01 = y.x,
    m02 = z.x;
  const m10 = x.y,
    m11 = y.y,
    m12 = z.y;
  const m20 = x.z,
    m21 = y.z,
    m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return sanitizeQuaternion(out);
}

const _axis = new Vector3();
const _dq = new Quaternion();
/** Integrates an orientation by a world-space angular velocity over dt (exact exponential map). */
export function integrateOrientation(q: Quaternion, omegaWorld: Vector3, dt: number): Quaternion {
  const speed = omegaWorld.length();
  if (speed < 1e-9) return q;
  _axis.copy(omegaWorld).divideScalar(speed);
  _dq.setFromAxisAngle(_axis, speed * dt);
  q.premultiply(_dq);
  return sanitizeQuaternion(q);
}

/** Converts a quaternion to a rotation vector (axis * angle), shortest path. */
export function quaternionToRotationVector(q: Quaternion, out: Vector3): Vector3 {
  let { x, y, z, w } = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return out.set(0, 0, 0);
  const angle = 2 * Math.atan2(s, w);
  return out.set(x / s, y / s, z / s).multiplyScalar(angle);
}
