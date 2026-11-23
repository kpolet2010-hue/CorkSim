import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicMaterial, Vector3 } from 'three';

/**
 * Ski tracks left in the snow: one ring-buffered ribbon per ski. Segments are appended when the ski has
 * travelled far enough while in contact; a lifted ski starts a new strip (degenerate joins).
 */
export class SkiTracks {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly capacity: number;
  private head = [0, 0];
  private readonly last = [new Vector3(), new Vector3()];
  private readonly hasLast = [false, false];
  private readonly material: MeshBasicMaterial;

  constructor(segmentsPerSki = 700) {
    this.capacity = segmentsPerSki;
    const quads = segmentsPerSki * 2;
    this.positions = new Float32Array(quads * 4 * 3);
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const geo = new BufferGeometry();
    const posAttr = new BufferAttribute(this.positions, 3);
    posAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setIndex(new BufferAttribute(idx, 1));
    this.material = new MeshBasicMaterial({
      color: 0xb9c6dc,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Adds track points for ski `index`. `side` is the ski's lateral axis (unit). */
  add(index: 0 | 1, point: Vector3, side: Vector3, inContact: boolean, width = 0.11): void {
    if (!inContact) {
      this.hasLast[index] = false;
      return;
    }
    if (!this.hasLast[index]) {
      this.last[index].copy(point);
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
    const hw = width / 2;
    const p = this.positions;
    p[k] = prev.x + side.x * hw;
    p[k + 1] = prev.y + 0.015;
    p[k + 2] = prev.z + side.z * hw;
    p[k + 3] = prev.x - side.x * hw;
    p[k + 4] = prev.y + 0.015;
    p[k + 5] = prev.z - side.z * hw;
    p[k + 6] = point.x + side.x * hw;
    p[k + 7] = point.y + 0.015;
    p[k + 8] = point.z + side.z * hw;
    p[k + 9] = point.x - side.x * hw;
    p[k + 10] = point.y + 0.015;
    p[k + 11] = point.z - side.z * hw;
    prev.copy(point);
    const attr = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
  }

  clear(): void {
    this.positions.fill(0);
    this.head = [0, 0];
    this.hasLast[0] = this.hasLast[1] = false;
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
