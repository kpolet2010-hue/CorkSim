import { Color, Vector3 } from 'three';
import { blend, profile, rigid, type GridVertex, type LoftRing, type SkinnedBuilder, type SkinWeights } from './SkinnedBuilder';

/** Colours of the procedural outfit (all sRGB hex). */
export interface OutfitColors {
  jacket: number;
  jacketAccent: number;
  trim: number;
  pants: number;
  helmet: number;
  goggleFrame: number;
  lens: number;
  gaiter: number;
  gaiterAccent: number;
  gloves: number;
  boots: number;
  bootCuff: number;
  binding: number;
  bindingAccent: number;
  skiTop: number;
  skiAccent: number;
  skiInk: number;
  skiBase: number;
  skiSide: number;
  pole: number;
  skin: number;
}

/** Skeleton indices of the joints the outfit is weighted to ([0] = left (+X), [1] = right (-X)). */
export interface OutfitBones {
  pelvis: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  shoulder: [number, number];
  upperArm: [number, number];
  forearm: [number, number];
  hand: [number, number];
  pole: [number, number];
  thigh: [number, number];
  shin: [number, number];
  foot: [number, number];
  ski: [number, number];
}

export interface OutfitBuilders {
  /** Cloth: jacket, pants, gaiter, gloves, goggle strap (rough, double sided). */
  fabric: SkinnedBuilder;
  /** Hard plastics: helmet, goggle frame, boots, bindings, ski base/sides, pole grips. */
  hard: SkinnedBuilder;
  metal: SkinnedBuilder;
  lens: SkinnedBuilder;
  /** Ski top sheets (textured). */
  skiTop: SkinnedBuilder;
}

export interface OutfitDims {
  skiLength: number;
  poleLength: number;
  /** Ski top-sheet: true = white vertex colour (texture provides the colour). */
  texturedTopSheet: boolean;
  /** 1 = full detail, < 1 reduces ring/segment counts (low preset). */
  detail: number;
}

const _c = new Color();
const _c2 = new Color();
const _row: number[] = [];

const smooth01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Bone-local authoring: subsequent vertices are offset by the bone's rest position. */
function inBone(b: SkinnedBuilder, rest: Vector3): void {
  b.transform.makeTranslation(rest.x, rest.y, rest.z);
}

function inRoot(b: SkinnedBuilder): void {
  b.transform.identity();
}

/**
 * Builds every visible part of the skier into the material builders. Geometry is authored in the rest
 * pose (bones point down -Y, identity rotations) using each joint's rest position from `rest(bone)`.
 */
export function buildOutfit(
  B: OutfitBuilders,
  bones: OutfitBones,
  rest: (bone: number) => Vector3,
  col: OutfitColors,
  dims: OutfitDims,
): void {
  const seg = (n: number) => Math.max(6, Math.round(n * dims.detail));
  buildPants(B.fabric, bones, rest, col, seg);
  buildJacket(B.fabric, bones, rest, col, seg);
  buildHead(B, bones, rest, col, seg);
  for (let i = 0; i < 2; i++) {
    buildGlove(B.fabric, bones.hand[i], rest(bones.hand[i]), col, seg);
    buildPole(B, bones.pole[i], rest(bones.pole[i]), col, dims.poleLength, seg);
    buildBoot(B, bones.foot[i], rest(bones.foot[i]), i === 0 ? 1 : -1, col, seg);
    buildBinding(B, bones.ski[i], rest(bones.ski[i]), col);
    buildSki(B, bones.ski[i], rest(bones.ski[i]), col, dims, seg);
  }
  for (const b of [B.fabric, B.hard, B.metal, B.lens, B.skiTop]) inRoot(b);
}

// ---------------------------------------------------------------------------------------------------
// Pants: a seat section on the pelvis plus two baggy legs that blend pelvis -> thigh -> shin and flare
// over the boot cuffs. Folds come from radial ripples; a cargo pocket bulges on each outer thigh.

const LEG_ROWS: readonly (readonly number[])[] = [
  // y, rx, rz, zOff, xOff (outwards)
  // Bagginess lives on the shin and the flare over the boot; the thigh is a rounder, tapered tube so a
  // tucked leg reads as a bent leg (not a slab) from behind.
  [-0.035, 0.114, 0.124, 0.026, 0.004],
  [0.02, 0.109, 0.117, 0.02, 0.004],
  [0.1, 0.1, 0.106, 0.012, 0.004],
  [0.2, 0.09, 0.094, 0.006, 0.004],
  [0.3, 0.084, 0.088, 0.004, 0.003],
  [0.39, 0.081, 0.086, 0.006, 0.002],
  [0.45, 0.082, 0.087, 0.006, 0.002],
  [0.56, 0.086, 0.089, 0.003, 0.002],
  [0.68, 0.09, 0.093, 0.0, 0.002],
  [0.8, 0.094, 0.097, -0.004, 0.0],
  [0.9, 0.092, 0.097, -0.006, -0.004],
  [0.98, 0.085, 0.094, -0.006, -0.008],
];

function buildPants(
  b: SkinnedBuilder,
  bones: OutfitBones,
  rest: (bone: number) => Vector3,
  col: OutfitColors,
  seg: (n: number) => number,
): void {
  inRoot(b);
  const pants = new Color(col.pants);
  const pantsDark = new Color(col.pants).multiplyScalar(0.78);
  const pelvis = rest(bones.pelvis);
  // Seat.
  const SEAT: readonly (readonly number[])[] = [
    [0.75, 0.1, 0.075, -0.01],
    [0.79, 0.165, 0.12, -0.015],
    [0.85, 0.186, 0.134, -0.015],
    [0.93, 0.18, 0.128, -0.012],
    [1.01, 0.168, 0.12, -0.008],
  ];
  const seatRings = seg(10);
  b.loft(
    seatRings,
    seg(24),
    (r, o) => {
      const y = 1.01 - (r / seatRings) * (1.01 - 0.75);
      profile(SEAT, y, _row);
      o.y = y + (pelvis.y - 0.92);
      o.rx = _row[0];
      o.rz = _row[1];
      o.z = _row[2];
      o.color.copy(pants);
      o.w = rigid(bones.pelvis);
    },
    undefined,
    { capEnd: true },
  );

  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const hip = rest(bones.thigh[i]);
    const knee = rest(bones.shin[i]);
    const ankle = rest(bones.foot[i]);
    // Rows are authored for the default rig; remap y onto this rig's joints.
    const mapY = (y: number) =>
      y >= 0.43 ? knee.y + ((y - 0.43) / (0.87 - 0.43)) * (hip.y - knee.y) : ankle.y + ((y + 0.02) / 0.45) * (knee.y - ankle.y);
    const rings = seg(46);
    b.loft(
      rings,
      seg(26),
      (r, o) => {
        const y = 0.98 - (r / rings) * (0.98 + 0.035);
        profile(LEG_ROWS, y, _row);
        o.y = mapY(y);
        o.x = hip.x + sx * _row[3];
        o.z = _row[2];
        o.rx = _row[0];
        o.rz = _row[1];
        o.color.copy(pants);
        o.w = legWeights(bones, i, y);
      },
      (_r, theta, out: GridVertex, ring: LoftRing) => {
        const y = 0.98 - (_r / rings) * (0.98 + 0.035);
        const outer = sx > 0 ? Math.cos(theta) : -Math.cos(theta); // 1 at the outer side
        // Folds: long soft ripples plus stacked folds over the boots and behind the knee.
        let k = 1 + 0.022 * Math.sin(theta * 3 + y * 17 + i * 1.7) * smooth01(0.0, 0.3, y);
        const stack = Math.pow(Math.max(0, Math.sin(y * 58 + theta * 0.6)), 2) * smooth01(0.28, -0.02, y);
        k += 0.05 * stack;
        const knee = Math.exp(-Math.pow((y - 0.44) / 0.06, 2));
        k += 0.035 * knee * Math.max(0, Math.sin(y * 90)) * (Math.sin(theta) < 0 ? 1 : 0.4);
        // Cargo pocket on the outer thigh.
        const pocket = smooth01(0.5, 0.56, y) * smooth01(0.73, 0.67, y) * smooth01(0.55, 0.85, outer);
        k += 0.035 * pocket;
        out.p.x = ring.x + (out.p.x - ring.x) * k;
        out.p.z = ring.z + (out.p.z - ring.z) * k;
        // Seams and pocket flap darker.
        const seam = smooth01(0.985, 1, Math.abs(outer));
        const flap = pocket > 0.2 && y > 0.69 ? 1 : 0;
        out.color.copy(pants).lerp(pantsDark, Math.max(seam * 0.8, flap * 0.9, stack * 0.25));
      },
    );
  }
}

function legWeights(bones: OutfitBones, i: number, y: number): SkinWeights {
  // Short blend zones centred on the joints (hip 0.87, knee 0.43): long zones shear the tube into a
  // flat slab in deep flexion.
  if (y > 0.94) return rigid(bones.pelvis);
  if (y > 0.83) return blend(bones.pelvis, bones.thigh[i], smooth01(0.94, 0.83, y));
  if (y > 0.48) return rigid(bones.thigh[i]);
  if (y > 0.385) return blend(bones.thigh[i], bones.shin[i], smooth01(0.48, 0.385, y));
  // The hem follows the boot so it never rides up when the ankle flexes.
  if (y < 0.14) return blend(bones.shin[i], bones.foot[i], 0.7 * smooth01(0.14, -0.03, y));
  return rigid(bones.shin[i]);
}

// ---------------------------------------------------------------------------------------------------
// Jacket: long baggy shell with a contrasting yoke, hem band, piping, zipper, collar, bunched hood with
// drawcords, and sleeves that bunch at the elbows and cuffs.

const TORSO_ROWS: readonly (readonly number[])[] = [
  // y, rx, rz, zOff
  [0.78, 0.23, 0.18, -0.008],
  [0.84, 0.222, 0.171, -0.006],
  [0.95, 0.2, 0.156, -0.006],
  [1.06, 0.191, 0.151, 0.0],
  [1.16, 0.195, 0.149, 0.006],
  [1.25, 0.199, 0.146, 0.002],
  [1.31, 0.19, 0.136, -0.005],
  [1.355, 0.158, 0.12, -0.01],
  [1.39, 0.115, 0.1, -0.006],
  [1.415, 0.09, 0.088, 0.0],
];

const SLEEVE_ROWS: readonly (readonly number[])[] = [
  // y (rest, absolute), rx, rz
  [0.755, 0.056, 0.057],
  [0.79, 0.063, 0.064],
  [0.83, 0.068, 0.068],
  [0.9, 0.064, 0.065],
  [0.98, 0.066, 0.067],
  [1.05, 0.07, 0.07],
  [1.12, 0.073, 0.073],
  [1.22, 0.077, 0.077],
  [1.31, 0.081, 0.08],
  [1.35, 0.074, 0.075],
  [1.39, 0.048, 0.05],
];

function torsoWeights(bones: OutfitBones, y: number, x: number): SkinWeights {
  if (y < 0.98) return blend(bones.pelvis, bones.spine, 0.1 + 0.9 * smooth01(0.86, 0.98, y));
  if (y < 1.1) return rigid(bones.spine);
  if (y < 1.22) return blend(bones.spine, bones.chest, smooth01(1.1, 1.22, y));
  if (y > 1.27 && Math.abs(x) > 0.13) {
    const side = x > 0 ? 0 : 1;
    return blend(bones.chest, bones.shoulder[side], 0.55 * smooth01(0.13, 0.19, Math.abs(x)) * smooth01(1.27, 1.33, y));
  }
  return rigid(bones.chest);
}

function buildJacket(
  b: SkinnedBuilder,
  bones: OutfitBones,
  rest: (bone: number) => Vector3,
  col: OutfitColors,
  seg: (n: number) => number,
): void {
  inRoot(b);
  const jacket = new Color(col.jacket);
  const accent = new Color(col.jacketAccent);
  const trim = new Color(col.trim);
  const shade = new Color(col.jacket).multiplyScalar(0.82);
  const dy = rest(bones.chest).y - 1.2;
  const top = 1.415;
  const bottom = 0.78;
  const rings = seg(40);
  b.loft(
    rings,
    seg(28),
    (r, o) => {
      const y = top - (r / rings) * (top - bottom);
      profile(TORSO_ROWS, y, _row);
      o.y = y + dy;
      o.rx = _row[0];
      o.rz = _row[1];
      o.z = _row[2];
    },
    (r, theta, out, ring) => {
      const y = top - (r / rings) * (top - bottom);
      const front = Math.sin(theta);
      // Soft drape folds, stronger towards the hem.
      const k =
        1 +
        0.016 * Math.sin(theta * 5 + y * 13) * (0.4 + smooth01(1.1, 0.8, y)) +
        0.012 * Math.sin(theta * 9 - y * 7) * smooth01(1.0, 0.8, y);
      out.p.x = ring.x + (out.p.x - ring.x) * k;
      out.p.z = ring.z + (out.p.z - ring.z) * k;
      out.w = torsoWeights(bones, y, out.p.x);
      // Colour blocking: yoke over the shoulders, hem band, piping lines, darker side panels.
      const yokeLine = 1.235 + 0.035 * Math.abs(Math.cos(theta));
      let c = jacket;
      if (y > yokeLine) c = accent;
      else if (y < 0.825) c = accent;
      else if (Math.abs(Math.cos(theta)) > 0.93) c = shade;
      out.color.copy(c);
      if (Math.abs(y - yokeLine) < 0.009 || Math.abs(y - 0.825) < 0.008) out.color.copy(trim);
      // Kangaroo-pocket seam lines on the front.
      if (front > 0.55 && y > 0.86 && y < 1.0 && Math.abs(Math.abs(Math.cos(theta)) - 0.42) < 0.05)
        out.color.copy(shade);
    },
  );

  // Zipper down the front.
  const zip: Vector3[] = [];
  for (let k = 0; k <= 16; k++) {
    const y = 0.79 + (k / 16) * (1.47 - 0.79);
    profile(TORSO_ROWS, Math.min(y, 1.41), _row);
    const z = y > 1.37 ? 0.107 : _row[2] + _row[1] * 1.035;
    zip.push(new Vector3(0, y + dy, z + 0.002));
  }
  b.tube(zip, 0.005, _c.set(col.jacketAccent).multiplyScalar(0.55), (k) => torsoWeights(bones, zip[k].y - dy, 0), 5);

  // Collar.
  b.loft(
    seg(4),
    seg(20),
    (r, o) => {
      const t = r / seg(4);
      const y = 1.475 - t * 0.11;
      o.y = y + dy;
      o.z = 0.004;
      o.rx = 0.097 + t * 0.008;
      o.rz = 0.1 + t * 0.006;
      o.color.copy(accent);
      if (r === 0) o.color.copy(trim);
      o.w = blend(bones.chest, bones.neck, 0.6 * (1 - t));
    },
  );

  // Bunched hood on the back with a rolled rim.
  const hoodC = new Vector3(0, 1.372 + dy, -0.108);
  b.ellipsoid(hoodC, 0.112, 0.058, 0.055, accent, blend(bones.chest, bones.neck, 0.15), seg(8), seg(16), (phi, theta, out) => {
    // Flatten the side touching the back and add a dent where the hood folds.
    if (out.p.z > hoodC.z) out.p.z = hoodC.z + (out.p.z - hoodC.z) * 0.45;
    out.p.y += 0.012 * Math.cos(theta * 2) * Math.sin(phi);
    out.p.x *= 1 + 0.06 * Math.sin(phi * 3);
  });
  const rim: Vector3[] = [];
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI;
    rim.push(new Vector3(Math.cos(a) * 0.1, 1.41 + dy + Math.sin(a) * 0.016, -0.08 - Math.sin(a) * 0.065));
  }
  b.tube(rim, 0.011, jacket, blend(bones.chest, bones.neck, 0.2), 6);
  // Drawcords.
  for (const sx of [1, -1]) {
    b.tube(
      [new Vector3(sx * 0.032, 1.43 + dy, 0.104), new Vector3(sx * 0.036, 1.39 + dy, 0.116), new Vector3(sx * 0.034, 1.35 + dy, 0.124)],
      0.0035,
      trim,
      rigid(bones.chest),
      5,
    );
  }

  // Sleeves.
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const ua = rest(bones.upperArm[i]);
    const dyA = ua.y - 1.34;
    const top2 = 1.39;
    const bot2 = 0.755;
    const rings2 = seg(30);
    b.loft(
      rings2,
      seg(16),
      (r, o) => {
        const y = top2 - (r / rings2) * (top2 - bot2);
        profile(SLEEVE_ROWS, y, _row);
        o.y = y + dyA;
        o.x = ua.x + sx * (0.008 - 0.035 * smooth01(1.3, 1.39, y));
        o.rx = _row[0];
        o.rz = _row[1];
        o.w = sleeveWeights(bones, i, y);
      },
      (r, theta, out, ring) => {
        const y = top2 - (r / rings2) * (top2 - bot2);
        const elbow = Math.exp(-Math.pow((y - 1.04) / 0.07, 2));
        const cuff = Math.exp(-Math.pow((y - 0.84) / 0.05, 2));
        const k = 1 + (0.05 * elbow + 0.045 * cuff) * Math.max(0, Math.sin(y * 85 + theta * 0.8)) + 0.012 * Math.sin(theta * 3 + y * 11);
        out.p.x = ring.x + (out.p.x - ring.x) * k;
        out.p.z = ring.z + (out.p.z - ring.z) * k;
        let c = y > 1.27 ? accent : jacket;
        if (y < 0.8) c = accent;
        out.color.copy(c);
        if (Math.abs(y - 0.8) < 0.008) out.color.copy(trim);
        // Stripe down the outside of the sleeve.
        const outer = sx > 0 ? Math.cos(theta) : -Math.cos(theta);
        if (outer > 0.965 && y > 0.8 && y < 1.27) out.color.copy(trim);
      },
    );
  }
}

function sleeveWeights(bones: OutfitBones, i: number, y: number): SkinWeights {
  if (y > 1.38) return blend(bones.shoulder[i], bones.upperArm[i], 0.3);
  if (y > 1.28) return blend(bones.shoulder[i], bones.upperArm[i], 0.3 + 0.7 * smooth01(1.38, 1.28, y));
  if (y > 1.12) return rigid(bones.upperArm[i]);
  if (y > 0.98) return blend(bones.upperArm[i], bones.forearm[i], smooth01(1.12, 0.98, y));
  return rigid(bones.forearm[i]);
}

// ---------------------------------------------------------------------------------------------------
// Head: face under a neck gaiter, a vented helmet with brim and ear pads, large goggles with a mirrored
// lens and a patterned strap.

function buildHead(
  B: OutfitBuilders,
  bones: OutfitBones,
  rest: (bone: number) => Vector3,
  col: OutfitColors,
  seg: (n: number) => number,
): void {
  const head = rest(bones.head);
  const neck = rest(bones.neck);
  const f = B.fabric;
  const h = B.hard;

  // Neck gaiter (root space, neck -> head blend).
  inRoot(f);
  const gaiter = new Color(col.gaiter);
  const gaiterAcc = new Color(col.gaiterAccent);
  const g0 = neck.y - 0.035;
  const g1 = head.y - 0.015;
  const gr = seg(8);
  f.loft(
    gr,
    seg(20),
    (r, o) => {
      const t = r / gr; // 0 top .. 1 bottom
      const y = g1 - t * (g1 - g0);
      o.y = y;
      o.z = 0.028 - t * 0.026;
      o.rx = 0.095 - t * 0.026 + (r === 0 ? 0.003 : 0);
      o.rz = 0.105 - t * 0.034 + (r === 0 ? 0.003 : 0);
      o.w = y > neck.y + 0.03 ? blend(bones.neck, bones.head, smooth01(neck.y + 0.03, head.y - 0.03, y)) : rigid(bones.neck);
    },
    (r, theta, out) => {
      const band = r % 3 === 1 || (Math.sin(theta * 6) > 0.8 && r % 3 === 2);
      out.color.copy(band ? gaiterAcc : gaiter);
    },
  );

  // Face (only the cheeks / nose bridge show between gaiter and goggles).
  inBone(f, head);
  f.ellipsoid(new Vector3(0, -0.005, 0.008), 0.088, 0.112, 0.1, _c.set(col.skin), rigid(bones.head), seg(10), seg(14));
  f.ellipsoid(new Vector3(0, -0.012, 0.1), 0.014, 0.022, 0.016, _c.set(col.skin), rigid(bones.head), 5, 8);

  // Helmet shell.
  inBone(h, head);
  const helmet = new Color(col.helmet);
  const cx = 0;
  const cy = 0.02;
  const cz = -0.006;
  const rx = 0.125;
  const ry = 0.13;
  const rz = 0.143;
  const rows = seg(12);
  const cols = seg(30);
  const phiMax = (theta: number) => {
    const fr = Math.max(0, Math.sin(theta));
    const bk = Math.max(0, -Math.sin(theta));
    return 2.02 + (1.2 - 2.02) * Math.pow(fr, 1.4) + (2.33 - 2.02) * bk;
  };
  const edge: Vector3[] = [];
  h.grid(
    rows,
    cols,
    (r, c, out) => {
      const theta = (c / cols) * Math.PI * 2;
      const phi = (r / rows) * phiMax(theta);
      let x = Math.sin(phi) * Math.cos(theta) * rx;
      const y = Math.cos(phi) * ry;
      let z = Math.sin(phi) * Math.sin(theta) * rz;
      // Central ridge and slightly squarer sides.
      const ridge = 1 + 0.035 * Math.exp(-Math.pow(x / 0.035, 2)) * Math.max(0, Math.cos(phi));
      x *= ridge;
      z *= ridge;
      out.p.set(cx + x, cy + y * ridge, cz + z);
      out.color.copy(helmet);
      out.w = rigid(bones.head);
      if (r === rows && c < cols) edge.push(out.p.clone());
    },
    { wrap: true, flip: true },
  );
  edge.push(edge[0].clone());
  h.tube(edge, 0.0065, _c.set(col.goggleFrame), rigid(bones.head), 5);
  // Vents (dark slots along the top).
  const ventC = _c2.set(col.goggleFrame);
  for (const [vx, vz] of [
    [0.034, 0.045],
    [-0.034, 0.045],
    [0.036, -0.045],
    [-0.036, -0.045],
    [0, -0.095],
  ]) {
    const vy = cy + ry * Math.sqrt(Math.max(0, 1 - (vx / rx) ** 2 - ((vz - cz) / rz) ** 2)) * 1.0;
    h.roundedBox(new Vector3(vx, vy - 0.002, vz), 0.008, 0.005, 0.03, ventC, rigid(bones.head), 4);
  }
  // Brim over the goggles.
  const brimRows = 1;
  const brimCols = seg(12);
  for (const side of [0, 1]) {
    h.grid(
      brimRows,
      brimCols,
      (r, c, out) => {
        const a = Math.PI / 2 + ((c / brimCols) * 2 - 1) * 0.75;
        const reach = r === 0 ? 0.0 : 0.024;
        const y = 0.071 - r * 0.012 - side * 0.006;
        out.p.set(Math.cos(a) * (rx + 0.004 + reach), y, cz + Math.sin(a) * (rz + 0.004 + reach));
        out.color.copy(helmet);
        out.w = rigid(bones.head);
      },
      { flip: side === 0 },
    );
  }
  // Ear pads.
  for (const sx of [1, -1]) {
    h.roundedBox(new Vector3(sx * 0.123, -0.035, -0.004), 0.016, 0.042, 0.046, _c.set(col.goggleFrame), rigid(bones.head), 3);
  }

  // Goggles: frame (swept rectangle) + mirrored lens + strap.
  const arcCols = seg(22);
  const a0 = 1.22;
  const gy0 = -0.02;
  const gy1 = 0.064;
  const R = (a: number, outer: number) => 0.114 + outer * 0.017 + 0.004 * Math.cos(a);
  h.grid(
    arcCols,
    4,
    (r, c, out) => {
      const a = -a0 + (r / arcCols) * 2 * a0;
      const outer = c === 1 || c === 2 ? 1 : 0;
      const y = c === 2 || c === 3 ? gy1 : gy0;
      const rad = R(a, outer);
      out.p.set(Math.sin(a) * rad, y - 0.006 * (1 - Math.cos(a)), Math.cos(a) * rad);
      out.color.copy(_c.set(col.goggleFrame));
      out.w = rigid(bones.head);
    },
    { wrap: true },
  );
  inBone(B.lens, head);
  const lensRows = 6;
  B.lens.grid(
    lensRows,
    seg(22),
    (r, c, out) => {
      const a = -1.08 + (c / seg(22)) * 2 * 1.08;
      const t = r / lensRows;
      const y = gy1 - 0.009 - t * (gy1 - gy0 - 0.018);
      const bulge = 1 - Math.pow((t - 0.5) * 2, 2);
      const rad = R(a, 1) + 0.004 + 0.006 * bulge * Math.cos(a * 0.9);
      out.p.set(Math.sin(a) * rad, y - 0.006 * (1 - Math.cos(a)), Math.cos(a) * rad);
      out.color.set(1, 1, 1);
      out.w = rigid(bones.head);
    },
    {},
  );
  // Strap around the back of the helmet.
  inBone(f, head);
  const strapCols = seg(20);
  const strapA = new Color(col.gaiterAccent);
  const strapB = new Color(col.goggleFrame);
  f.grid(
    1,
    strapCols,
    (r, c, out) => {
      const a = a0 - 0.05 + (c / strapCols) * (Math.PI * 2 - 2 * (a0 - 0.05));
      const y = r === 0 ? gy1 - 0.012 : gy0 + 0.01;
      out.p.set(Math.sin(a) * (rx + 0.006), y, cz + Math.cos(a) * (rz + 0.006));
      out.color.copy(Math.sin(c * 1.3) > 0 ? strapA : strapB);
      out.w = rigid(bones.head);
    },
    { flip: true },
  );
}

// ---------------------------------------------------------------------------------------------------
// Gloves: gauntlet cuff, mitt with knuckle shape and a thumb (hand-local; the fist holds the pole grip).

function buildGlove(b: SkinnedBuilder, bone: number, rest: Vector3, col: OutfitColors, seg: (n: number) => number): void {
  inBone(b, rest);
  const glove = new Color(col.gloves);
  const cuff = new Color(col.jacketAccent);
  const rings = seg(5);
  b.loft(rings, seg(14), (r, o) => {
    const t = r / rings;
    o.y = 0.035 - t * 0.065;
    o.rx = 0.05 - t * 0.008;
    o.rz = 0.052 - t * 0.006;
    o.color.copy(r <= 1 ? cuff : glove);
    o.w = rigid(bone);
  });
  b.ellipsoid(new Vector3(0, -0.068, 0.006), 0.035, 0.056, 0.047, glove, rigid(bone), seg(8), seg(12), (phi, _t, out) => {
    // Flatter palm side, squarer knuckles.
    out.p.y -= 0.006 * Math.pow(Math.sin(phi), 4);
  });
  b.ellipsoid(new Vector3(0, -0.048, 0.044), 0.018, 0.03, 0.017, glove, rigid(bone), 5, 8);
  b.tube([new Vector3(0, -0.035, 0.05), new Vector3(0, -0.08, 0.052)], 0.003, _c.set(col.trim), rigid(bone), 4);
}

// ---------------------------------------------------------------------------------------------------
// Poles: grip with a coloured ring, tapered aluminium shaft, basket and carbide tip (pole-local, -Y down).

function buildPole(
  B: OutfitBuilders,
  bone: number,
  rest: Vector3,
  col: OutfitColors,
  length: number,
  seg: (n: number) => number,
): void {
  const GRIP: readonly (readonly number[])[] = [
    [-0.105, 0.0135],
    [-0.09, 0.0185],
    [-0.02, 0.0175],
    [0.04, 0.019],
    [0.06, 0.0225],
    [0.078, 0.017],
  ];
  inBone(B.hard, rest);
  const gripC = new Color(col.goggleFrame);
  const ringC = new Color(col.skiAccent);
  const gr = 8;
  B.hard.loft(
    gr,
    seg(10),
    (r, o) => {
      const y = 0.078 - (r / gr) * (0.078 + 0.105);
      profile(GRIP, y, _row);
      o.y = y;
      o.rx = _row[0];
      o.rz = _row[0];
      o.color.copy(y > 0.045 && y < 0.065 ? ringC : gripC);
      o.w = rigid(bone);
    },
    undefined,
    { capStart: true },
  );
  B.hard.ellipsoid(new Vector3(0, -length + 0.085, 0), 0.036, 0.007, 0.036, _c.set(col.skiAccent), rigid(bone), 4, seg(12));
  inBone(B.metal, rest);
  B.metal.loft(3, seg(8), (r, o) => {
    const t = r / 3;
    o.y = -0.09 - t * (length - 0.09 - 0.03);
    o.rx = 0.0095 - t * 0.0025;
    o.rz = o.rx;
    o.color.set(col.pole);
    o.w = rigid(bone);
  });
  B.metal.loft(
    1,
    6,
    (r, o) => {
      o.y = -length + 0.03 - r * 0.03;
      o.rx = r === 0 ? 0.0075 : 0.0015;
      o.rz = o.rx;
      o.color.set(0x9aa3ad);
      o.w = rigid(bone);
    },
    undefined,
    { capEnd: true },
  );
}

// ---------------------------------------------------------------------------------------------------
// Boots: two-piece shell (lower shell + cuff) with sole, toe/heel welts, buckles and a power strap.

const BOOT_ROWS: readonly (readonly number[])[] = [
  // y, zFront, zBack, halfWidth, superellipse n
  [-0.096, 0.176, -0.126, 0.049, 4],
  [-0.088, 0.185, -0.133, 0.054, 4],
  [-0.07, 0.189, -0.136, 0.056, 4],
  [-0.045, 0.178, -0.136, 0.057, 3.4],
  [-0.02, 0.142, -0.132, 0.057, 3],
  [0.005, 0.097, -0.125, 0.056, 3],
  [0.04, 0.086, -0.112, 0.056, 3],
  [0.09, 0.09, -0.098, 0.057, 3],
  [0.14, 0.1, -0.086, 0.058, 3],
  [0.158, 0.098, -0.082, 0.055, 3],
];

function buildBoot(B: OutfitBuilders, bone: number, rest: Vector3, sx: number, col: OutfitColors, seg: (n: number) => number): void {
  const h = B.hard;
  inBone(h, rest);
  const shell = new Color(col.boots);
  const cuff = new Color(col.bootCuff);
  const sole = new Color(0x15171a);
  const strap = new Color(0x1b1e22);
  const rings = seg(18);
  const top = 0.158;
  const bot = -0.096;
  h.loft(
    rings,
    seg(24),
    (r, o) => {
      const y = top - (r / rings) * (top - bot);
      profile(BOOT_ROWS, y, _row);
      o.y = y;
      o.z = (_row[0] + _row[1]) / 2;
      o.rz = (_row[0] - _row[1]) / 2;
      o.rx = _row[2];
      o.n = _row[3];
      let c = y > 0.012 ? cuff : shell;
      if (y < -0.084) c = sole;
      if (y > 0.125 && y < 0.152) c = strap;
      o.color.copy(c);
      o.w = rigid(bone);
    },
    (_r, theta, out) => {
      // Raised spine at the back of the cuff and a shell overlap line on the front.
      if (out.p.y > 0.0 && Math.sin(theta) < -0.9) out.p.z -= 0.006;
      if (out.p.y > -0.02 && out.p.y < 0.012 && Math.sin(theta) > 0.3) out.color.multiplyScalar(0.75);
    },
    { capStart: true, capEnd: true },
  );
  // Toe and heel welts (DIN lugs held by the binding).
  h.roundedBox(new Vector3(0, -0.082, 0.193), 0.034, 0.012, 0.014, sole, rigid(bone), 4);
  h.roundedBox(new Vector3(0, -0.08, -0.14), 0.036, 0.013, 0.012, sole, rigid(bone), 4);
  // Buckles on the outer side.
  inBone(B.metal, rest);
  for (const [y, z] of [
    [-0.012, 0.075],
    [0.045, 0.07],
    [0.1, 0.075],
  ]) {
    B.metal.roundedBox(new Vector3(sx * 0.042, y, z), 0.016, 0.006, 0.02, _c.set(0xc9ced4), rigid(bone), 4);
  }
}

// ---------------------------------------------------------------------------------------------------
// Bindings (ski-local; ski top sheet at y = 0.018): plate, toe piece, heel piece with lever, brake arms.

function buildBinding(B: OutfitBuilders, bone: number, rest: Vector3, col: OutfitColors): void {
  const h = B.hard;
  inBone(h, rest);
  const body = new Color(col.binding);
  const acc = new Color(col.bindingAccent);
  const w = rigid(bone);
  h.roundedBox(new Vector3(0, 0.0215, 0.0), 0.034, 0.0045, 0.2, body, w, 4);
  h.roundedBox(new Vector3(0, 0.04, 0.212), 0.036, 0.021, 0.038, body, w, 4);
  h.roundedBox(new Vector3(0, 0.061, 0.2), 0.029, 0.01, 0.028, acc, w, 3);
  h.roundedBox(new Vector3(0, 0.046, -0.205), 0.038, 0.028, 0.05, body, w, 4);
  h.roundedBox(new Vector3(0, 0.08, -0.238), 0.024, 0.012, 0.042, acc, w, 3);
  inBone(B.metal, rest);
  for (const sx of [1, -1]) {
    B.metal.roundedBox(new Vector3(sx * 0.047, 0.028, -0.12), 0.004, 0.006, 0.045, _c.set(0xb8bec6), w, 4);
  }
}

// ---------------------------------------------------------------------------------------------------
// Twin-tip ski (ski-local, base at y = 0, +Z = tip). Top sheet in its own (textured) builder; base,
// sidewalls and steel edges in the hard builder.

function skiShape(t: number, length: number) {
  // t: 0 tail .. 1 tip
  const z = -length / 2 + t * length;
  const e = Math.abs(t * 2 - 1); // 0 centre .. 1 ends
  let width = 0.098 + 0.03 * e * e;
  if (e > 0.9) width *= Math.sqrt(Math.max(0, 1 - Math.pow((e - 0.9) / 0.1, 2))) * 0.85 + 0.15;
  const rise = e > 0.78 ? Math.pow((e - 0.78) / 0.22, 2) * 0.085 : 0;
  const zz = z - Math.sign(z) * rise * 0.35;
  const thick = 0.006 + 0.012 * (1 - smooth01(0.45, 1, e));
  return { z: zz, half: Math.max(0.006, width / 2), rise, thick };
}

function buildSki(
  B: OutfitBuilders,
  bone: number,
  rest: Vector3,
  col: OutfitColors,
  dims: OutfitDims,
  seg: (n: number) => number,
): void {
  const n = seg(64);
  const L = dims.skiLength;
  const w = rigid(bone);
  const top = new Color(dims.texturedTopSheet ? 0xffffff : col.skiTop);
  inBone(B.skiTop, rest);
  B.skiTop.grid(
    n,
    4,
    (r, c, out) => {
      const s = skiShape(r / n, L);
      const u = c / 4;
      const crown = 0.0015 * (1 - Math.pow(u * 2 - 1, 2));
      out.p.set((u * 2 - 1) * s.half * 0.97, s.rise + s.thick + crown, s.z);
      out.u = u;
      out.v = r / n;
      out.color.copy(top);
      out.w = w;
    },
    {},
  );
  const h = B.hard;
  inBone(h, rest);
  const base = new Color(col.skiBase);
  const side = new Color(col.skiSide);
  const steel = new Color(0x8f979f);
  // Cross-section loop (from top-left going down and around): sidewall top, edge, base.
  const loop = [
    [0.97, 1],
    [1.0, 0.85],
    [1.0, 0.15],
    [0.99, 0],
    [-0.99, 0],
    [-1.0, 0.15],
    [-1.0, 0.85],
    [-0.97, 1],
  ];
  h.grid(
    n,
    loop.length - 1,
    (r, c, out) => {
      const s = skiShape(r / n, L);
      const [lx, ly] = loop[c];
      out.p.set(lx * s.half, s.rise + ly * s.thick, s.z);
      out.color.copy(c === 0 || c === 7 ? side : c === 3 || c === 4 ? base : c === 2 || c === 5 ? steel : side);
      out.w = w;
    },
    {},
  );
}

