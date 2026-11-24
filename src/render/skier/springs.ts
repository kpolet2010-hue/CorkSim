import type { Vector3 } from 'three';

/** Largest integration step of the springs (s). Keeps them stable and frame-rate independent. */
const MAX_STEP = 1 / 120;

/** A scalar second-order spring (position + velocity). */
export interface Spring {
  x: number;
  v: number;
}

export function createSpring(x = 0): Spring {
  return { x, v: 0 };
}

/**
 * Advances a damped spring towards `target`. `frequency` is the natural frequency in Hz, `damping` the
 * damping ratio (1 = critically damped, < 1 overshoots). Sub-stepped semi-implicit Euler, so the result
 * is (nearly) independent of the frame rate and stable for any dt.
 */
export function stepSpring(s: Spring, target: number, frequency: number, damping: number, dt: number): number {
  const w = 2 * Math.PI * frequency;
  let remaining = Math.max(0, dt);
  while (remaining > 1e-7) {
    const h = Math.min(remaining, MAX_STEP);
    const a = w * w * (target - s.x) - 2 * damping * w * s.v;
    s.v += a * h;
    s.x += s.v * h;
    remaining -= h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = target;
    s.v = 0;
  }
  return s.x;
}

/** A vector spring: position and velocity stored in two caller-owned vectors (no allocation per step). */
export interface Spring3 {
  x: Vector3;
  v: Vector3;
}

export function stepSpring3(
  s: Spring3,
  target: Vector3,
  frequency: number,
  damping: number,
  dt: number,
): Vector3 {
  const w = 2 * Math.PI * frequency;
  const k = w * w;
  const c = 2 * damping * w;
  let remaining = Math.max(0, dt);
  while (remaining > 1e-7) {
    const h = Math.min(remaining, MAX_STEP);
    s.v.x += (k * (target.x - s.x.x) - c * s.v.x) * h;
    s.v.y += (k * (target.y - s.x.y) - c * s.v.y) * h;
    s.v.z += (k * (target.z - s.x.z) - c * s.v.z) * h;
    s.x.addScaledVector(s.v, h);
    remaining -= h;
  }
  if (!Number.isFinite(s.x.x + s.x.y + s.x.z + s.v.x + s.v.y + s.v.z)) {
    s.x.copy(target);
    s.v.set(0, 0, 0);
  }
  return s.x;
}

/** Frame-rate independent exponential approach (same shape as `dampFactor` in core/math). */
export function damp(current: number, target: number, sharpness: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-sharpness * Math.max(0, dt)));
}

/** Smooth 0..1 ramp. */
export function ramp(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Cheap deterministic smooth noise in [-1, 1] (sum of incommensurate sines). */
export function wobble(t: number, seed: number): number {
  return (
    Math.sin(t * 1.0 + seed * 12.9898) * 0.5 +
    Math.sin(t * 2.31 + seed * 78.233) * 0.3 +
    Math.sin(t * 4.17 + seed * 37.719) * 0.2
  );
}
