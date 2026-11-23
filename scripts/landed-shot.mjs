// Visual check of a landed trick (banner, feed, score). Requires `npm run preview` on port 4173.
// Usage: node scripts/landed-shot.mjs <outDir>
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173');
await page.click('[data-testid=play]');
await page.waitForSelector('[data-testid=hud]', { timeout: 60000 });
// Straight air with a long Japan grab off the M kicker (robust at low frame rates).
await page.evaluate(() => {
  const s = window.__FREESKI__.sim;
  const k = s.park.kickers.find((kk) => kk.config.id === 'k2');
  window.__FREESKI__.game.debugTeleport(k.config.x, k.config.z - 14, 15);
});
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__FREESKI__.sim.player.state === 'AIRBORNE', null, {
  timeout: 20000,
});
await page.keyboard.up('Space');
await page.keyboard.down('KeyQ');
await page.keyboard.down('KeyE');
await page.waitForFunction(() => window.__FREESKI__.sim.player.rotation.airTime > 0.9, null, {
  timeout: 20000,
});
await page.screenshot({ path: `${out}/20-japan.png` });
await page.keyboard.up('KeyQ');
await page.keyboard.up('KeyE');
await page.waitForFunction(
  () => ['LANDING', 'RIDING', 'CARVING', 'CRASHED'].includes(window.__FREESKI__.sim.player.state),
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/21-landed.png` });
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      window.__FREESKI__.sim.scoring.getRunScore().tricks.map((t) => `${t.name} ${t.landing} ${t.points}`),
    ),
  ),
);
await browser.close();
