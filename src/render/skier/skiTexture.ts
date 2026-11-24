import { CanvasTexture, Color, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export interface TopSheetColors {
  base: number;
  accent: number;
  ink: number;
}

/**
 * Procedural twin-tip top-sheet graphic (symmetric tip/tail fades, chevrons, a centre wordmark band).
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
  const ink = css(c.ink);

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Symmetric tip / tail fades into the ink colour.
  for (const flip of [false, true]) {
    const g = ctx.createLinearGradient(0, flip ? H : 0, 0, flip ? H * 0.72 : H * 0.28);
    g.addColorStop(0, ink);
    g.addColorStop(0.45, ink);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, flip ? H * 0.72 : 0, W, H * 0.28);
  }

  // Chevrons pointing to both ends.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  for (let k = 0; k < 4; k++) {
    for (const dir of [1, -1]) {
      const y0 = H / 2 + dir * (70 + k * 22);
      ctx.beginPath();
      ctx.moveTo(4, y0);
      ctx.lineTo(W / 2, y0 + dir * 14);
      ctx.lineTo(W - 4, y0);
      ctx.stroke();
    }
  }

  // Centre band with a simple block wordmark (original, no brand).
  ctx.fillStyle = ink;
  ctx.fillRect(0, H / 2 - 46, W, 92);
  ctx.fillStyle = accent;
  ctx.fillRect(0, H / 2 - 46, W, 4);
  ctx.fillRect(0, H / 2 + 42, W, 4);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = base;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FREESKI', 0, 1);
  ctx.restore();

  // Thin edge pinstripes along the whole ski.
  ctx.fillStyle = accent;
  ctx.fillRect(2, 0, 2, H);
  ctx.fillRect(W - 4, 0, 2, H);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
