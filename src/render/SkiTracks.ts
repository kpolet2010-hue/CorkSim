import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  type Texture,
  Vector3,
} from 'three';
import { createTrackTexture } from './textures';

/**
 * Ski tracks pressed into the snow: one ring-buffered ribbon per ski. Segments are appended when the ski has
 * travelled far enough while in contact; a lifted ski starts a new strip (degenerate joins).
 *
 * The ribbon is lit like the snow (normals from the contact), with a cross-profile texture: compressed,
 * slightly smoother and cooler snow with darker side walls and soft edges. Width follows the skid, so carved
 * turns leave pencil lines and skids/brakes leave wide scraped bands.
 */
export class SkiTracks {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly capacity: number;
  private head = [0, 0];
  private readonly last = [new Vector3(), new Vector3()];
  private readonly lastWidth = [0.11, 0.11];
  private readonly hasLast = [false, false];
  private readonly material: MeshStandardMaterial;
  private readonly texture: Texture;

  constructor(segmentsPerSki = 700) {
    this.capacity = segmentsPerSki;
    const quads = segmentsPerSki * 2;
    this.positions = new Float32Array(quads * 4 * 3);
    this.normals = new Float32Array(quads * 4 * 3);
    const uvs = new Float32Array(quads * 4 * 2);
    for (let q = 0; q < quads; q++) {
      // u across the track; v is constant (the texture only varies across).
      uvs.set([0, 0, 1, 0, 0, 1, 1, 1], q * 8);
    }
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const geo = new BufferGeometry();
    const posAttr = new BufferAttribute(this.positions, 3);
    posAttr.setUsage(DynamicDrawUsage);
    const norAttr = new BufferAttribute(this.normals, 3);
    norAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('normal', norAttr);
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setIndex(new BufferAttribute(idx, 1));
    this.texture = createTrackTexture();
    this.material = new MeshStandardMaterial({
      map: this.texture,
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  /**
   * Adds track points for ski `index`. `side` is the ski's lateral axis (unit), `normal` the snow normal at
   * the contact, `width` the imprint width (m).
   */
  add(index: 0 | 1, point: Vector3, side: Vector3, normal: Vector3, inContact: boolean, width = 0.11): void {
    if (!inContact) {
      this.hasLast[index] = false;
      return;
    }
    if (!this.hasLast[index]) {
      this.last[index].copy(point);
      this.lastWidth[index] = width;
      this.hasLast[index] = true;
      return;
    }
    const prev = this.last[index];
    if (prev.distanceToSquared(point) < 0.35 * 0.35) return;
    if (prev.distanceToSquared(point) > 9) {
      prev.copy(point);
      return;
    }
    const q = index * this.capacity + this.head[index];
    this.head[index] = (this.head[index] + 1) % this.capacity;
    const k = q * 12;
    const hw0 = this.lastWidth[index] / 2;
    const hw = width / 2;
    const p = this.positions;
    const lift = 0.012;
    p[k] = prev.x + side.x * hw0;
    p[k + 1] = prev.y + lift;
    p[k + 2] = prev.z + side.z * hw0;
    p[k + 3] = prev.x - side.x * hw0;
    p[k + 4] = prev.y + lift;
    p[k + 5] = prev.z - side.z * hw0;
    p[k + 6] = point.x + side.x * hw;
    p[k + 7] = point.y + lift;
    p[k + 8] = point.z + side.z * hw;
    p[k + 9] = point.x - side.x * hw;
    p[k + 10] = point.y + lift;
    p[k + 11] = point.z - side.z * hw;
    const n = this.normals;
    for (let c = 0; c < 4; c++) {
      n[k + c * 3] = normal.x;
      n[k + c * 3 + 1] = normal.y;
      n[k + c * 3 + 2] = normal.z;
    }
    prev.copy(point);
    this.lastWidth[index] = width;
    const g = this.mesh.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('normal') as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.positions.fill(0);
    this.normals.fill(0);
    this.head = [0, 0];
    this.hasLast[0] = this.hasLast[1] = false;
    const g = this.mesh.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('normal') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
