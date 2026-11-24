// Builds labelled side-by-side composites (left = baseline, right = new) for every PNG present in both dirs.
// Usage: node scripts/side-by-side.mjs <baselineDir> <newDir> <outDir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [a, b, out] = process.argv.slice(2);
const names = readdirSync(b).filter((n) => n.endsWith('.png') && readdirSync(a).includes(n));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of names) {
  const left = readFileSync(`${a}/${name}`).toString('base64');
  const right = readFileSync(`${b}/${name}`).toString('base64');
  const data = await page.evaluate(
    async ([l, r, label]) => {
      const load = async (s) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        return img;
      };
      const [il, ir] = await Promise.all([load(l), load(r)]);
      const w = 960;
      const h = Math.round((il.height / il.width) * w);
      const c = document.createElement('canvas');
      c.width = w * 2 + 8;
      c.height = h + 28;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(il, 0, 28, w, h);
      ctx.drawImage(ir, w + 8, 28, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(`BASELINE  ${label}`, 8, 20);
      ctx.fillText(`WP-1  ${label}`, w + 16, 20);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    },
    [left, right, name],
  );
  writeFileSync(`${out}/${name.replace('.png', '.jpg')}`, Buffer.from(data, 'base64'));
}
console.log(`${names.length} composites written`);
await browser.close();
