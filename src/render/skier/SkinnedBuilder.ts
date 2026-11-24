import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three';

/** Up to two bone influences per vertex (enough for garments bending over a joint). */
export interface SkinWeights {
  a: number;
  b: number;
  /** Weight of bone `b` (bone `a` gets 1 - t). */
  t: number;
}

export function rigid(bone: number): SkinWeights {
  return { a: bone, b: bone, t: 0 };
}

export function blend(a: number, b: number, t: number): SkinWeights {
  const c = Math.min(1, Math.max(0, t));
  return { a, b, t: c };
}

/** One generated vertex of a grid primitive. Filled by the primitive's callback. */
export interface GridVertex {
  p: Vector3;
  color: Color;
  u: number;
  v: number;
  w: SkinWeights;
}

export interface GridOptions {
  /** Close the columns into a ring (last column connects to the first). */
  wrap?: boolean;
  /** Reverse the triangle winding. */
  flip?: boolean;
  /** Add a fan cap over the first / last row (requires `wrap`). */
  capStart?: boolean;
  capEnd?: boolean;
}

const _v = new Vector3();
const _gv: GridVertex = { p: new Vector3(), color: new Color(), u: 0, v: 0, w: rigid(0) };

/**
 * Accumulates vertices (position, colour, uv, skin index/weight) for one skinned mesh. Parts are
 * authored in the rig's rest pose (all joint rotations identity) in root space; `transform` lets a part be
 * authored in a bone's local frame. Normals are computed at the end (smooth within each primitive).
 */
export class SkinnedBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  private readonly idx: number[] = [];
  /** Transform applied to every vertex added (bone rest frame + local part placement). */
  readonly transform = new Matrix4();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  private push(gv: GridVertex): number {
    _v.copy(gv.p).applyMatrix4(this.transform);
    this.pos.push(_v.x, _v.y, _v.z);
    this.col.push(gv.color.r, gv.color.g, gv.color.b);
    this.uv.push(gv.u, gv.v);
    this.si.push(gv.w.a, gv.w.b, 0, 0);
    this.sw.push(1 - gv.w.t, gv.w.t, 0, 0);
    return this.pos.length / 3 - 1;
  }

  /**
   * Generic (rows + 1) x (cols + 1) vertex grid. `fn(r, c, out)` fills each vertex; r runs over rows
   * (0..rows), c over columns (0..cols, or 0..cols-1 when wrapping).
   */
  grid(rows: number, cols: number, fn: (r: number, c: number, out: GridVertex) => void, o: GridOptions = {}): void {
    const wrap = o.wrap ?? false;
    const nc = wrap ? cols : cols + 1;
    const base = this.vertexCount;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < nc; c++) {
        _gv.u = c / cols;
        _gv.v = r / rows;
        fn(r, c, _gv);
        this.push(_gv);
      }
    }
    const at = (r: number, c: number) => base + r * nc + (wrap ? c % cols : c);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = at(r, c);
        const b = at(r, c + 1);
        const d = at(r + 1, c);
        const e = at(r + 1, c + 1);
        if (o.flip) this.idx.push(a, b, d, d, b, e);
        else this.idx.push(a, d, b, b, d, e);
      }
    }
    if (wrap && (o.capStart || o.capEnd)) {
      const cap = (row: number, reverse: boolean) => {
        // Centre vertex = average of the ring, using the ring's first vertex attributes.
        const cx = new Vector3();
        for (let c = 0; c < cols; c++) {
          const i = at(row, c) * 3;
          cx.x += this.pos[i];
          cx.y += this.pos[i + 1];
          cx.z += this.pos[i + 2];
        }
        cx.divideScalar(cols);
        const first = at(row, 0);
        this.pos.push(cx.x, cx.y, cx.z);
        this.col.push(this.col[first * 3], this.col[first * 3 + 1], this.col[first * 3 + 2]);
        this.uv.push(0.5, row === 0 ? 0 : 1);
        for (let k = 0; k < 4; k++) {
          this.si.push(this.si[first * 4 + k]);
          this.sw.push(this.sw[first * 4 + k]);
        }
        const centre = this.vertexCount - 1;
        for (let c = 0; c < cols; c++) {
          const a = at(row, c);
          const b = at(row, c + 1);
          const rev = reverse !== !!o.flip;
          if (rev) this.idx.push(centre, b, a);
          else this.idx.push(centre, a, b);
        }
      };
      if (o.capStart) cap(0, false);
      if (o.capEnd) cap(rows, true);
    }
  }

  /**
   * Loft through horizontal rings (rest-pose limbs are vertical). Each ring is a superellipse in the
   * XZ plane: `n` = 2 ellipse, 4+ rounded rectangle. `ring(r, out)` describes ring r; `vertex` may
   * further shape each vertex (folds, colour panels).
   */
  loft(
    rings: number,
    segments: number,
    ring: (r: number, out: LoftRing) => void,
    vertex?: (r: number, theta: number, out: GridVertex, ringInfo: LoftRing) => void,
    o: GridOptions = {},
  ): void {
    const info: LoftRing = createLoftRing();
    let lastR = -1;
    this.grid(
      rings,
      segments,
      (r, c, out) => {
        if (r !== lastR) {
          resetLoftRing(info);
          ring(r, info);
          lastR = r;
        }
        const theta = (c / segments) * Math.PI * 2;
        const cs = Math.cos(theta);
        const sn = Math.sin(theta);
        const e = 2 / info.n;
        const sx = Math.sign(cs) * Math.pow(Math.abs(cs), e);
        const sz = Math.sign(sn) * Math.pow(Math.abs(sn), e);
        // theta = 0 points to +X, PI/2 to +Z (front).
        out.p.set(info.x + sx * info.rx, info.y, info.z + sz * info.rz);
        out.color.copy(info.color);
        out.w = info.w;
        if (vertex) vertex(r, theta, out, info);
      },
      { wrap: true, ...o, flip: !(o.flip ?? false) },
    );
  }

  /** Ellipsoid (UV sphere) with optional per-vertex shaping. */
  ellipsoid(
    centre: Vector3,
    rx: number,
    ry: number,
    rz: number,
    color: Color,
    w: SkinWeights,
    rows = 10,
    cols = 14,
    vertex?: (phi: number, theta: number, out: GridVertex) => void,
  ): void {
    this.grid(
      rows,
      cols,
      (r, c, out) => {
        const phi = (r / rows) * Math.PI; // 0 top .. PI bottom
        const theta = (c / cols) * Math.PI * 2;
        out.p.set(
          centre.x + Math.sin(phi) * Math.cos(theta) * rx,
          centre.y + Math.cos(phi) * ry,
          centre.z + Math.sin(phi) * Math.sin(theta) * rz,
        );
        out.color.copy(color);
        out.w = w;
        if (vertex) vertex(phi, theta, out);
      },
      { wrap: true, flip: true },
    );
  }

  /** Axis-aligned rounded box (superellipsoid), cheap detail for buckles, bindings, pads. */
  roundedBox(centre: Vector3, hx: number, hy: number, hz: number, color: Color, w: SkinWeights, n = 6): void {
    const e = 2 / n;
    const f = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
    this.grid(
      6,
      12,
      (r, c, out) => {
        const phi = (r / 6) * Math.PI;
        const theta = (c / 12) * Math.PI * 2;
        out.p.set(
          centre.x + f(Math.sin(phi)) * f(Math.cos(theta)) * hx,
          centre.y + f(Math.cos(phi)) * hy,
          centre.z + f(Math.sin(phi)) * f(Math.sin(theta)) * hz,
        );
        out.color.copy(color);
        out.w = w;
      },
      { wrap: true, flip: true },
    );
  }

  /** Round tube along a polyline (zippers, straps, piping). */
  tube(
    points: readonly Vector3[],
    radius: number,
    color: Color,
    w: SkinWeights | ((index: number) => SkinWeights),
    sides = 6,
  ): void {
    const n = points.length;
    const t = new Vector3();
    const nrm = new Vector3();
    const bin = new Vector3();
    const up = new Vector3();
    this.grid(
      n - 1,
      sides,
      (r, c, out) => {
        const p = points[r];
        t.subVectors(points[Math.min(n - 1, r + 1)], points[Math.max(0, r - 1)]).normalize();
        up.set(0, 1, 0);
        if (Math.abs(t.dot(up)) > 0.9) up.set(1, 0, 0);
        nrm.crossVectors(t, up).normalize();
        bin.crossVectors(t, nrm).normalize();
        const a = (c / sides) * Math.PI * 2;
        out.p
          .copy(p)
          .addScaledVector(nrm, Math.cos(a) * radius)
          .addScaledVector(bin, Math.sin(a) * radius);
        out.color.copy(color);
        out.w = typeof w === 'function' ? w(r) : w;
      },
      { wrap: true, flip: true },
    );
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.si), 4));
    g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.sw), 4));
    const count = this.vertexCount;
    g.setIndex(count > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Description of one loft ring (filled by the ring callback). */
export interface LoftRing {
  x: number;
  y: number;
  z: number;
  rx: number;
  rz: number;
  /** Superellipse exponent: 2 = ellipse, larger = boxier. */
  n: number;
  color: Color;
  w: SkinWeights;
}

function createLoftRing(): LoftRing {
  return { x: 0, y: 0, z: 0, rx: 0.1, rz: 0.1, n: 2, color: new Color(1, 1, 1), w: rigid(0) };
}

function resetLoftRing(r: LoftRing): void {
  r.x = 0;
  r.y = 0;
  r.z = 0;
  r.rx = 0.1;
  r.rz = 0.1;
  r.n = 2;
  r.color.setRGB(1, 1, 1);
  r.w = rigid(0);
}

/** Piecewise-linear interpolation through sorted (key, value...) rows, used for garment profiles. */
export function profile(rows: readonly (readonly number[])[], key: number, out: number[]): number[] {
  const n = rows.length;
  const width = rows[0].length;
  out.length = width - 1;
  if (key <= rows[0][0]) {
    for (let i = 1; i < width; i++) out[i - 1] = rows[0][i];
    return out;
  }
  if (key >= rows[n - 1][0]) {
    for (let i = 1; i < width; i++) out[i - 1] = rows[n - 1][i];
    return out;
  }
  for (let k = 0; k < n - 1; k++) {
    const a = rows[k];
    const b = rows[k + 1];
    if (key >= a[0] && key <= b[0]) {
      const t = (key - a[0]) / (b[0] - a[0] || 1);
      const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5; // slightly eased for rounder silhouettes
      for (let i = 1; i < width; i++) out[i - 1] = a[i] + (b[i] - a[i]) * s;
      return out;
    }
  }
  return out;
}
