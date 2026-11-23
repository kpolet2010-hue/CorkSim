import { BufferAttribute, BufferGeometry, Color, Group, Mesh, type Material } from 'three';
import { fbm2 } from '../core/Random';
import { smoothstep } from '../core/math';
import type { Park } from '../park/Park';

export interface TerrainMeshOptions {
  /** Grid spacing of the playable terrain (m). */
  spacing: number;
  chunkSize: number;
  receiveShadow: boolean;
}

const _c = new Color();

function shadeVertex(park: Park, x: number, z: number, ny: number, out: Color): Color {
  // Subtle colour variation: blue-ish in steeper/shaded banks, warm white on groomed snow.
  const half = park.config.terrain.halfWidth;
  const outside = smoothstep(half - 4, half + 12, Math.abs(x));
  const n = fbm2(x * 0.05, z * 0.05, 91, 2) * 0.5 + 0.5;
  const steep = smoothstep(0.92, 0.6, ny);
  const r = 0.97 - outside * 0.04 - n * 0.03 - steep * 0.25;
  const g = 0.98 - outside * 0.02 - n * 0.02 - steep * 0.22;
  const b = 1.0 - steep * 0.12;
  return out.setRGB(r, g, b);
}

/**
 * Builds the playable terrain as a set of chunked grid meshes (for frustum culling) sampled from the same
 * height function the physics uses. Snow features are separate meshes on top.
 */
export function buildTerrainMesh(park: Park, material: Material, opts: TerrainMeshOptions): Group {
  const group = new Group();
  group.name = 'terrain';
  const half = park.config.terrain.halfWidth + 140;
  const zMin = -160;
  const zMax = park.config.terrain.length + 320;
  const cs = opts.chunkSize;
  const step = opts.spacing;
  const t = park.terrain;
  const grad = { x: 0, z: 0 };
  for (let cz = zMin; cz < zMax; cz += cs) {
    for (let cx = -half; cx < half; cx += cs) {
      // Coarser grid far from the corridor.
      const far = Math.min(Math.abs(cx), Math.abs(cx + cs)) > park.config.terrain.halfWidth + 30;
      const s = far ? step * 2.5 : step;
      const n = Math.ceil(cs / s);
      const verts = (n + 1) * (n + 1);
      const pos = new Float32Array(verts * 3);
      const nor = new Float32Array(verts * 3);
      const col = new Float32Array(verts * 3);
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const x = cx + (i / n) * cs;
          const z = cz + (j / n) * cs;
          const k = (j * (n + 1) + i) * 3;
          pos[k] = x;
          pos[k + 1] = t.height(x, z);
          pos[k + 2] = z;
          t.gradient(x, z, grad);
          const len = Math.hypot(grad.x, 1, grad.z);
          nor[k] = -grad.x / len;
          nor[k + 1] = 1 / len;
          nor[k + 2] = -grad.z / len;
          shadeVertex(park, x, z, nor[k + 1], _c);
          col[k] = _c.r;
          col[k + 1] = _c.g;
          col[k + 2] = _c.b;
        }
      }
      const idx = new Uint32Array(n * n * 6);
      let q = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = j * (n + 1) + i;
          const b = a + 1;
          const c = a + (n + 1);
          const d = c + 1;
          idx[q++] = a;
          idx[q++] = c;
          idx[q++] = b;
          idx[q++] = b;
          idx[q++] = c;
          idx[q++] = d;
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(nor, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setIndex(new BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new Mesh(geo, material);
      mesh.receiveShadow = opts.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
  }
  return group;
}

/**
 * Distant mountain range surrounding the park. Low resolution, no shadows; it dips under the playable
 * terrain where they overlap.
 */
export function buildBackdropMountains(park: Park, material: Material): Mesh {
  const size = 5200;
  const n = 150;
  const cz = park.config.terrain.length / 2;
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const col = new Float32Array((n + 1) * (n + 1) * 3);
  const t = park.terrain;
  const nearHalf = park.config.terrain.halfWidth + 130;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -size / 2 + (i / n) * size;
      const z = cz - size / 2 + (j / n) * size;
      const k = (j * (n + 1) + i) * 3;
      const zc = Math.min(Math.max(z, t.zMin), t.zMax);
      const base = t.baseHeight(zc) + (z - zc) * (z < t.zMin ? 0.45 : -0.05);
      const dist =
        Math.max(0, Math.abs(x) - nearHalf) +
        Math.max(0, t.zMin + 40 - z) * 0.6 +
        Math.max(0, z - t.zMax) * 0.3;
      const ridge = 1 - Math.abs(fbm2(x / 520, z / 520, park.config.seed + 3, 4));
      const peaks = Math.pow(ridge, 2.2) * 520 * smoothstep(0, 900, dist);
      const rolling =
        dist * 0.32 + fbm2(x / 200, z / 200, park.config.seed + 9, 3) * 40 * smoothstep(0, 300, dist);
      let y = base + rolling + peaks;
      // Hide under the playable terrain where they overlap.
      if (Math.abs(x) < nearHalf + 20 && z > t.zMin + 20 && z < t.zMax - 20)
        y = Math.min(y, t.height(x, z) - 6);
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // Rock shows on steep faces, snow elsewhere.
  const nor = geo.getAttribute('normal');
  for (let v = 0; v < (n + 1) * (n + 1); v++) {
    const ny = nor.getY(v);
    const rock = smoothstep(0.82, 0.55, ny);
    const y = pos[v * 3 + 1];
    const treeline = smoothstep(-260, -120, y) * (1 - smoothstep(-60, 80, y));
    _c.setRGB(0.95, 0.97, 1).lerp(new Color(0.36, 0.37, 0.41), rock);
    _c.lerp(new Color(0.42, 0.5, 0.52), treeline * 0.25 * (1 - rock));
    col[v * 3] = _c.r;
    col[v * 3 + 1] = _c.g;
    col[v * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mesh = new Mesh(geo, material);
  mesh.name = 'backdrop';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
