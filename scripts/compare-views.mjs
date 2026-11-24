// Fixed-view visual comparison + real-GPU performance sampling.
// Every view teleports the skier to the same spot with the same speed, snaps the camera and waits for it
// to settle, so two builds can be compared frame-for-frame.
// Usage: FREESKI_GPU=1 node scripts/compare-views.mjs <outDir> <baseUrl> [perf]
//   perf  -> also sample frame times (requestAnimationFrame) and renderer stats per view; writes perf.json.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:4173';
const perf = process.argv.includes('perf');
const gpu = process.env.FREESKI_GPU === '1';

// FREESKI_UNCAPPED=1 disables vsync/frame limiting so FPS is a relative cost measure, not the monitor cap.
const uncapped = process.env.FREESKI_UNCAPPED === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
// FREESKI_LOWPOWER=1 asks the browser for the integrated (low-power) GPU.
if (process.env.FREESKI_LOWPOWER === '1') uncapped.push('--force_low_power_gpu');
const browser = await chromium.launch(
  gpu
    ? { channel: 'msedge', args: ['--ignore-gpu-blocklist', ...uncapped] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const results = { base, gpu, renderer: null, views: {} };

async function startPark(parkId) {
  await page.goto(base);
  await page.getByTestId('menu-parks').click();
  await page.getByTestId(`park-${parkId}`).click();
  await page.getByTestId('menu-back').click();
  await page.getByTestId('play').click();
  await page.waitForSelector('[data-testid=hud]', { timeout: 90000 });
  await page.waitForFunction(() => !!window.__FREESKI__?.sim);
  await page.waitForTimeout(1500);
  if (!results.renderer) {
    results.renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
  }
}

/** Places the skier (speed 0 = standing) and waits for the camera to settle. */
async function place(x, z, speed, heading = 0, settleMs = 1600) {
  await page.evaluate(([px, pz, v, h]) => window.__FREESKI__.game.debugTeleport(px, pz, v, h), [x, z, speed, heading]);
  await page.waitForTimeout(settleMs);
}

async function kickerPos(id, back) {
  return page.evaluate(
    ([kid, b]) => {
      const k = window.__FREESKI__.sim.park.kickers.find((kk) => kk.config.id === kid);
      return { x: k.config.x, z: k.config.z - b };
    },
    [id, back],
  );
}

async function samplePerf(name, ms = 4000) {
  if (!perf) return;
  const data = await page.evaluate(async (dur) => {
    const g = window.__FREESKI__.game;
    const r = g.renderer ?? g.environment?.renderer;
    const info = r?.info;
    // Post-processing calls render() once per pass and info auto-resets each call, so accumulate all
    // passes of a frame manually and reset once per animation frame.
    const prevAuto = info ? info.autoReset : true;
    if (info) {
      info.autoReset = false;
      info.reset();
    }
    const times = [];
    const calls = [];
    const tris = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const end = last + dur;
      const tick = (t) => {
        times.push(t - last);
        last = t;
        if (info) {
          calls.push(info.render.calls);
          tris.push(info.render.triangles);
          info.reset();
        }
        if (t < end) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (info) info.autoReset = prevAuto;
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    const median = (arr) => {
      const s = arr.filter((v) => v > 0).sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    return {
      frames: times.length,
      avgFps: 1000 / avg,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      maxFrameMs: sorted[sorted.length - 1],
      drawCalls: median(calls),
      triangles: median(tris),
      geometries: info?.memory?.geometries ?? null,
      textures: info?.memory?.textures ?? null,
      programs: info?.programs?.length ?? null,
      jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    };
  }, ms);
  results.views[name] = data;
}

async function view(name, fn) {
  await fn();
  await page.screenshot({ path: `${out}/${name}.png` });
  await samplePerf(name);
}

// ---------------- Glacier Park ----------------
await startPark('glacier-park');
await view('g1-spawn', () => place(0, -12, 0));
await view('g2-rail-garden', () => place(2, 128, 0));
await view('g3-jumpline', async () => {
  const p = await kickerPos('k2', 22);
  await place(p.x, p.z, 0);
});
// Standing on the L kicker's table, looking over the knuckle and down the landing.
await view('g4-knuckle-landing', async () => {
  const p = await kickerPos('k3', -10);
  await place(p.x, p.z, 0);
});
await view('g5-side-hits', () => place(0, 585, 0));
// Motion: carve spray (deterministic sim, wall-clock timing).
await view('g6-carve-spray', async () => {
  await place(4, 262, 15, 0, 400);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
});
await view('g7-air', async () => {
  const p = await kickerPos('k3', 12);
  await place(p.x, p.z, 16, 0, 200);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__FREESKI__.sim.player.state === 'AIRBORNE', null, { timeout: 30000 });
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__FREESKI__.sim.player.rotation.airTime > 0.6, null, { timeout: 30000 });
});
await page.waitForFunction(
  () => ['LANDING', 'RIDING', 'CARVING', 'CRASHED'].includes(window.__FREESKI__.sim.player.state),
  null,
  { timeout: 30000 },
);
await view('g8-landing-burst', () => page.waitForTimeout(120));
await view('g9-grind', async () => {
  await place(9, 236, 9, 0, 200);
  await page
    .waitForFunction(() => window.__FREESKI__.sim.player.state === 'RAIL_GRINDING', null, { timeout: 30000 })
    .catch(() => errors.push('grind not reached'));
  await page.waitForTimeout(250);
});

// ---------------- Big Air Ridge ----------------
await startPark('big-air');
await view('b1-spawn', () => place(0, -12, 0));
await view('b2-jump-xl', async () => {
  const p = await kickerPos('ba2', 24);
  await place(p.x, p.z, 0);
});
await view('b3-warmup-rails', () => place(0, 125, 0));
await view('b4-riding', async () => {
  await place(0, 260, 16, 0, 300);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyA');
});

results.errors = errors.filter((e) => !e.includes('deprecated parameters'));
if (perf) writeFileSync(`${out}/perf.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ renderer: results.renderer, errors: results.errors }, null, 2));
await browser.close();
