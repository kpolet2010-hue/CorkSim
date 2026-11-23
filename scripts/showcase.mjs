// Captures the standard screenshot set used for visual regression checks.
// Requires a running server (default: production preview on :4173).
// Usage: node scripts/showcase.mjs <outDir> [baseUrl] [only=name1,name2]
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:4173';
const only = (process.argv[4] ?? '').split(',').filter(Boolean);
const want = (n) => only.length === 0 || only.includes(n);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(`error: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const waitState = (states, timeout = 30000) =>
  page.waitForFunction((s) => s.includes(window.__FREESKI__.sim.player.state), states, { timeout });
const waitAir = (t) =>
  page.waitForFunction((tt) => window.__FREESKI__.sim.player.rotation.airTime > tt, t, { timeout: 30000 });
const teleportToKicker = (id, back, speed) =>
  page.evaluate(
    ([kid, b, v]) => {
      const f = window.__FREESKI__;
      const k = f.sim.park.kickers.find((kk) => kk.config.id === kid);
      f.game.debugTeleport(k.config.x, k.config.z - b, v);
    },
    [id, back, speed],
  );

async function startPark(parkId) {
  await page.goto(base);
  if (want('menu') && parkId === 'glacier-park') await shot('01-menu');
  await page.getByTestId('menu-parks').click();
  await page.getByTestId(`park-${parkId}`).click();
  await page.getByTestId('menu-back').click();
  await page.getByTestId('play').click();
  await page.waitForSelector('[data-testid=hud]', { timeout: 90000 });
  await page.waitForTimeout(1200);
}

await startPark('glacier-park');
if (want('glacier')) await shot('02-glacier-park');

if (want('skiing')) {
  await page.evaluate(() => window.__FREESKI__.game.debugTeleport(4, 262, 14));
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(900);
  await shot('04-skiing-carve');
  await page.keyboard.up('KeyD');
}

if (want('trick')) {
  await teleportToKicker('k3', 12, 16);
  await page.keyboard.down('Space');
  await waitState(['AIRBORNE']);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyA');
  await page.keyboard.down('ArrowLeft');
  await waitAir(0.5);
  await shot('05-trick-cork');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('ArrowLeft');
  await waitState(['LANDING', 'RIDING', 'CARVING', 'CRASHED']);
}

if (want('grab')) {
  await teleportToKicker('k2', 12, 15);
  await page.keyboard.down('Space');
  await waitState(['AIRBORNE']);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyQ');
  await waitAir(0.7);
  await shot('06-grab-mute');
  await page.keyboard.up('KeyQ');
  await waitState(['LANDING', 'RIDING', 'CARVING', 'CRASHED']);
  await page.waitForTimeout(150);
  await shot('07-landing');
}

if (want('replay')) {
  const ok = await page.evaluate(() => typeof window.__FREESKI__.game.startReplay === 'function');
  if (ok) {
    await page.keyboard.press('Escape');
    await page.getByTestId('replay').click();
    await page.waitForSelector('[data-testid=replay-ui]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot('08-replay');
    await page.getByTestId('replay-exit').click();
  }
}

if (want('bigair')) {
  await startPark('big-air');
  await shot('03-big-air-ridge');
  await teleportToKicker('ba2', 14, 17);
  await page.keyboard.down('Space');
  await waitState(['AIRBORNE']);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyS');
  await waitAir(0.6);
  await shot('09-big-air-backflip');
  await page.keyboard.up('KeyS');
}

if (want('closeup')) {
  await page.evaluate(() => {
    localStorage.setItem(
      'freeski.settings.v1',
      JSON.stringify({ camera: { distance: 3, height: 1.1, sensitivity: 1, smoothing: 7, fov: 50 } }),
    );
  });
  await startPark('glacier-park');
  await page.evaluate(() => window.__FREESKI__.game.debugTeleport(0, 262, 12));
  await page.waitForTimeout(900);
  await shot('10-closeup-riding');
  await teleportToKicker('k2', 12, 15);
  await page.keyboard.down('Space');
  await waitState(['AIRBORNE']);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyE');
  await page.keyboard.down('Digit9');
  await waitAir(0.6);
  await shot('11-closeup-grab');
  await page.keyboard.up('KeyE');
  await page.evaluate(() => localStorage.removeItem('freeski.settings.v1'));
}

console.log(logs.filter((l) => !l.includes('deprecated parameters')).join('\n') || 'no console errors');
await browser.close();
