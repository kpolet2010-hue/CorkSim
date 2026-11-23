import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CurvePath,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  TubeGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Park, RailObstacle } from '../park/Park';
import type { FeatureSample, SurfaceFeature } from '../park/SurfaceFeatures';
import { createLabelTexture } from './textures';

/** Tracks every GPU resource created for the park so it can be disposed together. */
class ResourceBag {
  readonly geometries: BufferGeometry[] = [];
  readonly materials: Material[] = [];
  readonly textures: Texture[] = [];
  geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
  mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
  tex(t: Texture | null): Texture | null {
    if (t) this.textures.push(t);
    return t;
  }
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/**
 * Samples a snow feature's surface into a mesh (same analytic function as the physics). Vertices on the
 * feature edges are pulled slightly below the terrain so there are no visible seams.
 */
function buildFeatureSurface(park: Park, f: SurfaceFeature, res: number): BufferGeometry {
  const uMin = f.uStart;
  const uMax = f.uEnd;
  const wMax = f.halfWidth + f.sideWidth + 0.4;
  // Take the widest extent for landings that widen.
  const nu = Math.max(2, Math.ceil((uMax - uMin) / res));
  const nw = Math.max(2, Math.ceil((2 * wMax) / res));
  const pos = new Float32Array((nu + 1) * (nw + 1) * 3);
  const col = new Float32Array((nu + 1) * (nw + 1) * 3);
  const sample: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };
  const xz = { x: 0, z: 0 };
  for (let j = 0; j <= nu; j++) {
    for (let i = 0; i <= nw; i++) {
      const u = uMin + ((uMax - uMin) * j) / nu;
      const w = -wMax + (2 * wMax * i) / nw;
      f.toWorld(u, w, xz);
      const base = park.terrain.height(xz.x, xz.z);
      const has = f.sample(xz.x, xz.z, sample);
      const off = has ? sample.offset : -0.05;
      const k = (j * (nw + 1) + i) * 3;
      pos[k] = xz.x;
      pos[k + 1] = base + off;
      pos[k + 2] = xz.z;
      // Groomed, slightly brighter snow on features; side walls a touch bluer.
      const shade = has ? 1 : 0.94;
      col[k] = 0.97 * shade;
      col[k + 1] = 0.985 * shade;
      col[k + 2] = 1.0 * shade;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nu; j++) {
    for (let i = 0; i < nw; i++) {
      const a = j * (nw + 1) + i;
      const b = a + 1;
      const c = a + (nw + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical face at the end of a takeoff/ramp (the lip wall). */
function buildLipFace(
  park: Park,
  f: SurfaceFeature,
  u: number,
  topAt: (w: number) => number,
  bottomAt: (w: number) => number,
): BufferGeometry {
  const wMax = f.halfWidth + f.sideWidth;
  const n = 24;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const xz = { x: 0, z: 0 };
  for (let i = 0; i <= n; i++) {
    const w = -wMax + (2 * wMax * i) / n;
    f.toWorld(u, w, xz);
    const base = park.terrain.height(xz.x, xz.z);
    pos.push(xz.x, base + topAt(w), xz.z, xz.x, base + bottomAt(w) - 0.05, xz.z);
    col.push(0.86, 0.9, 0.97, 0.8, 0.85, 0.95);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function orientedBox(
  bag: ResourceBag,
  w: number,
  h: number,
  l: number,
  from: Vector3,
  to: Vector3,
  mat: Material,
): Mesh {
  const dir = new Vector3().subVectors(to, from);
  const len = dir.length();
  const mesh = new Mesh(bag.geo(new BoxGeometry(w, h, l || len)), mat);
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.normalize());
  return mesh;
}

const RAIL_COLORS = [0xff5a1f, 0x1fb6ff, 0xffd21f, 0x9b5cff, 0x22d39b];

export interface ParkMeshesOptions {
  shadows: boolean;
  featureResolution: number;
}

/** Builds all visual geometry for the park's obstacles, decorations and markers. */
export class ParkMeshes {
  readonly group = new Group();
  private readonly bag = new ResourceBag();

  constructor(
    private readonly park: Park,
    snowMaterial: Material,
    opts: ParkMeshesOptions,
  ) {
    this.group.name = 'park';
    const bag = this.bag;
    const featureMat = snowMaterial;
    const dyeMat = bag.mat(new MeshStandardMaterial({ color: 0x1d6bff, roughness: 0.7 }));
    const poleMat = bag.mat(new MeshStandardMaterial({ color: 0xff4a24, roughness: 0.5 }));
    const woodMat = bag.mat(new MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 }));

    // --- Kickers, ramps and rollers --------------------------------------------------------------
    for (const k of park.kickers) {
      const take = new Mesh(
        bag.geo(buildFeatureSurface(park, k.takeoff, opts.featureResolution)),
        featureMat,
      );
      const land = new Mesh(
        bag.geo(buildFeatureSurface(park, k.landing, opts.featureResolution)),
        featureMat,
      );
      take.receiveShadow = land.receiveShadow = opts.shadows;
      take.castShadow = land.castShadow = opts.shadows;
      const lipU = k.takeoff.length - 0.001;
      const s: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };
      const offsetAt = (f: SurfaceFeature, u: number) => (w: number) => {
        const xz = { x: 0, z: 0 };
        f.toWorld(u, w, xz);
        return f.sample(xz.x, xz.z, s) ? s.offset : 0;
      };
      const face = new Mesh(
        bag.geo(
          buildLipFace(park, k.takeoff, lipU, offsetAt(k.takeoff, lipU), offsetAt(k.landing, lipU + 0.02)),
        ),
        featureMat,
      );
      face.castShadow = opts.shadows;
      this.group.add(take, land, face);
      // Blue dye line marking the lip and the knuckle (as park crews do).
      this.addSurfaceLine(k.takeoff, lipU - 0.08, k.config.width * 0.98, dyeMat);
      this.addSurfaceLine(k.landing, k.landing.knuckleStart + 0.8, k.config.width * 1.3, dyeMat);
      // Marker poles at both sides of the lip and a size sign.
      const xz = { x: 0, z: 0 };
      for (const side of [-1, 1]) {
        k.takeoff.toWorld(lipU - 0.5, side * (k.config.width / 2 + 0.9), xz);
        const y = park.surface.height(xz.x, xz.z);
        const pole = new Mesh(bag.geo(new CylinderGeometry(0.03, 0.03, 1.6, 6)), poleMat);
        pole.position.set(xz.x, y + 0.8, xz.z);
        pole.castShadow = opts.shadows;
        this.group.add(pole);
      }
      k.takeoff.toWorld(-3, k.config.width / 2 + 2, xz);
      this.addSign(k.config.label ?? 'JUMP', xz.x, xz.z, k.takeoff.yaw, woodMat);
    }
    for (const r of park.ramps) {
      const mesh = new Mesh(bag.geo(buildFeatureSurface(park, r, opts.featureResolution * 0.7)), featureMat);
      mesh.receiveShadow = mesh.castShadow = opts.shadows;
      const face = new Mesh(
        bag.geo(buildLipFace(park, r, r.length - 0.001, offsetAtFeature(r, r.length - 0.001), () => 0)),
        featureMat,
      );
      this.group.add(mesh, face);
    }
    for (const r of park.rollers) {
      const mesh = new Mesh(bag.geo(buildFeatureSurface(park, r, opts.featureResolution * 1.6)), featureMat);
      mesh.receiveShadow = opts.shadows;
      this.group.add(mesh);
    }

    // --- Rails and boxes -------------------------------------------------------------------------
    park.rails.forEach((rail, i) => this.addRail(rail, RAIL_COLORS[i % RAIL_COLORS.length], opts.shadows));

    // --- Start and finish ------------------------------------------------------------------------
    this.addGate(park.config.spawn.z + 6, 'FREESKI', 0x0b2a4a, opts.shadows);
    this.addGate(park.config.finishZ, 'FINISH', 0xff4a24, opts.shadows);
    this.addFences(opts.shadows);
    this.addLift(opts.shadows);
  }

  private addSurfaceLine(f: SurfaceFeature, u: number, width: number, mat: Material): void {
    const n = 16;
    const pos: number[] = [];
    const idx: number[] = [];
    const xz = { x: 0, z: 0 };
    for (let i = 0; i <= n; i++) {
      const w = -width / 2 + (width * i) / n;
      for (const du of [-0.09, 0.09]) {
        f.toWorld(u + du, w, xz);
        pos.push(xz.x, this.park.surface.height(xz.x, xz.z) + 0.012, xz.z);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geo = this.bag.geo(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, mat);
    (mesh.material as MeshStandardMaterial).side = DoubleSide;
    this.group.add(mesh);
  }

  private addSign(text: string, x: number, z: number, yaw: number, woodMat: Material): void {
    const bag = this.bag;
    const tex = bag.tex(createLabelTexture(text, { bg: '#0b2a4a', fg: '#ffffff', width: 256, height: 256 }));
    const y = this.park.surface.height(x, z);
    const board = new Mesh(
      bag.geo(new PlaneGeometry(1.1, 1.1)),
      bag.mat(
        new MeshStandardMaterial({
          map: tex ?? undefined,
          color: tex ? 0xffffff : 0x0b2a4a,
          roughness: 0.6,
          side: DoubleSide,
        }),
      ),
    );
    board.position.set(x, y + 1.6, z);
    board.rotation.y = yaw + Math.PI;
    const post = new Mesh(bag.geo(new CylinderGeometry(0.05, 0.05, 1.2, 6)), woodMat);
    post.position.set(x, y + 0.6, z);
    this.group.add(board, post);
  }

  private addRail(rail: RailObstacle, color: number, shadows: boolean): void {
    const bag = this.bag;
    const pts = rail.path.points;
    const metal = bag.mat(new MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.28 }));
    const paint = bag.mat(new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }));
    const group = new Group();
    group.name = `rail:${rail.id}`;
    if (rail.kind === 'rail') {
      const path = new CurvePath<Vector3>();
      for (let i = 0; i < pts.length - 1; i++) path.add(new LineCurve3(pts[i].clone(), pts[i + 1].clone()));
      const tube = new Mesh(
        bag.geo(new TubeGeometry(path, Math.max(8, pts.length * 4), 0.035, 10, false)),
        metal,
      );
      tube.position.y = -0.035;
      tube.castShadow = shadows;
      group.add(tube);
      // End caps.
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const cap = new Mesh(bag.geo(new CylinderGeometry(0.036, 0.036, 0.02, 10)), metal);
        cap.position.copy(p).add(new Vector3(0, -0.035, 0));
        group.add(cap);
      }
    } else {
      // Box: plastic top (UHMW) with painted side panels, one segment per path segment.
      const tops: BufferGeometry[] = [];
      const sides: BufferGeometry[] = [];
      const w = rail.halfWidth * 2;
      const q = new Quaternion();
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dir = new Vector3().subVectors(b, a);
        const len = dir.length();
        if (len < 1e-3) continue;
        dir.normalize();
        q.setFromUnitVectors(new Vector3(0, 0, 1), dir);
        const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
        const top = new BoxGeometry(w, 0.04, len + 0.02);
        top.applyQuaternion(q);
        top.translate(mid.x, mid.y - 0.02, mid.z);
        tops.push(top);
        const side = new BoxGeometry(w * 0.96, 0.32, len + 0.02);
        side.applyQuaternion(q);
        side.translate(mid.x, mid.y - 0.2, mid.z);
        sides.push(side);
      }
      const topMesh = new Mesh(
        bag.geo(mergeGeometries(tops)),
        bag.mat(new MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6, metalness: 0 })),
      );
      const sideMesh = new Mesh(bag.geo(mergeGeometries(sides)), paint);
      for (const g of [...tops, ...sides]) g.dispose();
      topMesh.castShadow = sideMesh.castShadow = shadows;
      sideMesh.receiveShadow = shadows;
      group.add(topMesh, sideMesh);
    }
    // Support posts and base plates.
    for (const s of rail.supports) {
      const post = orientedBox(bag, rail.kind === 'box' ? 0.1 : 0.07, 0.07, 0, s.base, s.top, paint);
      post.castShadow = shadows;
      group.add(post);
      const foot = new Mesh(bag.geo(new BoxGeometry(0.5, 0.05, 0.5)), paint);
      foot.position.set(s.base.x, this.park.terrain.height(s.base.x, s.base.z) + 0.01, s.base.z);
      group.add(foot);
    }
    this.group.add(group);
  }

  private addGate(z: number, text: string, color: number, shadows: boolean): void {
    const bag = this.bag;
    const y = this.park.surface.height(0, z);
    const width = 16;
    const mat = bag.mat(new MeshStandardMaterial({ color, roughness: 0.5 }));
    for (const side of [-1, 1]) {
      const pillar = new Mesh(bag.geo(new BoxGeometry(0.5, 5, 0.5)), mat);
      pillar.position.set(side * (width / 2), y + 2.5, z);
      pillar.castShadow = shadows;
      this.group.add(pillar);
    }
    const tex = bag.tex(
      createLabelTexture(text, {
        bg: color === 0xff4a24 ? '#ff4a24' : '#0b2a4a',
        fg: '#ffffff',
        width: 1024,
        height: 128,
      }),
    );
    const banner = new Mesh(
      bag.geo(new BoxGeometry(width + 0.5, 1.2, 0.2)),
      bag.mat(
        new MeshStandardMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : color, roughness: 0.6 }),
      ),
    );
    banner.position.set(0, y + 5, z);
    banner.castShadow = shadows;
    this.group.add(banner);
  }

  private addFences(shadows: boolean): void {
    const bag = this.bag;
    const half = this.park.config.terrain.halfWidth - 1.5;
    const postGeo = bag.geo(new CylinderGeometry(0.04, 0.04, 1.3, 5));
    const postMat = bag.mat(new MeshStandardMaterial({ color: 0x333333, roughness: 0.7 }));
    const posts: BufferGeometry[] = [];
    const netPos: number[] = [];
    const netIdx: number[] = [];
    const len = this.park.config.terrain.length;
    for (const side of [-1, 1]) {
      let prev: number | null = null;
      for (let z = 20; z < len; z += 4) {
        const x = side * half;
        const y = this.park.terrain.height(x, z);
        const p = postGeo.clone();
        p.translate(x, y + 0.65, z);
        posts.push(p);
        const base = netPos.length / 3;
        netPos.push(x, y + 0.15, z, x, y + 1.25, z);
        if (prev !== null) netIdx.push(prev, prev + 1, base, base, prev + 1, base + 1);
        prev = base;
      }
    }
    const postMesh = new Mesh(bag.geo(mergeGeometries(posts)), postMat);
    for (const p of posts) p.dispose();
    postMesh.castShadow = shadows;
    const netGeo = bag.geo(new BufferGeometry());
    netGeo.setAttribute('position', new BufferAttribute(new Float32Array(netPos), 3));
    netGeo.setIndex(netIdx);
    netGeo.computeVertexNormals();
    const net = new Mesh(
      netGeo,
      bag.mat(
        new MeshBasicMaterial({
          color: 0xff6a1f,
          transparent: true,
          opacity: 0.55,
          side: DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    this.group.add(postMesh, net);
  }

  /** Chairlift line running up the side of the park. */
  private addLift(shadows: boolean): void {
    const bag = this.bag;
    const x = -(this.park.config.terrain.halfWidth + 22);
    const towerMat = bag.mat(new MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.45 }));
    const cableMat = bag.mat(new MeshBasicMaterial({ color: 0x222222 }));
    const chairMat = bag.mat(new MeshStandardMaterial({ color: 0x2a3440, roughness: 0.6 }));
    const towers: BufferGeometry[] = [];
    const tops: Vector3[] = [];
    const len = this.park.config.terrain.length;
    for (let z = -40; z <= len + 40; z += 70) {
      const y = this.park.terrain.height(x, z);
      const t = new CylinderGeometry(0.25, 0.35, 11, 8);
      t.translate(x, y + 5.5, z);
      towers.push(t);
      const arm = new BoxGeometry(5, 0.3, 0.3);
      arm.translate(x, y + 11, z);
      towers.push(arm);
      tops.push(new Vector3(x, y + 10.8, z));
    }
    const towerMesh = new Mesh(bag.geo(mergeGeometries(towers)), towerMat);
    for (const t of towers) t.dispose();
    towerMesh.castShadow = shadows;
    this.group.add(towerMesh);
    for (const off of [-2.3, 2.3]) {
      for (let i = 0; i < tops.length - 1; i++) {
        const a = tops[i].clone().add(new Vector3(off, 0, 0));
        const b = tops[i + 1].clone().add(new Vector3(off, 0, 0));
        this.group.add(orientedBox(bag, 0.04, 0.04, 0, a, b, cableMat));
        // A chair hanging every span.
        const c = a.clone().lerp(b, 0.5);
        const chair = new Mesh(bag.geo(new BoxGeometry(1.6, 0.12, 0.6)), chairMat);
        chair.position.set(c.x, c.y - 2.2, c.z);
        const hanger = orientedBox(
          bag,
          0.05,
          0.05,
          0,
          c.clone().add(new Vector3(0, -0.1, 0)),
          c.clone().add(new Vector3(0, -2.2, 0)),
          chairMat,
        );
        this.group.add(chair, hanger);
      }
    }
  }

  dispose(): void {
    this.bag.dispose();
  }
}

function offsetAtFeature(f: SurfaceFeature, u: number): (w: number) => number {
  const s: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };
  const xz = { x: 0, z: 0 };
  return (w: number) => {
    f.toWorld(u, w, xz);
    return f.sample(xz.x, xz.z, s) ? s.offset : 0;
  };
}
