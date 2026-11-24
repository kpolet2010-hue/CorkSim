import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { Random } from '../core/Random';
import { smoothstep } from '../core/math';
import type { Park } from '../park/Park';

export interface PropInstance {
  x: number;
  y: number;
  z: number;
  /** Footprint radius (m). */
  radius: number;
  /** Height scale (m). */
  height: number;
  yaw: number;
  /** Terrain gradient at the prop (dHeight/dx, dHeight/dz); props lean partly into the slope. */
  gx: number;
  gz: number;
}

export interface PropPlacement {
  rocks: PropInstance[];
  mounds: PropInstance[];
}

/** Props are kept at least this far outside the corridor edge (beyond the banks and fences). */
export const PROP_CORRIDOR_MARGIN = 9;

/**
 * Deterministic scenery placement: rock outcrops (clusters) and wind-blown snow mounds outside the skiable
 * corridor. Pure data, no rendering, so it is unit-testable. Never inside the corridor, never on a feature,
 * and kept clear of tree trunks.
 */
export function placeProps(park: Park, rockCount: number, moundCount: number): PropPlacement {
  const rng = new Random(park.config.seed * 97 + 13);
  const t = park.config.terrain;
  const minAbsX = t.halfWidth + PROP_CORRIDOR_MARGIN;
  const zMin = -140;
  const zMax = t.length + 260;
  const trees = park.trees;
  const clearOfTrees = (x: number, z: number, r: number): boolean => {
    for (const tr of trees) {
      const dx = tr.x - x;
      const dz = tr.z - z;
      const m = r + 1.2;
      if (dx * dx + dz * dz < m * m) return false;
    }
    return true;
  };
  const valid = (x: number, z: number, r: number): boolean => {
    if (Math.abs(x) - r < minAbsX) return false;
    if (z < zMin || z > zMax) return false;
    // Not on (or touching) any snow feature.
    if (Math.abs(park.surface.height(x, z) - park.terrain.height(x, z)) > 1e-3) return false;
    return clearOfTrees(x, z, r);
  };
  const g = { x: 0, z: 0 };

  const rocks: PropInstance[] = [];
  let attempts = 0;
  while (rocks.length < rockCount && attempts < rockCount * 30) {
    attempts++;
    // Outcrop centre, denser towards the valley walls.
    const side = rng.next() < 0.5 ? -1 : 1;
    const cx = side * (minAbsX + 4 + Math.pow(rng.next(), 0.8) * 140);
    const cz = rng.range(zMin, zMax);
    const n = 2 + Math.floor(rng.next() * 5);
    const big = 0.8 + rng.next() * 2.2 + smoothstep(50, 150, Math.abs(cx) - t.halfWidth) * 2.6;
    for (let i = 0; i < n && rocks.length < rockCount; i++) {
      const r = big * (i === 0 ? 1 : 0.35 + rng.next() * 0.5);
      const a = rng.next() * Math.PI * 2;
      const d = i === 0 ? 0 : big * (0.8 + rng.next() * 1.4);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!valid(x, z, r)) continue;
      park.terrain.gradient(x, z, g);
      const slope = Math.hypot(g.x, g.z);
      rocks.push({
        x,
        z,
        // Sink a third of the rock (more on slopes) so it reads as bedrock, not a pebble on top.
        y: park.terrain.height(x, z) - r * (0.3 + slope * 0.5),
        radius: r,
        height: r * (0.55 + rng.next() * 0.5),
        yaw: rng.next() * Math.PI * 2,
        gx: g.x,
        gz: g.z,
      });
    }
  }

  const mounds: PropInstance[] = [];
  attempts = 0;
  while (mounds.length < moundCount && attempts < moundCount * 30) {
    attempts++;
    const side = rng.next() < 0.5 ? -1 : 1;
    const x = side * (minAbsX + Math.pow(rng.next(), 1.4) * 120);
    const z = rng.range(zMin, zMax);
    const r = 1.6 + rng.next() * 3.4;
    if (!valid(x, z, r)) continue;
    park.terrain.gradient(x, z, g);
    mounds.push({
      x,
      z,
      y: park.terrain.height(x, z) - r * Math.hypot(g.x, g.z) * 0.6 - 0.05,
      radius: r,
      height: 0.35 + rng.next() * 0.75,
      yaw: rng.next() * Math.PI * 2,
      gx: g.x,
      gz: g.z,
    });
  }
  return { rocks, mounds };
}

/** Low-poly faceted rock with a snow cap on upward faces (vertex colours). Deterministic. */
function buildRockGeometry(rock: Color): BufferGeometry {
  const geo = new IcosahedronGeometry(1, 1); // non-indexed: flat-shaded facets
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Displacement keyed on the (rounded) position so shared corners move together (no cracks).
    const k =
      Math.round(v.x * 1000) * 73856093 +
      Math.round(v.y * 1000) * 19349663 +
      Math.round(v.z * 1000) * 83492791;
    const h = (((Math.sin(k) * 43758.5453) % 1) + 1) % 1;
    v.multiplyScalar(0.78 + h * 0.4);
    if (v.y < 0) v.y *= 0.5; // flatter base
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  const snow = new Color(0.93, 0.95, 1);
  for (let i = 0; i < pos.count; i += 3) {
    // Per-face colour: snow on top faces, rock with a little variation elsewhere.
    const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
    const vary = 0.8 + ((((i * 2654435761) >>> 0) % 1000) / 1000) * 0.4;
    c.copy(rock)
      .multiplyScalar(vary)
      .lerp(snow, smoothstep(0.5, 0.75, ny));
    for (let j = 0; j < 3; j++) {
      col[(i + j) * 3] = c.r;
      col[(i + j) * 3 + 1] = c.g;
      col[(i + j) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** Soft snow mound: a squashed dome whose rim sinks into the snow. */
function buildMoundGeometry(): BufferGeometry {
  const geo = new SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Rim slightly below zero so it blends into the slope; a touch cooler at the base.
    pos.setY(i, y - 0.08);
    const s = 0.94 + y * 0.06;
    col[i * 3] = s;
    col[i * 3 + 1] = s;
    col[i * 3 + 2] = 1;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _n = new Vector3();

/**
 * Instanced rocks and snow mounds (one draw call each). Instances are static, so frustum culling works on
 * the whole set; the vertex cost is tiny (80 tris per rock, 98 per mound).
 */
export class Props {
  readonly group = new Group();
  private readonly rockMat: MeshStandardMaterial;
  private readonly meshes: InstancedMesh[] = [];

  constructor(
    park: Park,
    snowMaterial: Material,
    opts: { rocks: number; mounds: number; shadows: boolean; rockColor: number },
  ) {
    this.group.name = 'props';
    const placement = placeProps(park, opts.rocks, opts.mounds);
    this.rockMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const rockColor = new Color(opts.rockColor);
    if (placement.rocks.length > 0) {
      const mesh = new InstancedMesh(buildRockGeometry(rockColor), this.rockMat, placement.rocks.length);
      placement.rocks.forEach((r, i) => mesh.setMatrixAt(i, this.compose(r, r.radius, r.height)));
      mesh.castShadow = opts.shadows;
      mesh.receiveShadow = opts.shadows;
      this.add(mesh, 'rocks');
    }
    if (placement.mounds.length > 0) {
      const mesh = new InstancedMesh(buildMoundGeometry(), snowMaterial, placement.mounds.length);
      placement.mounds.forEach((r, i) => mesh.setMatrixAt(i, this.compose(r, r.radius, r.height)));
      mesh.receiveShadow = opts.shadows;
      this.add(mesh, 'mounds');
    }
  }

  private compose(p: PropInstance, radius: number, height: number): Matrix4 {
    // Lean 60% into the slope normal, then yaw about the local up axis.
    _n.set(-p.gx * 0.6, 1, -p.gz * 0.6).normalize();
    _q.setFromUnitVectors(_up, _n);
    _q2.setFromAxisAngle(_up, p.yaw);
    _q.multiply(_q2);
    _p.set(p.x, p.y, p.z);
    _s.set(radius, height, radius * 0.85);
    return _m.compose(_p, _q, _s);
  }

  private add(mesh: InstancedMesh, name: string): void {
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    this.meshes.push(mesh);
    this.group.add(mesh);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.rockMat.dispose();
  }
}
