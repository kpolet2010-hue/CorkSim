import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';

/** Segment lengths of the rig (metres). */
export const RIG = {
  thigh: 0.44,
  shin: 0.45,
  upperArm: 0.29,
  forearm: 0.27,
  /** Ankle height above the ski base. */
  ankle: 0.12,
  hipHalfWidth: 0.1,
  shoulderHalfWidth: 0.19,
  skiLength: 1.78,
  poleLength: 1.12,
  /** Lateral distance of each foot from the centre line (matches physics ski spacing). */
  stance: 0.13,
};

export interface SkierColors {
  jacket: number;
  jacketAccent: number;
  pants: number;
  helmet: number;
  skiTop: number;
  skiAccent: number;
}

export const DEFAULT_SKIER_COLORS: SkierColors = {
  jacket: 0xff6a2b,
  jacketAccent: 0x13c4c4,
  pants: 0x1d2a3d,
  helmet: 0xf2f2f2,
  skiTop: 0x13c4c4,
  skiAccent: 0xffd34d,
};

/**
 * Twin-tip ski geometry with sidecut and up-turned tip and tail. Built along +Z, base at y = 0.
 * Colours the top sheet with a two-tone graphic via vertex colours.
 */
function buildSkiGeometry(length: number, colors: SkierColors): BufferGeometry {
  const n = 40;
  const thickness = 0.018;
  const top = new Color(colors.skiTop);
  const accent = new Color(colors.skiAccent);
  const base = new Color(0x141414);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const half = length / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 tail .. 1 tip
    const z = -half + t * length;
    const e = Math.abs(t * 2 - 1); // 0 centre .. 1 ends
    const width = 0.1 + 0.025 * e * e - (e > 0.92 ? (e - 0.92) * 0.6 : 0);
    const rise = e > 0.82 ? Math.pow((e - 0.82) / 0.18, 2) * 0.075 : 0;
    const zz = z - Math.sign(z) * rise * 0.25;
    const w = Math.max(0.03, width) / 2;
    // top-left, top-right, bottom-left, bottom-right
    pos.push(w, rise + thickness, zz, -w, rise + thickness, zz, w, rise, zz, -w, rise, zz);
    const stripe = Math.abs(Math.sin(t * Math.PI * 3.0)) > 0.85 || (t > 0.42 && t < 0.58) ? accent : top;
    col.push(
      stripe.r,
      stripe.g,
      stripe.b,
      stripe.r,
      stripe.g,
      stripe.b,
      base.r,
      base.g,
      base.b,
      base.r,
      base.g,
      base.b,
    );
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // top
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    // bottom
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    // left side (+x)
    idx.push(a, b, a + 2, a + 2, b, b + 2);
    // right side (-x)
    idx.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Procedural, fully rigged skier. The rig is a hierarchy of Object3D joints (bones point down -Y in the
 * rest pose) driven every frame by the SkierAnimator using IK. Meshes are simple primitives with
 * PBR materials - no external assets required.
 */
export class SkierModel {
  /** Placed at the physics foot point with the physics orientation. */
  readonly root = new Group();
  /** Lean / brake / press pose layer under the root. */
  readonly body = new Group();
  readonly pelvis = new Object3D();
  readonly spine = new Object3D();
  readonly chest = new Object3D();
  readonly neck = new Object3D();
  readonly head = new Object3D();
  readonly shoulders: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly upperArms: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly forearms: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly hands: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly poles: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly hips: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly thighs: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly shins: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly feet: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  readonly skis: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor(colors: SkierColors = DEFAULT_SKIER_COLORS, castShadow = true) {
    this.root.name = 'skier';
    const mat = (
      color: number,
      roughness = 0.75,
      metalness = 0,
      extra: Partial<MeshStandardMaterial> = {},
    ) => {
      const m = new MeshStandardMaterial({ color, roughness, metalness });
      Object.assign(m, extra);
      this.materials.push(m);
      return m;
    };
    const geo = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const jacket = mat(colors.jacket, 0.8);
    const accent = mat(colors.jacketAccent, 0.7);
    const pants = mat(colors.pants, 0.85);
    const helmet = mat(colors.helmet, 0.35, 0.05);
    const lens = mat(0xffb347, 0.12, 0.9);
    const glove = mat(0x1a1a1a, 0.7);
    const boot = mat(0xe8e8e8, 0.4);
    const bootAccent = mat(0x222831, 0.5);
    const skin = mat(0xe0ac8a, 0.6);
    const metal = mat(0xb9c0c8, 0.3, 0.9);
    const skiMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 });
    this.materials.push(skiMat);

    const add = (parent: Object3D, mesh: Mesh) => {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.set(0, 0.92, 0);

    // Torso.
    this.pelvis.add(this.spine);
    this.spine.position.set(0, 0.04, 0);
    const hipsMesh = add(this.pelvis, new Mesh(geo(new CapsuleGeometry(0.15, 0.1, 4, 10)), pants));
    hipsMesh.rotation.z = Math.PI / 2;
    hipsMesh.scale.set(1, 1, 0.8);
    this.spine.add(this.chest);
    this.chest.position.set(0, 0.24, 0);
    const torso = add(this.spine, new Mesh(geo(new CapsuleGeometry(0.17, 0.3, 4, 12)), jacket));
    torso.position.set(0, 0.2, 0);
    torso.scale.set(1.12, 1, 0.78);
    const stripe = add(this.spine, new Mesh(geo(new CapsuleGeometry(0.172, 0.05, 4, 12)), accent));
    stripe.position.set(0, 0.24, 0);
    stripe.scale.set(1.13, 1, 0.79);
    const pack = add(this.chest, new Mesh(geo(new BoxGeometry(0.26, 0.32, 0.1)), accent));
    pack.position.set(0, -0.02, -0.15);
    const collar = add(this.chest, new Mesh(geo(new CylinderGeometry(0.09, 0.12, 0.1, 10)), jacket));
    collar.position.set(0, 0.17, 0);

    // Head.
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.2, 0.01);
    this.neck.add(this.head);
    this.head.position.set(0, 0.12, 0);
    add(this.head, new Mesh(geo(new SphereGeometry(0.115, 16, 12)), skin)).scale.set(0.95, 1.05, 1);
    const helm = add(
      this.head,
      new Mesh(geo(new SphereGeometry(0.135, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6)), helmet),
    );
    helm.position.set(0, 0.02, -0.005);
    const goggles = add(this.head, new Mesh(geo(new CapsuleGeometry(0.035, 0.13, 4, 8)), lens));
    goggles.rotation.z = Math.PI / 2;
    goggles.position.set(0, 0.03, 0.1);
    goggles.scale.set(1, 1, 0.6);
    const strap = add(this.head, new Mesh(geo(new TorusGeometry(0.128, 0.012, 4, 24)), bootAccent));
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.03;

    // Arms (index 0 = left (+X), 1 = right (-X)).
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const sh = this.shoulders[i];
      sh.position.set(side * RIG.shoulderHalfWidth, 0.14, 0);
      this.chest.add(sh);
      sh.add(this.upperArms[i]);
      const ua = add(
        this.upperArms[i],
        new Mesh(geo(new CapsuleGeometry(0.055, RIG.upperArm - 0.06, 4, 8)), jacket),
      );
      ua.position.y = -RIG.upperArm / 2;
      this.upperArms[i].add(this.forearms[i]);
      this.forearms[i].position.y = -RIG.upperArm;
      const fa = add(
        this.forearms[i],
        new Mesh(geo(new CapsuleGeometry(0.048, RIG.forearm - 0.06, 4, 8)), jacket),
      );
      fa.position.y = -RIG.forearm / 2;
      const cuff = add(this.forearms[i], new Mesh(geo(new CylinderGeometry(0.052, 0.052, 0.04, 8)), accent));
      cuff.position.y = -RIG.forearm + 0.04;
      this.forearms[i].add(this.hands[i]);
      this.hands[i].position.y = -RIG.forearm;
      add(this.hands[i], new Mesh(geo(new BoxGeometry(0.08, 0.1, 0.06)), glove)).position.y = -0.04;
      // Pole: grip at the hand, shaft pointing down -Y.
      this.hands[i].add(this.poles[i]);
      this.poles[i].position.set(0, -0.05, 0);
      const shaft = add(
        this.poles[i],
        new Mesh(geo(new CylinderGeometry(0.009, 0.007, RIG.poleLength, 6)), metal),
      );
      shaft.position.y = -RIG.poleLength / 2;
      const grip = add(this.poles[i], new Mesh(geo(new CylinderGeometry(0.018, 0.016, 0.13, 8)), glove));
      grip.position.y = 0.02;
      const basket = add(this.poles[i], new Mesh(geo(new CylinderGeometry(0.04, 0.04, 0.008, 10)), glove));
      basket.position.y = -RIG.poleLength + 0.08;
    }

    // Legs.
    const skiGeo = geo(buildSkiGeometry(RIG.skiLength, colors));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hip = this.hips[i];
      hip.position.set(side * RIG.hipHalfWidth, -0.05, 0);
      this.pelvis.add(hip);
      hip.add(this.thighs[i]);
      const th = add(
        this.thighs[i],
        new Mesh(geo(new CapsuleGeometry(0.075, RIG.thigh - 0.08, 4, 10)), pants),
      );
      th.position.y = -RIG.thigh / 2;
      this.thighs[i].add(this.shins[i]);
      this.shins[i].position.y = -RIG.thigh;
      const sn = add(this.shins[i], new Mesh(geo(new CapsuleGeometry(0.062, RIG.shin - 0.1, 4, 10)), pants));
      sn.position.y = -RIG.shin / 2 + 0.03;
      this.shins[i].add(this.feet[i]);
      this.feet[i].position.y = -RIG.shin;
      // Boot (shell + cuff) around the ankle.
      const shell = add(this.feet[i], new Mesh(geo(new BoxGeometry(0.11, 0.13, 0.3)), boot));
      shell.position.set(0, -RIG.ankle + 0.07, 0.03);
      const cuffB = add(this.feet[i], new Mesh(geo(new BoxGeometry(0.115, 0.17, 0.15)), boot));
      cuffB.position.set(0, 0.04, -0.01);
      const buckle = add(this.feet[i], new Mesh(geo(new BoxGeometry(0.12, 0.03, 0.16)), bootAccent));
      buckle.position.set(0, 0.06, 0);
      // Binding + ski.
      const binding = add(this.feet[i], new Mesh(geo(new BoxGeometry(0.09, 0.03, 0.4)), bootAccent));
      binding.position.set(0, -RIG.ankle + 0.03, 0.02);
      this.feet[i].add(this.skis[i]);
      this.skis[i].position.set(0, -RIG.ankle, 0.02);
      add(this.skis[i], new Mesh(skiGeo, skiMat));
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
