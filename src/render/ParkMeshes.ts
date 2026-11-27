import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CurvePath,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineCurve3,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FENCE_INSET, FENCE_SPACING, FENCE_START, type Park, type RailObstacle } from '../park/Park';
import type { FeatureSample, SurfaceFeature } from '../park/SurfaceFeatures';
import { smoothstep as smoothstepJs } from '../core/math';
import { getParkTheme, type ParkTheme } from './parkTheme';
import { createBoxSideTexture, createLabelTexture, createNetTexture } from './textures';

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

/** Merges parts into one geometry (one draw call) and frees the parts. */
function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

/** Non-indexed copy without UVs so mixed primitives merge cleanly. */
function plain(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute('uv');
  return out;
}

/**
 * Samples a snow feature's surface into a mesh (same analytic function as the physics). Vertices on the
 * feature edges are pulled slightly below the terrain so there are no visible seams.
 *
 * Vertex colours carry the readability shading: the surface curvature (discrete Laplacian of the sampled
 * offset) brightens convex edges (lips, knuckles, sidewall tops) and cools concave ones (transitions, the
 * base of sidewalls), like the ambient occlusion and wind-polish on real park features. Geometry is not
 * changed by this.
 */
function buildFeatureSurface(park: Park, f: SurfaceFeature, res: number): BufferGeometry {
  const uMin = f.uStart;
  const uMax = f.uEnd;
  const wMax = f.halfWidth + f.sideWidth + 0.4;
  const nu = Math.max(2, Math.ceil((uMax - uMin) / res));
  const nw = Math.max(2, Math.ceil((2 * wMax) / res));
  const pos = new Float32Array((nu + 1) * (nw + 1) * 3);
  const col = new Float32Array((nu + 1) * (nw + 1) * 3);
  const sample: FeatureSample = { offset: 0, gradX: 0, gradZ: 0, type: 'snow' };
  const xz = { x: 0, z: 0 };
  const offsetAt = (u: number, w: number): number => {
    f.toWorld(u, w, xz);
    return f.sample(xz.x, xz.z, sample) ? sample.offset : 0;
  };
  const d = 0.45;
  for (let j = 0; j <= nu; j++) {
    for (let i = 0; i <= nw; i++) {
      const u = uMin + ((uMax - uMin) * j) / nu;
      const w = -wMax + (2 * wMax * i) / nw;
      f.toWorld(u, w, xz);
      const base = park.terrain.height(xz.x, xz.z);
      const has = f.sample(xz.x, xz.z, sample);
      const off = has ? sample.offset : -0.05;
      const relSlope = has ? Math.hypot(sample.gradX, sample.gradZ) : 0;
      const k = (j * (nw + 1) + i) * 3;
      pos[k] = xz.x;
      pos[k + 1] = base + off;
      pos[k + 2] = xz.z;
      const o = has ? off : 0;
      const lap =
        (offsetAt(u + d, w) + offsetAt(u - d, w) + offsetAt(u, w + d) + offsetAt(u, w - d) - 4 * o) / (d * d);
      const convex = Math.min(1, Math.max(0, -lap * 1.4));
      const concave = Math.min(1, Math.max(0, lap * 0.9));
      // Steep feature faces (the landing below the knuckle, sidewalls) are tinted cooler than the flat deck,
      // so the drop over the knuckle reads against the snow beyond it.
      const steep = smoothstepJs(0.12, 0.45, relSlope);
      const s = (0.95 + convex * 0.05 - concave * 0.15) * (1 - steep * 0.09);
      // Concave areas go cool-blue (sky-lit cavity), convex edges stay neutral white.
      col[k] = Math.min(1, s - concave * 0.05 - steep * 0.03);
      col[k + 1] = Math.min(1, s * 1.005 - concave * 0.02 - steep * 0.01);
      col[k + 2] = Math.min(1, s * 1.03 + concave * 0.04 + steep * 0.02);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nu; j++) {
    for (let i = 0; i < nw; i++) {
      const a = j * (nw + 1) + i;
      const b = a + 1;
      const c = a + (nw + 1);
      const e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical face at the end of a takeoff/ramp (the lip wall). Shaded darker so the lip silhouette reads. */
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
    col.push(0.8, 0.85, 0.95, 0.66, 0.74, 0.9);
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

const _z = new Vector3(0, 0, 1);

/** Cylinder (or box) between two points, as standalone geometry for merging. */
function segmentGeometry(a: Vector3, b: Vector3, radius: number, radial = 6, box = false): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const g = box
    ? new BoxGeometry(radius * 2, radius * 2, len)
    : new CylinderGeometry(radius, radius, len, radial, 1);
  if (!box) g.rotateX(Math.PI / 2);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(_z, dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

export interface ParkMeshesOptions {
  shadows: boolean;
  featureResolution: number;
}

/** Builds all visual geometry for the park's obstacles, decorations and markers. */
export class ParkMeshes {
  readonly group = new Group();
  private readonly bag = new ResourceBag();
  private readonly theme: ParkTheme;
  private readonly dyeMat: MeshStandardMaterial;
  private readonly metalMat: MeshStandardMaterial;
  private readonly darkMetalMat: MeshStandardMaterial;
  /** All dye strips, merged into one draw call at the end of construction. */
  private readonly dyeParts: BufferGeometry[] = [];

  constructor(
    private readonly park: Park,
    snowMaterial: Material,
    opts: ParkMeshesOptions,
  ) {
    this.group.name = 'park';
    const bag = this.bag;
    this.theme = getParkTheme(park.config.id);
    const featureMat = snowMaterial;
    // Dye is sprayed into the snow: matte, slightly faded (translucent), no z-fighting thanks to polygon offset.
    this.dyeMat = bag.mat(
      new MeshStandardMaterial({
        color: this.theme.dyeColor,
        roughness: 0.9,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.metalMat = bag.mat(
      new MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.24, envMapIntensity: 1.3 }),
    );
    this.darkMetalMat = bag.mat(
      new MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.7, roughness: 0.45 }),
    );
    const poleMat = bag.mat(new MeshStandardMaterial({ color: this.theme.accent, roughness: 0.5 }));
    const poleParts: BufferGeometry[] = [];

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
      const face = new Mesh(
        bag.geo(
          buildLipFace(
            park,
            k.takeoff,
            lipU,
            offsetAtFeature(k.takeoff, lipU),
            offsetAtFeature(k.landing, lipU + 0.02),
          ),
        ),
        featureMat,
      );
      face.castShadow = opts.shadows;
      face.receiveShadow = opts.shadows;
      this.group.add(take, land, face);
      // Dye lines as park crews spray them: a thin line just before the lip and one at the start of the
      // knuckle, so the edge of the table reads from the in-run and from the deck.
      const w = k.config.width;
      this.addCrossLine(k.takeoff, lipU - 0.12, w * 0.96, 0.1);
      this.addCrossLine(k.landing, k.landing.knuckleStart - 0.35, w * 1.1, 0.18);
      // Bamboo-style marker poles at both ends of the knuckle line, so the edge of the table reads from the
      // deck even when the landing below is hidden.
      {
        const kxz = { x: 0, z: 0 };
        for (const side of [-1, 1]) {
          k.landing.toWorld(k.landing.knuckleStart - 0.35, side * (w * 0.62 + 0.5), kxz);
          const ky = park.surface.height(kxz.x, kxz.z);
          const kp = new CylinderGeometry(0.025, 0.03, 1.3, 6);
          kp.translate(kxz.x, ky + 0.6, kxz.z);
          poleParts.push(plain(kp));
        }
      }
      // Marker poles at both sides of the lip and a size sign.
      const xz = { x: 0, z: 0 };
      for (const side of [-1, 1]) {
        k.takeoff.toWorld(lipU - 0.5, side * (w / 2 + 0.9), xz);
        const y = park.surface.height(xz.x, xz.z);
        const pole = new CylinderGeometry(0.03, 0.03, 1.6, 6);
        pole.translate(xz.x, y + 0.75, xz.z);
        poleParts.push(plain(pole));
        const flag = new BoxGeometry(0.01, 0.28, 0.4);
        flag.translate(xz.x, y + 1.38, xz.z + 0.2);
        poleParts.push(plain(flag));
      }
      k.takeoff.toWorld(-3, w / 2 + 2, xz);
      this.addSign(k.config.label ?? 'JUMP', xz.x, xz.z, k.takeoff.yaw, opts.shadows);
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
    if (this.dyeParts.length > 0) {
      const dye = new Mesh(bag.geo(merge(this.dyeParts)), this.dyeMat);
      dye.receiveShadow = opts.shadows;
      this.group.add(dye);
      this.dyeParts.length = 0;
    }
    if (poleParts.length > 0) {
      const poles = new Mesh(bag.geo(merge(poleParts)), poleMat);
      poles.castShadow = opts.shadows;
      this.group.add(poles);
    }

    // --- Rails and boxes -------------------------------------------------------------------------
    const colors = this.theme.railColors;
    park.rails.forEach((rail, i) =>
      this.addRail(rail, colors[i % colors.length], snowMaterial, opts.shadows),
    );

    // --- Start and finish ------------------------------------------------------------------------
    this.addGate(park.config.spawn.z + 6, 'FREESKI', this.theme.accentDark, opts.shadows);
    this.addGate(park.config.finishZ, 'FINISH', this.theme.accent, opts.shadows);
    this.addFences(opts.shadows);
    this.addLift(opts.shadows);
  }

  /** Builds a strip on the snow surface from a list of (u, w) pairs per side. */
  private addStrip(f: SurfaceFeature, pairs: [number, number][], n: number): void {
    const pos: number[] = [];
    const idx: number[] = [];
    const xz = { x: 0, z: 0 };
    for (const [u, w] of pairs) {
      f.toWorld(u, w, xz);
      pos.push(xz.x, this.park.surface.height(xz.x, xz.z) + 0.006, xz.z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.dyeParts.push(geo);
  }

  /** Dye line across a feature at `u`. */
  private addCrossLine(f: SurfaceFeature, u: number, width: number, thickness: number): void {
    const n = 20;
    const pairs: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const w = -width / 2 + (width * i) / n;
      pairs.push([u - thickness / 2, w], [u + thickness / 2, w]);
    }
    this.addStrip(f, pairs, n);
  }

  /** Feature sign: framed board on two posts, facing the in-run. */
  private addSign(text: string, x: number, z: number, yaw: number, shadows: boolean): void {
    const bag = this.bag;
    const accent = '#' + new Color(this.theme.accent).getHexString();
    const tex = bag.tex(
      createLabelTexture(text, { bg: accent, fg: '#ffffff', width: 256, height: 256, border: '#ffffff' }),
    );
    const y = this.park.surface.height(x, z);
    const group = new Group();
    const face = bag.mat(
      new MeshStandardMaterial({
        map: tex ?? undefined,
        color: tex ? 0xffffff : this.theme.accent,
        roughness: 0.55,
      }),
    );
    const back = bag.mat(new MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 }));
    // BoxGeometry material groups: +x, -x, +y, -y, +z (front), -z.
    const board = new Mesh(bag.geo(new BoxGeometry(1.1, 1.1, 0.05)), [back, back, back, back, face, back]);
    board.position.set(0, 1.75, 0);
    board.castShadow = shadows;
    const posts: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const p = new CylinderGeometry(0.035, 0.035, 2.3, 6);
      p.translate(s * 0.48, 1.1, -0.04);
      posts.push(plain(p));
    }
    const postMesh = new Mesh(bag.geo(merge(posts)), this.darkMetalMat);
    postMesh.castShadow = shadows;
    group.add(board, postMesh);
    group.position.set(x, y, z);
    // Board front (+z local) faces up the hill, towards approaching skiers.
    group.rotation.y = yaw + Math.PI;
    this.group.add(group);
  }

  private addRail(rail: RailObstacle, color: number, snowMaterial: Material, shadows: boolean): void {
    const bag = this.bag;
    const pts = rail.path.points;
    const paint = bag.mat(new MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.25 }));
    const group = new Group();
    group.name = `rail:${rail.id}`;
    if (rail.kind === 'rail') {
      // Round pipe whose top is exactly the physical rail line (radius 0.035, centre 0.035 below the path).
      const path = new CurvePath<Vector3>();
      for (let i = 0; i < pts.length - 1; i++) path.add(new LineCurve3(pts[i].clone(), pts[i + 1].clone()));
      const tube = new Mesh(
        bag.geo(new TubeGeometry(path, Math.max(8, pts.length * 6), 0.035, 14, false)),
        this.metalMat,
      );
      tube.position.y = -0.035;
      tube.castShadow = shadows;
      group.add(tube);
      // Rounded end caps.
      const caps: BufferGeometry[] = [];
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const cap = new SphereGeometry(0.036, 12, 8);
        cap.translate(p.x, p.y - 0.035, p.z);
        caps.push(cap);
      }
      group.add(new Mesh(bag.geo(merge(caps)), this.metalMat));
    } else {
      // Box: UHMW top, painted side panels with a stripe/wordmark texture and steel edge coping. The coping
      // sits just below the slide surface and outside it by 1.2 cm, so the physical width is unchanged.
      const tops: BufferGeometry[] = [];
      const sides: BufferGeometry[] = [];
      const trims: BufferGeometry[] = [];
      const w = rail.halfWidth * 2;
      const q = new Quaternion();
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dir = new Vector3().subVectors(b, a);
        const len = dir.length();
        if (len < 1e-3) continue;
        dir.normalize();
        q.setFromUnitVectors(_z, dir);
        const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
        const top = new BoxGeometry(w, 0.04, len + 0.02);
        top.applyQuaternion(q);
        top.translate(mid.x, mid.y - 0.02, mid.z);
        tops.push(top);
        const side = new BoxGeometry(w * 0.96, 0.34, len + 0.02);
        // Side panel texture tiles every ~2 m along the box.
        const uv = side.getAttribute('uv');
        for (let v = 0; v < uv.count; v++) uv.setX(v, uv.getX(v) * Math.max(1, len / 2));
        side.applyQuaternion(q);
        side.translate(mid.x, mid.y - 0.21, mid.z);
        sides.push(side);
        for (const s of [-1, 1]) {
          const trim = new BoxGeometry(0.024, 0.05, len + 0.02);
          trim.translate(s * (w / 2 + 0.012), 0, 0);
          trim.applyQuaternion(q);
          trim.translate(mid.x, mid.y - 0.045, mid.z);
          trims.push(trim);
        }
      }
      const hex = '#' + new Color(color).getHexString();
      const sideTex = bag.tex(createBoxSideTexture(hex, '#16191e', rail.config.label ?? 'FREESKI'));
      const sideMat = sideTex
        ? bag.mat(new MeshStandardMaterial({ map: sideTex, roughness: 0.45, metalness: 0.1 }))
        : paint;
      const topMesh = new Mesh(
        bag.geo(merge(tops)),
        bag.mat(new MeshStandardMaterial({ color: 0x15181c, roughness: 0.38, metalness: 0 })),
      );
      const sideMesh = new Mesh(bag.geo(merge(sides)), sideMat);
      const trimMesh = new Mesh(bag.geo(merge(trims)), this.metalMat);
      topMesh.castShadow = sideMesh.castShadow = shadows;
      sideMesh.receiveShadow = topMesh.receiveShadow = shadows;
      group.add(topMesh, sideMesh, trimMesh);
    }
    // Round support posts, steel base plates and a little snow piled around each foot.
    const posts: BufferGeometry[] = [];
    const plates: BufferGeometry[] = [];
    const piles: BufferGeometry[] = [];
    const postR = rail.kind === 'box' ? 0.06 : 0.045;
    for (const s of rail.supports) {
      posts.push(plain(segmentGeometry(s.base, s.top, postR, 10)));
      const gy = this.park.terrain.height(s.base.x, s.base.z);
      const plate = new BoxGeometry(0.42, 0.04, 0.42);
      plate.translate(s.base.x, gy + 0.01, s.base.z);
      plates.push(plain(plate));
      const pile = new SphereGeometry(0.34, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      pile.scale(1, 0.32, 1);
      pile.translate(s.base.x, gy - 0.02, s.base.z);
      const pc = new Float32Array(pile.getAttribute('position').count * 3).fill(1);
      pile.setAttribute('color', new BufferAttribute(pc, 3));
      piles.push(pile);
    }
    if (posts.length > 0) {
      const postMesh = new Mesh(bag.geo(merge(posts)), paint);
      postMesh.castShadow = shadows;
      const plateMesh = new Mesh(bag.geo(merge(plates)), this.darkMetalMat);
      const pileMesh = new Mesh(bag.geo(merge(piles)), snowMaterial);
      pileMesh.receiveShadow = shadows;
      group.add(postMesh, plateMesh, pileMesh);
    }
    this.group.add(group);
  }

  /** Start/finish gate: round pillars with base sleeves and a printed banner. */
  private addGate(z: number, text: string, color: number, shadows: boolean): void {
    const bag = this.bag;
    const y = this.park.surface.height(0, z);
    const width = 16;
    const mat = bag.mat(new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 }));
    const parts: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const gy = this.park.surface.height(side * (width / 2), z);
      const h = y + 5.5 - gy + 0.2;
      const pillar = new CylinderGeometry(0.28, 0.32, h, 14);
      pillar.translate(side * (width / 2), gy - 0.2 + h / 2, z);
      parts.push(plain(pillar));
      const sleeve = new CylinderGeometry(0.42, 0.46, 0.5, 14);
      sleeve.translate(side * (width / 2), gy + 0.1, z);
      parts.push(plain(sleeve));
    }
    const pillars = new Mesh(bag.geo(merge(parts)), mat);
    pillars.castShadow = shadows;
    this.group.add(pillars);
    const css = '#' + new Color(color).getHexString();
    const tex = bag.tex(
      createLabelTexture(text, { bg: css, fg: '#ffffff', width: 1024, height: 128, border: '#ffffff' }),
    );
    const faceMat = bag.mat(
      new MeshStandardMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : color, roughness: 0.6 }),
    );
    const banner = new Mesh(bag.geo(new BoxGeometry(width + 0.6, 1.2, 0.2)), [
      mat,
      mat,
      mat,
      mat,
      faceMat,
      faceMat,
    ]);
    banner.position.set(0, y + 4.9, z);
    banner.castShadow = shadows;
    this.group.add(banner);
  }

  /** Orange safety nets on posts along both corridor edges, with a top rope. */
  private addFences(shadows: boolean): void {
    const bag = this.bag;
    const half = this.park.config.terrain.halfWidth - FENCE_INSET;
    const posts: BufferGeometry[] = [];
    const netPos: number[] = [];
    const netUv: number[] = [];
    const netIdx: number[] = [];
    const ropes: BufferGeometry[] = [];
    const len = this.park.config.terrain.length;
    const spacing = FENCE_SPACING;
    for (const side of [-1, 1]) {
      let prev: number | null = null;
      let prevTop: Vector3 | null = null;
      let u = 0;
      for (let z = FENCE_START; z < len; z += spacing) {
        const x = side * half;
        const y = this.park.terrain.height(x, z);
        const p = new CylinderGeometry(0.035, 0.04, 1.4, 6);
        p.translate(x, y + 0.65, z);
        posts.push(plain(p));
        const base = netPos.length / 3;
        netPos.push(x, y + 0.08, z, x, y + 1.25, z);
        netUv.push(u, 0, u, 1);
        u += spacing / 1.2;
        if (prev !== null) netIdx.push(prev, prev + 1, base, base, prev + 1, base + 1);
        prev = base;
        const top = new Vector3(x, y + 1.27, z);
        if (prevTop) ropes.push(plain(segmentGeometry(prevTop, top, 0.012, 4)));
        prevTop = top;
      }
    }
    const postMesh = new Mesh(
      bag.geo(merge(posts)),
      bag.mat(new MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6 })),
    );
    postMesh.castShadow = shadows;
    const ropeMesh = new Mesh(
      bag.geo(merge(ropes)),
      bag.mat(new MeshStandardMaterial({ color: this.theme.netColor, roughness: 0.7 })),
    );
    const netGeo = bag.geo(new BufferGeometry());
    netGeo.setAttribute('position', new BufferAttribute(new Float32Array(netPos), 3));
    netGeo.setAttribute('uv', new BufferAttribute(new Float32Array(netUv), 2));
    netGeo.setIndex(netIdx);
    netGeo.computeVertexNormals();
    const netTex = bag.tex(createNetTexture());
    const net = new Mesh(
      netGeo,
      bag.mat(
        new MeshStandardMaterial({
          color: this.theme.netColor,
          map: netTex ?? undefined,
          transparent: true,
          opacity: netTex ? 1 : 0.55,
          side: DoubleSide,
          depthWrite: false,
          roughness: 0.8,
        }),
      ),
    );
    this.group.add(postMesh, ropeMesh, net);
  }

  /**
   * Chairlift running up the side of the park: lattice-style towers with cross arms and sheave trains,
   * sagging haul ropes and four-seat chairs. Everything is merged per material (4 draw calls in total).
   */
  private addLift(shadows: boolean): void {
    const bag = this.bag;
    const x = -(this.park.config.terrain.halfWidth + 22);
    const towerMat = bag.mat(new MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.4 }));
    const ropeMat = bag.mat(new MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.6, roughness: 0.5 }));
    const chairMat = bag.mat(new MeshStandardMaterial({ color: this.theme.accentDark, roughness: 0.55 }));
    const towers: BufferGeometry[] = [];
    const sheaves: BufferGeometry[] = [];
    const ropes: BufferGeometry[] = [];
    const chairs: BufferGeometry[] = [];
    const tops: Vector3[] = [];
    const len = this.park.config.terrain.length;
    for (let z = -40; z <= len + 40; z += 70) {
      const y = this.park.terrain.height(x, z);
      const t = new CylinderGeometry(0.22, 0.38, 11, 10);
      t.translate(x, y + 5.5, z);
      towers.push(plain(t));
      const foot = new CylinderGeometry(0.7, 0.8, 0.5, 10);
      foot.translate(x, y + 0.1, z);
      towers.push(plain(foot));
      const arm = new BoxGeometry(5.4, 0.28, 0.32);
      arm.translate(x, y + 11, z);
      towers.push(plain(arm));
      // Maintenance ladder rail and a small cap.
      const cap = new BoxGeometry(0.6, 0.5, 0.6);
      cap.translate(x, y + 11.35, z);
      towers.push(plain(cap));
      for (const off of [-2.3, 2.3]) {
        const train = new BoxGeometry(0.16, 0.18, 1.6);
        train.translate(x + off, y + 10.78, z);
        sheaves.push(plain(train));
        for (const dz of [-0.55, 0, 0.55]) {
          const wheel = new CylinderGeometry(0.16, 0.16, 0.08, 10);
          wheel.rotateZ(Math.PI / 2);
          wheel.translate(x + off, y + 10.68, z + dz);
          sheaves.push(plain(wheel));
        }
      }
      tops.push(new Vector3(x, y + 10.55, z));
    }
    const sagPoint = (a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 => {
      out.lerpVectors(a, b, t);
      out.y -= 4 * t * (1 - t) * 0.9;
      return out;
    };
    const pa = new Vector3();
    const pb = new Vector3();
    const c = new Vector3();
    for (const off of [-2.3, 2.3]) {
      for (let i = 0; i < tops.length - 1; i++) {
        const a = tops[i].clone();
        a.x += off;
        const b = tops[i + 1].clone();
        b.x += off;
        const segs = 8;
        for (let s = 0; s < segs; s++) {
          sagPoint(a, b, s / segs, pa);
          sagPoint(a, b, (s + 1) / segs, pb);
          ropes.push(plain(segmentGeometry(pa, pb, 0.025, 4)));
        }
        // Two chairs per span per side, offset so the line looks populated.
        for (const t of [0.3, 0.75]) {
          sagPoint(a, b, t + (off > 0 ? 0.1 : 0), c);
          const hang = new Vector3(c.x, c.y - 2.3, c.z);
          chairs.push(plain(segmentGeometry(c, hang, 0.03, 5)));
          const seat = new BoxGeometry(1.9, 0.1, 0.55);
          seat.translate(hang.x, hang.y, hang.z);
          chairs.push(plain(seat));
          const backRest = new BoxGeometry(1.9, 0.6, 0.08);
          backRest.translate(hang.x, hang.y + 0.32, hang.z + (off > 0 ? 0.26 : -0.26));
          chairs.push(plain(backRest));
          const bar = new BoxGeometry(1.9, 0.04, 0.04);
          bar.translate(hang.x, hang.y + 0.55, hang.z + (off > 0 ? -0.3 : 0.3));
          chairs.push(plain(bar));
        }
      }
    }
    const towerMesh = new Mesh(bag.geo(merge(towers)), towerMat);
    towerMesh.castShadow = shadows;
    const sheaveMesh = new Mesh(bag.geo(merge(sheaves)), ropeMat);
    const ropeMesh = new Mesh(bag.geo(merge(ropes)), ropeMat);
    const chairMesh = new Mesh(bag.geo(merge(chairs)), chairMat);
    chairMesh.castShadow = shadows;
    this.group.add(towerMesh, sheaveMesh, ropeMesh, chairMesh);
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
