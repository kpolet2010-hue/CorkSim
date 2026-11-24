import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  CanvasTexture,
} from 'three';
import { fbm2 } from '../core/Random';

/**
 * Procedural tiling snow normal map. Generated on the CPU into a DataTexture so no image assets are
 * required. Combines fine grain (crystals) with soft wind-blown ripples.
 */
export function createSnowNormalTexture(size = 256): DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable by sampling noise on a torus-like wrap (periodic via sin/cos mapping).
      const u = x / size;
      const v = y / size;
      const nx = Math.cos(u * Math.PI * 2) * 2.5;
      const ny = Math.sin(u * Math.PI * 2) * 2.5;
      const nz = Math.cos(v * Math.PI * 2) * 2.5;
      const nw = Math.sin(v * Math.PI * 2) * 2.5;
      const ripple = fbm2(nx + nz * 0.3, ny + nw * 0.3, 11, 3);
      const grain = fbm2(nx * 6 + nz * 4, ny * 6 + nw * 4, 23, 2);
      h[y * size + x] = ripple * 0.6 + grain * 0.4;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Soft round sprite used by snow particles. */
export function createSoftDotTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(a, 1.5) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Text label texture for signs and banners. Returns null where no canvas is available. */
export function createLabelTexture(
  text: string,
  opts: { bg: string; fg: string; width?: number; height?: number; font?: string; border?: string },
): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = opts.width ?? 512;
  canvas.height = opts.height ?? 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (opts.border) {
    const b = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.05));
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = b;
    ctx.strokeRect(b * 1.5, b * 1.5, canvas.width - b * 3, canvas.height - b * 3);
  }
  ctx.fillStyle = opts.fg;
  ctx.font = opts.font ?? `900 ${Math.floor(canvas.height * 0.62)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + canvas.height * 0.03);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Safety-net mesh: white diamond strands on transparent, tinted by the material colour. Mipmapped, so at a
 * distance it averages to a translucent orange band like a real net. Returns null without a canvas.
 */
export function createNetTexture(size = 128): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.07;
  const cells = 4;
  const s = size / cells;
  ctx.beginPath();
  for (let i = -cells; i <= cells * 2; i++) {
    ctx.moveTo(i * s, 0);
    ctx.lineTo(i * s + size, size);
    ctx.moveTo(i * s, size);
    ctx.lineTo(i * s + size, 0);
  }
  ctx.stroke();
  // Top and bottom selvage bands.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size * 0.06);
  ctx.fillRect(0, size * 0.94, size, size * 0.06);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Cross profile of a ski track (u across the track): soft alpha falloff at the edges, slightly darker
 * compressed walls and a smoother, brighter centre. Colours are sRGB.
 */
export function createTrackTexture(width = 64): DataTexture {
  const h = 4;
  const data = new Uint8Array(width * h * 4);
  for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width;
    const e = Math.abs(u - 0.5) * 2; // 0 centre .. 1 edge
    const wall = Math.exp(-Math.pow((e - 0.78) / 0.12, 2));
    const alpha = Math.max(0, 1 - Math.pow(e, 6));
    const shade = 1 - wall * 0.22;
    for (let y = 0; y < h; y++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round(206 * shade);
      data[i + 1] = Math.round(218 * shade);
      data[i + 2] = Math.round(236 * shade);
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const tex = new DataTexture(data, width, h, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Painted box side panel: a base colour with a diagonal hazard stripe band and a small wordmark, tiling
 * along the box (u repeats per metre). Returns null without a canvas.
 */
export function createBoxSideTexture(base: string, stripe: string, text: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = stripe;
  for (let x = -128; x < 512 + 128; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + 24, 128);
    ctx.lineTo(x + 24 + 22, 104);
    ctx.lineTo(x + 22, 104);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(0, 0, 512, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '900 54px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 56);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Snow puff sprite: an opaque, clumpy core with a soft rim, so spray reads as distinct puffs of snow rather
 * than a uniform haze. Deterministic (value noise), no canvas needed.
 */
export function createPuffTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const n = fbm2(u * 6 + 3.1, v * 6 + 7.7, 29, 3) * 0.5 + 0.5;
      // Noisy radius gives a lumpy silhouette; the core stays nearly opaque.
      const d = Math.sqrt(u * u + v * v) * 2 * (0.8 + n * 0.45);
      const core = Math.min(1, Math.max(0, (1 - d) / 0.55));
      const a = core * core * (3 - 2 * core) * (0.8 + n * 0.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
