// Close-up skier pose comparison: a tight chase camera and the same scripted actions per shot, so the skier
// model and animation can be compared between builds.
// Usage: FREESKI_GPU=1 node scripts/skier-views.mjs <outDir> <baseUrl>
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:4173';
const gpu = process.env.FREESKI_GPU === '1';

const browser = await chromium.launch(
  gpu
    ? { channel: 'msedge', args: ['--ignore-gpu-blocklist'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

// Close camera via persisted settings (sanitised by the game).
await page.goto(base);
await page.evaluate(() =>
  localStorage.setItem(
    'freeski.settings.v1',
    JSON.stringify({ camera: { distance: 3.2, height: 1.15, sensitivity: 1, smoothing: 9, fov: 50 } }),
  ),
);
await page.goto(base);
await page.getByTestId('play').click();
await page.waitForSelector('[data-testid=hud]', { timeout: 90000 });
await page.waitForFunction(() => !!window.__FREESKI__?.sim);
await page.waitForTimeout(1200);

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const state = () => page.evaluate(() => window.__FREESKI__.sim.player.state);
const waitState = (states, timeout = 30000) =>
  page.waitForFunction((s) => s.includes(window.__FREESKI__.sim.player.state), states, { timeout });
const waitAir = (t) =>
  page.waitForFunction((tt) => window.__FREESKI__.sim.player.rotation.airTime > tt, t, { timeout: 30000 });
const place = (x, z, v, settle = 900) =>
  page
    .evaluate(([px, pz, pv]) => window.__FREESKI__.game.debugTeleport(px, pz, pv), [x, z, v])
    .then(() => page.waitForTimeout(settle));
const kicker = (id, back, v) =>
  page.evaluate(
    ([kid, b, pv]) => {
      const f = window.__FREESKI__;
      const k = f.sim.park.kickers.find((kk) => kk.config.id === kid);
      f.game.debugTeleport(k.config.x, k.config.z - b, pv);
    },
    [id, back, v],
  );
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
};
const release = async (keys) => {
  for (const k of keys) await page.keyboard.up(k);
};
const airShot = async (name, kickerId, keys, airT, speed = 15) => {
  await kicker(kickerId, 12, speed);
  await page.keyboard.down('Space');
  await waitState(['AIRBORNE']);
  await page.keyboard.up('Space');
  for (const k of keys) await page.keyboard.down(k);
  await waitAir(airT);
  await shot(name);
  await release(keys);
  await waitState(['LANDING', 'RIDING', 'CARVING', 'CRASHED', 'BRAKING', 'IDLE']);
  await page.waitForTimeout(600);
};

// Ground poses (gentle part of the rail garden approach).
await place(0, 262, 0, 1200);
await shot('s01-idle');
await place(0, 262, 13, 500);
await shot('s02-riding');
await hold(['KeyA'], 700);
await shot('s03-carve-left');
await release(['KeyA']);
await hold(['KeyS'], 600);
await shot('s04-brake');
await release(['KeyS']);
await place(0, 262, 12, 400);
await hold(['Space'], 350);
await shot('s05-charge');
await release(['Space']);
await page.waitForTimeout(1500);

// Air poses.
await airShot('s06-air-straight', 'k2', [], 0.5);
await airShot('s07-spin', 'k3', ['KeyA'], 0.45, 16);
await airShot('s08-backflip', 'k3', ['KeyS'], 0.5, 16);
await airShot('s09-grab-mute', 'k2', ['KeyQ'], 0.7);
await airShot('s10-grab-japan', 'k2', ['KeyQ', 'KeyE'], 0.7);
await airShot('s11-grab-tail', 'k2', ['ShiftLeft'], 0.7);
await airShot('s12-grab-truckdriver', 'k2', ['KeyE', 'ShiftLeft'], 0.7);

// Landing compression.
await kicker('k2', 12, 15);
await page.keyboard.down('Space');
await waitState(['AIRBORNE']);
await page.keyboard.up('Space');
await waitState(['LANDING']);
await page.waitForTimeout(60);
await shot('s13-landing');
await page.waitForTimeout(800);

// Rail grind.
await place(9, 236, 9, 100);
await waitState(['RAIL_GRINDING']).catch(() => errors.push('grind not reached'));
await page.waitForTimeout(300);
await shot('s14-grind');
await page.waitForTimeout(1500);

// Crash (frontflip into the landing).
await kicker('k3', 12, 16);
await page.keyboard.down('Space');
await waitState(['AIRBORNE']);
await page.keyboard.up('Space');
await page.keyboard.down('KeyW');
await waitState(['CRASHED']).catch(() => errors.push('crash not reached'));
await page.keyboard.up('KeyW');
await page.waitForTimeout(250);
await shot('s15-crash');

await page.evaluate(() => localStorage.removeItem('freeski.settings.v1'));
console.log(JSON.stringify({ state: await state(), errors: errors.filter((e) => !e.includes('deprecated')) }, null, 2));
await browser.close();
