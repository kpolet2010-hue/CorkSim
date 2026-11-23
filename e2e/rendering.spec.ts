import { expect, test, type Page } from '@playwright/test';

/**
 * Regression tests for the blank-viewport bug: the 3D world must actually be visible on screen,
 * verified from screenshot pixels rather than from the presence of a canvas element.
 */

interface DebugWindow {
  __FREESKI__?: {
    sim: { player: { body: { speed: number; position: { x: number; y: number; z: number } } } };
    game: { debugCameraPosition: () => { x: number; y: number; z: number } };
  };
}

interface PixelStats {
  luminanceStdDev: number;
  distinctColors: number;
  meanR: number;
  meanG: number;
  meanB: number;
}

/** Decodes a screenshot inside the page and measures how much visual content it contains. */
async function viewportStats(page: Page): Promise<PixelStats> {
  // Exclude the HUD margins: sample the central region of the viewport.
  const png = await page.screenshot({ clip: { x: 200, y: 150, width: 880, height: 450 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let sum2 = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    const colors = new Set<number>();
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      r += d[i];
      g += d[i + 1];
      bl += d[i + 2];
      colors.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    }
    const mean = sum / n;
    return {
      luminanceStdDev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
      distinctColors: colors.size,
      meanR: r / n,
      meanG: g / n,
      meanB: bl / n,
    };
  }, png.toString('base64'));
}

for (const park of [
  { id: 'glacier-park', name: 'Glacier Park' },
  { id: 'big-air', name: 'Big Air Ridge' },
]) {
  test(`${park.name}: the 3D world is visible and the camera follows the skier`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/');
    await page.getByTestId('menu-parks').click();
    await page.getByTestId(`park-${park.id}`).click();
    await page.getByTestId('menu-back').click();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('hud')).toBeVisible({ timeout: 90_000 });
    await page.waitForFunction(() => !!(window as DebugWindow).__FREESKI__?.sim);
    await page.waitForTimeout(1500);

    // Exactly one gameplay canvas, filling the viewport (an orphaned canvas caused the original bug).
    const canvases = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid=canvas-host] canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { top: r.top, height: r.height, width: r.width };
      }),
    );
    expect(canvases).toHaveLength(1);
    expect(canvases[0].top).toBe(0);
    expect(canvases[0].height).toBeGreaterThan(600);

    // Real rendered content: snow/sky are bright, and there is plenty of variation (skier, trees, park).
    const stats = await viewportStats(page);
    expect(stats.luminanceStdDev).toBeGreaterThan(8);
    expect(stats.distinctColors).toBeGreaterThan(200);
    // Not the dark navy page background.
    expect(stats.meanR + stats.meanG + stats.meanB).toBeGreaterThan(3 * 120);

    // The skier moves and the camera follows.
    const cam0 = await page.evaluate(() => (window as DebugWindow).__FREESKI__!.game.debugCameraPosition());
    await page.keyboard.down('KeyW');
    await expect
      .poll(() => page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.player.body.speed), {
        timeout: 30_000,
      })
      .toBeGreaterThan(2);
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => {
      const f = (window as DebugWindow).__FREESKI__!;
      return { cam: f.game.debugCameraPosition(), skier: f.sim.player.body.position };
    });
    expect(after.cam.z).toBeGreaterThan(cam0.z + 0.5);
    const dist = Math.hypot(
      after.cam.x - after.skier.x,
      after.cam.y - after.skier.y,
      after.cam.z - after.skier.z,
    );
    expect(dist).toBeLessThan(15);
    // Still rendering real content while moving.
    expect((await viewportStats(page)).luminanceStdDev).toBeGreaterThan(8);
    expect(errors.filter((e) => !e.includes('deprecated parameters'))).toEqual([]);
  });
}
