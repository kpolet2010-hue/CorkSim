import { CanvasTexture, Color, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export interface TopSheetColors {
  base: number;
  accent: number;
  ink: number;
}

/**
 * Procedural twin-tip top-sheet graphic (pale sheet, lighter tips, binding-zone marks; no lettering).
 * The texture is mapped with u across the ski and v from tail (0) to tip (1). Returns null when no DOM
 * canvas is available (tests, workers) - the ski then falls back to vertex colours.
 */
export function createSkiTopSheet(c: TopSheetColors): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return null;
  }
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const W = canvas.width;
  const H = canvas.height;
  const css = (hex: number) => `#${new Color(hex).getHexString()}`;
  const base = css(c.base);
  const accent = css(c.accent);

  // Clean pale top sheet, slightly lighter towards both (twin) tips.
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (const flip of [false, true]) {
    const g = ctx.createLinearGradient(0, flip ? H : 0, 0, flip ? H * 0.8 : H * 0.2);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, flip ? H * 0.8 : 0, W, H * 0.2);
  }

  // Fine binding-zone marks and edge pinstripes in the accent colour.
  ctx.fillStyle = accent;
  for (const y of [H * 0.47, H * 0.53]) ctx.fillRect(10, y, W - 20, 2);
  ctx.fillRect(2, 0, 1, H);
  ctx.fillRect(W - 3, 0, 1, H);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
