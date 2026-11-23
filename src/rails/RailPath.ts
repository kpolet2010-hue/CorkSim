import { Vector3 } from 'three';
import { clamp } from '../core/math';

export interface RailProjection {
  /** Arc length parameter of the closest point (m). */
  s: number;
  point: Vector3;
  tangent: Vector3;
  /** Distance from the query point to the closest point (m). */
  distance: number;
  segment: number;
}

export function createRailProjection(): RailProjection {
  return { s: 0, point: new Vector3(), tangent: new Vector3(1, 0, 0), distance: 0, segment: 0 };
}

/**
 * A rail or box treated as a geometric path (polyline of the grind surface top line).
 * Curved features are pre-sampled from a Catmull-Rom spline so every query is an exact polyline
 * projection. Position along the rail is described by the arc-length parameter s.
 */
export class RailPath {
  readonly points: Vector3[];
  /** Cumulative arc length at each point. */
  readonly lengths: number[];
  readonly totalLength: number;
  /** Indices of points where the direction changes noticeably (kinks). */
  readonly kinks: number[];
  readonly min = new Vector3();
  readonly max = new Vector3();

  constructor(points: Vector3[]) {
    if (points.length < 2) throw new Error('RailPath requires at least two points');
    this.points = points.map((p) => p.clone());
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i++) {
      this.lengths.push(this.lengths[i - 1] + this.points[i].distanceTo(this.points[i - 1]));
    }
    this.totalLength = this.lengths[this.lengths.length - 1];
    if (this.totalLength < 0.1) throw new Error('RailPath is too short');
    this.kinks = [];
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 1; i < this.points.length - 1; i++) {
      a.subVectors(this.points[i], this.points[i - 1]).normalize();
      b.subVectors(this.points[i + 1], this.points[i]).normalize();
      if (a.dot(b) < Math.cos((8 * Math.PI) / 180)) this.kinks.push(i);
    }
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    for (const p of this.points) {
      this.min.min(p);
      this.max.max(p);
    }
  }

  /** Samples a Catmull-Rom spline through control points into a dense polyline. */
  static fromSmoothControlPoints(control: Vector3[], spacing = 0.25): RailPath {
    if (control.length < 3) return new RailPath(control);
    const out: Vector3[] = [];
    const get = (i: number) => control[clamp(i, 0, control.length - 1)];
    for (let i = 0; i < control.length - 1; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);
      const segLen = p1.distanceTo(p2);
      const steps = Math.max(2, Math.ceil(segLen / spacing));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const v = new Vector3();
        v.x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        v.y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        v.z =
          0.5 *
          (2 * p1.z +
            (-p0.z + p2.z) * t +
            (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
            (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        out.push(v);
      }
    }
    out.push(control[control.length - 1].clone());
    return new RailPath(out);
  }

  private segmentAt(s: number): number {
    const L = this.lengths;
    if (s <= 0) return 0;
    if (s >= this.totalLength) return L.length - 2;
    let lo = 0;
    let hi = L.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number, out: Vector3): Vector3 {
    const i = this.segmentAt(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const segLen = this.lengths[i + 1] - this.lengths[i];
    const t = segLen > 1e-9 ? clamp((s - this.lengths[i]) / segLen, 0, 1) : 0;
    return out.copy(a).lerp(b, t);
  }

  tangentAt(s: number, out: Vector3): Vector3 {
    const i = this.segmentAt(s);
    return out.subVectors(this.points[i + 1], this.points[i]).normalize();
  }

  /** Closest point on the path to `p`. Linear in the number of segments (paths are short). */
  project(p: Vector3, out: RailProjection): RailProjection {
    let bestD2 = Infinity;
    const pts = this.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x,
        aby = b.y - a.y,
        abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
      t = clamp(t, 0, 1);
      const cx = a.x + abx * t,
        cy = a.y + aby * t,
        cz = a.z + abz * t;
      const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        out.point.set(cx, cy, cz);
        out.s = this.lengths[i] + Math.sqrt(len2) * t;
        out.segment = i;
      }
    }
    out.distance = Math.sqrt(bestD2);
    this.tangentAt(out.s, out.tangent);
    return out;
  }
}
