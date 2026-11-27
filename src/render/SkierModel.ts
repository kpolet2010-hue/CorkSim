import {
  Bone,
  DoubleSide,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { buildOutfit, type OutfitBones, type OutfitColors } from './skier/outfit';
import { SkinnedBuilder } from './skier/SkinnedBuilder';
import { createSkiTopSheet } from './skier/skiTexture';

/** Segment lengths of the rig (metres). Physics and IK rely on these - keep them stable. */
export const RIG = {
  thigh: 0.44,
  shin: 0.45,
  upperArm: 0.29,
  forearm: 0.27,
  /** Ankle height above the ski base. */
  ankle: 0.12,
  hipHalfWidth: 0.1,
  /** Lateral offset of the upper-arm (shoulder ball) joint from the spine. */
  shoulderHalfWidth: 0.19,
  skiLength: 1.78,
  poleLength: 1.12,
  /** Lateral distance of each foot from the centre line (matches physics ski spacing). */
  stance: 0.13,
  /** Ski bone offset from the ankle (foot bone), in the foot frame. */
  skiOffsetY: -0.12,
  skiOffsetZ: 0.02,
};

export interface SkierColors {
  jacket: number;
  jacketAccent: number;
  pants: number;
  helmet: number;
  skiTop: number;
  skiAccent: number;
  /** Optional extended palette (defaults below). */
  trim?: number;
  lens?: number;
  gaiter?: number;
  gaiterAccent?: number;
  gloves?: number;
  boots?: number;
  bootCuff?: number;
  goggleFrame?: number;
  /** Pole shaft and its graphic bands. */
  pole?: number;
  poleAccent?: number;
  binding?: number;
}

/**
 * Default outfit (user reference, 2026-11-27): white baggy jacket with a black/grey gradient chevron band,
 * white baggy pants down to the skis, a smooth dark-blue helmet, large light-framed goggles with a blue
 * mirrored lens, white gloves, pale ice-blue twin-tips, white/red poles. No third-party logos.
 */
export const DEFAULT_SKIER_COLORS: SkierColors = {
  jacket: 0xeceef1,
  jacketAccent: 0x1a1d22,
  pants: 0xe8ebee,
  helmet: 0x1b2a5c,
  skiTop: 0xc3d5e2,
  skiAccent: 0x7d98ad,
  trim: 0xd3d8de,
  lens: 0x2a5fd6,
  gaiter: 0x2d3137,
  gaiterAccent: 0x4b5159,
  gloves: 0xf1f2f4,
  // Light boots: whatever shows under the pant hem stays in the white outfit.
  boots: 0xd9dde2,
  bootCuff: 0xe6e9ec,
  goggleFrame: 0xe6e9ec,
  pole: 0xf3f4f6,
  poleAccent: 0xd7262f,
  binding: 0xe4e7ea,
};

export interface SkierModelStats {
  meshes: number;
  bones: number;
  vertices: number;
  triangles: number;
}

/**
 * Procedural, fully rigged freestyle skier. The rig is a hierarchy of `Bone` joints (bones point down -Y
 * in the rest pose) driven every frame by the SkierAnimator with IK. The outfit (baggy jacket and pants,
 * helmet, goggles, gaiter, gloves, boots, bindings, twin-tips, poles) is generated procedurally in the
 * rest pose and smooth-skinned to the joints, merged into one SkinnedMesh per material (5 draw calls).
 * No external assets are required.
 */
export class SkierModel {
  /** Placed at the physics foot point with the physics orientation. */
  readonly root = new Group();
  /** Pose layer under the root (brake yaw, rail press, ground-gap offset). */
  readonly body = new Group();
  readonly pelvis = new Bone();
  readonly spine = new Bone();
  readonly chest = new Bone();
  readonly neck = new Bone();
  readonly head = new Bone();
  /** Clavicles: rotate to shrug / reach. The upper arm hangs off their outer end. */
  readonly shoulders: [Bone, Bone] = [new Bone(), new Bone()];
  readonly upperArms: [Bone, Bone] = [new Bone(), new Bone()];
  readonly forearms: [Bone, Bone] = [new Bone(), new Bone()];
  readonly hands: [Bone, Bone] = [new Bone(), new Bone()];
  readonly poles: [Bone, Bone] = [new Bone(), new Bone()];
  readonly hips: [Bone, Bone] = [new Bone(), new Bone()];
  readonly thighs: [Bone, Bone] = [new Bone(), new Bone()];
  readonly shins: [Bone, Bone] = [new Bone(), new Bone()];
  readonly feet: [Bone, Bone] = [new Bone(), new Bone()];
  readonly skis: [Bone, Bone] = [new Bone(), new Bone()];
  readonly skeleton: Skeleton;
  readonly meshes: SkinnedMesh[] = [];
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: Texture[] = [];

  /**
   * @param castShadow  meshes cast shadows (off on the low preset).
   * @param detail      geometry density, 1 = full; ~0.6 for a cheap low-preset skier.
   */
  constructor(colors: SkierColors = DEFAULT_SKIER_COLORS, castShadow = true, detail = 1) {
    this.root.name = 'skier';
    this.body.name = 'skier-body';
    this.buildRig();

    const bones = this.allBones();
    this.root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(bones);
    const index = (b: Bone) => bones.indexOf(b);
    const pair = (a: [Bone, Bone]): [number, number] => [index(a[0]), index(a[1])];
    const outfitBones: OutfitBones = {
      pelvis: index(this.pelvis),
      spine: index(this.spine),
      chest: index(this.chest),
      neck: index(this.neck),
      head: index(this.head),
      shoulder: pair(this.shoulders),
      upperArm: pair(this.upperArms),
      forearm: pair(this.forearms),
      hand: pair(this.hands),
      pole: pair(this.poles),
      thigh: pair(this.thighs),
      shin: pair(this.shins),
      foot: pair(this.feet),
      ski: pair(this.skis),
    };
    const restPositions = bones.map((b) => b.getWorldPosition(new Vector3()));

    const c = { ...DEFAULT_SKIER_COLORS, ...colors };
    const outfitColors: OutfitColors = {
      jacket: c.jacket,
      jacketAccent: c.jacketAccent,
      trim: c.trim ?? 0xf3ead6,
      pants: c.pants,
      helmet: c.helmet,
      goggleFrame: c.goggleFrame ?? 0x1b1e23,
      lens: c.lens ?? 0xff9a3c,
      gaiter: c.gaiter ?? 0xb4bcc6,
      gaiterAccent: c.gaiterAccent ?? 0x5f6b79,
      gloves: c.gloves ?? 0x23272d,
      boots: c.boots ?? 0x2b3038,
      bootCuff: c.bootCuff ?? 0x3b424d,
      binding: c.binding ?? 0x2a2d32,
      bindingAccent: 0x2a2d32,
      skiTop: c.skiTop,
      skiAccent: c.skiAccent,
      skiInk: 0x1a2130,
      skiBase: 0x16181c,
      skiSide: 0xd9dde2,
      pole: c.pole ?? 0xb9c0c8,
      poleAccent: c.poleAccent ?? c.skiAccent,
      skin: 0xd9a07f,
    };

    const topSheet = createSkiTopSheet({ base: c.skiTop, accent: c.skiAccent, ink: outfitColors.skiInk });
    if (topSheet) this.textures.push(topSheet);
    const builders = {
      fabric: new SkinnedBuilder(),
      hard: new SkinnedBuilder(),
      metal: new SkinnedBuilder(),
      lens: new SkinnedBuilder(),
      skiTop: new SkinnedBuilder(),
    };
    buildOutfit(builders, outfitBones, (b) => restPositions[b], outfitColors, {
      skiLength: RIG.skiLength,
      poleLength: RIG.poleLength,
      texturedTopSheet: topSheet !== null,
      detail: Math.min(1, Math.max(0.4, detail)),
    });

    // Materials tuned for the WP-1 lighting (ACES, exposure ~1.3, sky IBL at 0.3).
    const fabric = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.75,
      sheenColor: 0xffffff,
      side: DoubleSide,
    });
    const hard = new MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.02 });
    const metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 });
    const lens = new MeshStandardMaterial({
      color: outfitColors.lens,
      roughness: 0.08,
      metalness: 0.9,
      emissive: outfitColors.lens,
      // A mirrored lens reflects, it does not glow.
      emissiveIntensity: 0.03,
    });
    const skiTop = new MeshStandardMaterial({
      vertexColors: true,
      map: topSheet,
      roughness: 0.32,
      metalness: 0.02,
    });
    fabric.name = 'skier-fabric';
    hard.name = 'skier-hard';
    metal.name = 'skier-metal';
    lens.name = 'skier-lens';
    skiTop.name = 'skier-ski-top';

    const parts: [SkinnedBuilder, Material, string][] = [
      [builders.fabric, fabric, 'skier-fabric'],
      [builders.hard, hard, 'skier-hard'],
      [builders.metal, metal, 'skier-metal'],
      [builders.lens, lens, 'skier-lens'],
      [builders.skiTop, skiTop, 'skier-skis'],
    ];
    for (const [builder, material, name] of parts) {
      this.materials.push(material);
      if (builder.vertexCount === 0) continue;
      const geometry = builder.build();
      this.geometries.push(geometry);
      const mesh = new SkinnedMesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      // The skier is always near the camera and its pose moves far from the bind pose.
      mesh.frustumCulled = false;
      this.root.add(mesh);
      mesh.bind(this.skeleton);
      this.meshes.push(mesh);
    }
    this.root.updateMatrixWorld(true);
  }

  private buildRig(): void {
    const named = (b: Object3D, name: string) => {
      b.name = name;
      return b;
    };
    this.root.add(this.body);
    this.body.add(named(this.pelvis, 'pelvis'));
    this.pelvis.position.set(0, 0.92, 0);
    this.pelvis.add(named(this.spine, 'spine'));
    this.spine.position.set(0, 0.04, 0);
    this.spine.add(named(this.chest, 'chest'));
    this.chest.position.set(0, 0.24, 0);
    this.chest.add(named(this.neck, 'neck'));
    this.neck.position.set(0, 0.2, 0.01);
    this.neck.add(named(this.head, 'head'));
    this.head.position.set(0, 0.12, 0);

    // Arms (index 0 = left (+X), 1 = right (-X)). Clavicle from near the spine to the shoulder ball.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const tag = i === 0 ? 'L' : 'R';
      const sh = named(this.shoulders[i], `shoulder${tag}`);
      sh.position.set(side * 0.045, 0.13, -0.005);
      this.chest.add(sh);
      sh.add(named(this.upperArms[i], `upperArm${tag}`));
      this.upperArms[i].position.set(side * (RIG.shoulderHalfWidth - 0.045), 0.01, 0.005);
      this.upperArms[i].add(named(this.forearms[i], `forearm${tag}`));
      this.forearms[i].position.y = -RIG.upperArm;
      this.forearms[i].add(named(this.hands[i], `hand${tag}`));
      this.hands[i].position.y = -RIG.forearm;
      // Pole: grip in the fist, shaft pointing down -Y.
      this.hands[i].add(named(this.poles[i], `pole${tag}`));
      this.poles[i].position.set(0, -0.065, 0);
    }

    // Legs.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const tag = i === 0 ? 'L' : 'R';
      const hip = named(this.hips[i], `hip${tag}`);
      hip.position.set(side * RIG.hipHalfWidth, -0.05, 0);
      this.pelvis.add(hip);
      hip.add(named(this.thighs[i], `thigh${tag}`));
      this.thighs[i].add(named(this.shins[i], `shin${tag}`));
      this.shins[i].position.y = -RIG.thigh;
      this.shins[i].add(named(this.feet[i], `foot${tag}`));
      this.feet[i].position.y = -RIG.shin;
      this.feet[i].add(named(this.skis[i], `ski${tag}`));
      this.skis[i].position.set(0, RIG.skiOffsetY, RIG.skiOffsetZ);
    }
  }

  private allBones(): Bone[] {
    return [
      this.pelvis,
      this.spine,
      this.chest,
      this.neck,
      this.head,
      ...this.shoulders,
      ...this.upperArms,
      ...this.forearms,
      ...this.hands,
      ...this.poles,
      ...this.hips,
      ...this.thighs,
      ...this.shins,
      ...this.feet,
      ...this.skis,
    ];
  }

  /** Mesh / skeleton statistics (draw calls = meshes; doubled in the shadow pass when casting). */
  stats(): SkierModelStats {
    let vertices = 0;
    let triangles = 0;
    for (const m of this.meshes) {
      vertices += m.geometry.getAttribute('position').count;
      triangles += (m.geometry.index?.count ?? 0) / 3;
    }
    return { meshes: this.meshes.length, bones: this.skeleton.bones.length, vertices, triangles };
  }

  setCastShadow(cast: boolean): void {
    for (const m of this.meshes) m.castShadow = cast;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.skeleton.dispose();
    for (const m of this.meshes) m.removeFromParent();
    this.meshes.length = 0;
  }
}
