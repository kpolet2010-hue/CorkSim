import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TreeInstance } from '../park/Park';

function colorize(
  geo: BufferGeometry,
  fn: (y: number, x: number, z: number) => [number, number, number],
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getY(i), pos.getX(i), pos.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

/** Procedural snow-laden pine: trunk + stacked cones; upward-facing parts are dusted with snow. */
function buildPineGeometry(detail: 'near' | 'far'): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const radial = detail === 'near' ? 9 : 5;
  const trunk = new CylinderGeometry(0.12, 0.2, 1.4, 6);
  trunk.translate(0, 0.7, 0);
  parts.push(colorize(trunk, () => [0.28, 0.19, 0.12]));
  const layers = detail === 'near' ? 5 : 3;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = 1.7 - t * 1.25;
    const h = 2.3 - t * 0.9;
    const cone = new ConeGeometry(r, h, radial, 1, false);
    const y = 1.2 + t * 4.2 + h / 2;
    cone.translate(0, y, 0);
    const top = y + h / 2;
    parts.push(
      colorize(cone, (vy) => {
        const snow = Math.max(0, (vy - (top - h * 0.7)) / (h * 0.7));
        const s = Math.min(1, snow * 1.4) * 0.75;
        return [0.09 + s * 0.85, 0.2 + s * 0.74, 0.14 + s * 0.84];
      }),
    );
  }
  const merged = mergeGeometries(
    parts.map((p) => {
      p.deleteAttribute('uv');
      return p;
    }),
  );
  merged.computeVertexNormals();
  return merged;
}

const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3(0, 1, 0);

/**
 * Instanced forest with two levels of detail. Instances are re-bucketed into near/far meshes based on
 * camera distance a few times per second (cheap: only matrix copies).
 */
export class Forest {
  readonly group = new Group();
  private readonly near: InstancedMesh;
  private readonly far: InstancedMesh;
  private readonly matrices: Matrix4[] = [];
  private readonly positions: Vector3[] = [];
  private timer = 0;
  private readonly material: MeshStandardMaterial;

  constructor(
    trees: TreeInstance[],
    castShadows: boolean,
    private readonly lodDistance = 150,
    /** Optional externally authored near-LOD geometry (e.g. from public/models/pine.glb). */
    customNearGeometry: BufferGeometry | null = null,
  ) {
    const custom = customNearGeometry;
    this.material = new MeshStandardMaterial({
      vertexColors: !custom || !!custom.getAttribute('color'),
      color: custom && !custom.getAttribute('color') ? 0x2d4f3a : 0xffffff,
      roughness: 0.92,
      metalness: 0,
    });
    const nearGeo = custom ?? buildPineGeometry('near');
    const farGeo = buildPineGeometry('far');
    this.near = new InstancedMesh(nearGeo, this.material, trees.length);
    this.far = new InstancedMesh(farGeo, this.material, trees.length);
    this.near.instanceMatrix.setUsage(DynamicDrawUsage);
    this.far.instanceMatrix.setUsage(DynamicDrawUsage);
    this.near.castShadow = castShadows;
    this.near.receiveShadow = false;
    this.far.castShadow = false;
    const tint = new Color();
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      _q.setFromAxisAngle(_axis, t.rotation);
      _p.set(t.x, t.y - 0.2, t.z);
      _s.set(
        t.scale * (0.9 + (i % 5) * 0.04),
        t.scale * (1 + (i % 7) * 0.05),
        t.scale * (0.9 + (i % 3) * 0.05),
      );
      this.matrices.push(new Matrix4().compose(_p, _q, _s));
      this.positions.push(new Vector3(t.x, t.y, t.z));
      const v = 0.85 + ((i * 37) % 30) / 100;
      tint.setRGB(v, v * (0.97 + (i % 4) * 0.01), v);
      this.near.setColorAt(i, tint);
      this.far.setColorAt(i, tint);
    }
    this.near.count = 0;
    this.far.count = 0;
    this.group.add(this.near, this.far);
    this.group.name = 'forest';
  }

  update(cameraPosition: Vector3, dt: number, force = false): void {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.35;
    let ni = 0;
    let fi = 0;
    const d2 = this.lodDistance * this.lodDistance;
    for (let i = 0; i < this.matrices.length; i++) {
      const p = this.positions[i];
      const dx = p.x - cameraPosition.x;
      const dz = p.z - cameraPosition.z;
      const m = this.matrices[i];
      if (dx * dx + dz * dz < d2) {
        this.near.setMatrixAt(ni, m);
        ni++;
      } else {
        this.far.setMatrixAt(fi, m);
        fi++;
      }
    }
    this.near.count = ni;
    this.far.count = fi;
    this.near.instanceMatrix.needsUpdate = true;
    this.far.instanceMatrix.needsUpdate = true;
    this.near.computeBoundingSphere();
    this.far.computeBoundingSphere();
  }

  dispose(): void {
    this.near.geometry.dispose();
    this.far.geometry.dispose();
    this.material.dispose();
    this.near.dispose();
    this.far.dispose();
  }
}
