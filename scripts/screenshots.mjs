// Visual smoke test: drives the production build with Playwright and saves screenshots.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs <outDir>
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));
await page.goto('http://localhost:4173');
await page.click('[data-testid=play]');
await page.waitForSelector('[data-testid=hud]', { timeout: 60000 });
const sim = (fn) => page.evaluate(fn);

// Carving.
await sim(() => window.__FREESKI__.game.debugTeleport(0, 260, 14));
await page.keyboard.down('KeyA');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/10-carve.png` });
await page.keyboard.up('KeyA');

// Air: hold jump into the lip, spin + grab.
await sim(() => {
  const s = window.__FREESKI__.sim;
  const k = s.park.kickers.find((k) => k.config.id === 'k3');
  window.__FREESKI__.game.debugTeleport(k.config.x, k.config.z - 12, 16);
});
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__FREESKI__.sim.player.state === 'AIRBORNE', null, {
  timeout: 20000,
});
await page.keyboard.up('Space');
await page.keyboard.down('KeyD');
await page.keyboard.down('KeyE');
await page.waitForFunction(() => window.__FREESKI__.sim.player.rotation.airTime > 0.6, null, {
  timeout: 20000,
});
await page.screenshot({ path: `${out}/11-air-spin.png` });
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyE');

// Backflip.
await sim(() => {
  const s = window.__FREESKI__.sim;
  const k = s.park.kickers.find((k) => k.config.id === 'k2');
  window.__FREESKI__.game.debugTeleport(k.config.x, k.config.z - 12, 15);
});
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__FREESKI__.sim.player.state === 'AIRBORNE', null, {
  timeout: 20000,
});
await page.keyboard.up('Space');
await page.keyboard.down('KeyS');
await page.waitForFunction(() => window.__FREESKI__.sim.player.rotation.airTime > 0.45, null, {
  timeout: 20000,
});
await page.screenshot({ path: `${out}/12-backflip.png` });
await page.keyboard.up('KeyS');

// Rail grind.
await sim(() => window.__FREESKI__.game.debugTeleport(9, 236, 9));
await page
  .waitForFunction(() => window.__FREESKI__.sim.player.state === 'RAIL_GRINDING', null, { timeout: 20000 })
  .catch(() => logs.push('no grind'));
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/13-grind.png` });

// Crash: flat landing upside down.
await sim(() => {
  const s = window.__FREESKI__.sim;
  const k = s.park.kickers.find((k) => k.config.id === 'k3');
  window.__FREESKI__.game.debugTeleport(k.config.x, k.config.z - 12, 16);
});
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__FREESKI__.sim.player.state === 'AIRBORNE', null, {
  timeout: 20000,
});
await page.keyboard.up('Space');
await page.keyboard.down('KeyW');
await page
  .waitForFunction(() => window.__FREESKI__.sim.player.state === 'CRASHED', null, { timeout: 20000 })
  .catch(() => logs.push('no crash'));
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/14-crash.png` });

console.log(
  JSON.stringify(
    await sim(() => {
      const s = window.__FREESKI__.sim;
      return {
        score: s.scoring.totalScore,
        tricks: s.scoring.getRunScore().tricks.map((t) => `${t.name} ${t.landing} ${t.points}`),
      };
    }),
  ),
);
console.log(
  logs
    .filter((l) => !l.includes('deprecated parameters'))
    .slice(0, 20)
    .join('\n'),
);
await browser.close();
