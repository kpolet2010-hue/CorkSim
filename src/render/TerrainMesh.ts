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

/** Backdrop colouring per park (see parkTheme.ts). */
export interface BackdropLook {
  rockColor: number;
  iceColor: number;
  /** 0..1 share of high, moderately steep slopes that read as glacier ice. */
  glacier: number;
}

const _c = new Color();

function shadeVertex(park: Park, x: number, z: number, ny: number, out: Color): Color {
  // Albedo multiplier on top of the snow material colour. The piste stays clean and bright; off-piste snow
  // gets wind-blown macro variation; steep banks shift cool (they mostly face away from the sun and pick up
  // sky light), which keeps the corridor edges and the terrain shape readable.
  const half = park.config.terrain.halfWidth;
  const outside = smoothstep(half - 2, half + 14, Math.abs(x));
  const n = fbm2(x * 0.045, z * 0.045, 91, 3) * 0.5 + 0.5;
  const drift = fbm2(x * 0.012, z * 0.02, 57, 2) * 0.5 + 0.5;
  const steep = smoothstep(0.95, 0.62, ny);
  const r = 1.0 - outside * (0.03 + n * 0.05 + drift * 0.03) - steep * 0.2;
  const g = 1.0 - outside * (0.02 + n * 0.035 + drift * 0.02) - steep * 0.13;
  const b = 1.0 - outside * n * 0.01 - steep * 0.03;
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
export function buildBackdropMountains(
  park: Park,
  material: Material,
  look: BackdropLook = { rockColor: 0x4b4d55, iceColor: 0x8fc2dc, glacier: 0.3 },
): Mesh {
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
  // Rock on steep faces (with strata banding and snow caught on ledges), glacier ice on high steep-ish
  // slopes, a dark forested band at the tree line, snow elsewhere.
  const nor = geo.getAttribute('normal');
  const snowC = new Color(0.96, 0.975, 1);
  const rockC = new Color(look.rockColor);
  const rockDark = rockC.clone().multiplyScalar(0.62);
  const iceC = new Color(look.iceColor);
  const forestC = new Color(0.13, 0.2, 0.16);
  const tmp = new Color();
  for (let v = 0; v < (n + 1) * (n + 1); v++) {
    const ny = nor.getY(v);
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    const breakup = fbm2(x / 60, z / 60, park.config.seed + 21, 3) * 0.12;
    const rock = smoothstep(0.88 + breakup, 0.66 + breakup, ny);
    const strata = 0.5 + 0.5 * Math.sin(y * 0.09 + fbm2(x / 90, z / 90, park.config.seed + 5, 2) * 4);
    tmp.copy(rockC).lerp(rockDark, strata * 0.7);
    // Ledges: snow sticks where the face is only moderately steep.
    const ledge = smoothstep(0.5, 0.7, strata) * smoothstep(0.55, 0.72, ny);
    const glacier = look.glacier * smoothstep(40, 220, y) * smoothstep(0.92, 0.74, ny) * (1 - rock);
    const treeline = smoothstep(-260, -120, y) * (1 - smoothstep(-60, 80, y));
    _c.copy(snowC).lerp(iceC, Math.min(1, glacier * 1.6));
    _c.lerp(tmp, rock * (1 - ledge * 0.6));
    _c.lerp(forestC, treeline * 0.55 * (1 - rock) * (1 - glacier));
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
