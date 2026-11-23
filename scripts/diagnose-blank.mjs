// Diagnoses the gameplay viewport: canvas count/sizes, console errors, screenshot.
// Usage: node scripts/diagnose-blank.mjs <url> <outPng>
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173', outPng = 'diagnose.png'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on(
  'console',
  (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`),
);
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));
await page.goto(url);
await page.click('[data-testid=play]');
await page.waitForSelector('[data-testid=hud]', { timeout: 90000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid=canvas-host] canvas')].map((c) => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, top: Math.round(r.top), height: Math.round(r.height) };
  }),
);
console.log('canvases:', JSON.stringify(info));
await page.screenshot({ path: outPng });
console.log(logs.filter((l) => !l.includes('deprecated parameters')).join('\n') || 'no console errors');
await browser.close();
