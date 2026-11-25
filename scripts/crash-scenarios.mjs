// Crash scenario recorder: plays each crash scenario from the normal gameplay camera, records the whole
// crash (approach -> impact -> slide -> rest -> get-up) as a WebM clip, plus a frame sequence and a
// contact sheet at fixed times after the crash.
//
// Usage:
//   FREESKI_GPU=1 node scripts/crash-scenarios.mjs <outDir> <baseUrl> [only=g1,b4,...] [cam=close]
//
// The clip is built from a DevTools screencast (JPEG frames) and encoded with Playwright's bundled
// ffmpeg (VP8 WebM), resampled to a constant 30 fps.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'crash-out';
const base = process.argv[3] ?? 'http://localhost:4173';
const onlyArg = process.argv.find((a) => a.startsWith('only='));
const only = onlyArg ? onlyArg.slice(5).split(',') : null;
// cam=close: tight chase camera (same settings as skier-views.mjs) for close inspection of the body.
const close = process.argv.includes('cam=close');
const gpu = process.env.FREESKI_GPU === '1';
const SHEET_TIMES = [0, 0.2, 0.4, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0];
mkdirSync(out, { recursive: true });

function findFfmpeg() {
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).filter((n) => n.startsWith('ffmpeg'))) {
    for (const f of readdirSync(join(root, d))) if (f.startsWith('ffmpeg')) return join(root, d, f);
  }
  return null;
}
const ffmpeg = findFfmpeg();

const browser = await chromium.launch(
  gpu
    ? { channel: 'msedge', args: ['--ignore-gpu-blocklist'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
const cdp = await page.context().newCDPSession(page);

// Default gameplay camera: clear any persisted settings.
await page.goto(base);
await page.evaluate((c) => {
  if (c)
    localStorage.setItem(
      'freeski.settings.v1',
      JSON.stringify({ camera: { distance: 3.2, height: 1.15, sensitivity: 1, smoothing: 9, fov: 50 } }),
    );
  else localStorage.removeItem('freeski.settings.v1');
}, close);

async function startPark(parkId) {
  await page.goto(base);
  await page.getByTestId('menu-parks').click();
  await page.getByTestId(`park-${parkId}`).click();
  await page.getByTestId('menu-back').click();
  await page.getByTestId('play').click();
  await page.waitForSelector('[data-testid=hud]', { timeout: 90000 });
  await page.waitForFunction(() => !!window.__FREESKI__?.sim);
  await page.waitForTimeout(1500);
  // Track crash start / end in page time (Date.now, same clock as screencast timestamps).
  await page.evaluate(() => {
    const w = window;
    w.__crashLog = { start: 0, end: 0 };
    const tick = () => {
      const s = w.__FREESKI__?.sim?.player?.state;
      if (s === 'CRASHED' && !w.__crashLog.start) {
        w.__crashLog.start = Date.now();
        w.__crashLog.reason = w.__FREESKI__.sim.player.crashReason;
      }
      if (s !== 'CRASHED' && w.__crashLog.start && !w.__crashLog.end) w.__crashLog.end = Date.now();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const sim = (fn, arg) => page.evaluate(fn, arg);
const state = () => sim(() => window.__FREESKI__.sim.player.state);
const waitState = (states, timeout = 30000) =>
  page.waitForFunction((s) => s.includes(window.__FREESKI__.sim.player.state), states, { timeout });
const teleport = (x, z, v, settle = 700) =>
  sim(([px, pz, pv]) => window.__FREESKI__.game.debugTeleport(px, pz, pv), [x, z, v]).then(() =>
    page.waitForTimeout(settle),
  );
const kicker = (id, back, v) =>
  sim(
    ([kid, b, pv]) => {
      const f = window.__FREESKI__;
      const k = f.sim.park.kickers.find((kk) => kk.config.id === kid);
      f.game.debugTeleport(k.config.x, k.config.z - b, pv);
    },
    [id, back, v],
  );
const debugFall = (kind, side = 1) =>
  sim(([k, s]) => window.__FREESKI__.sim.player.debugFall(k, s), [kind, side]);

async function record(name, setup) {
  if (only && !only.includes(name.split('-')[0])) return;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  await sim(() => Object.assign(window.__crashLog, { start: 0, end: 0, reason: '' }));
  const frames = [];
  const onFrame = async (e) => {
    frames.push({ t: e.metadata.timestamp * 1000, data: e.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 1280, maxHeight: 720 });
  const t0 = Date.now();
  let note = '';
  try {
    await setup();
    await waitState(['CRASHED'], 15000);
    // Whole crash: until recovery (state leaves CRASHED), then 1.5 s of get-up, max 9 s.
    await page
      .waitForFunction(() => window.__crashLog.end > 0, null, { timeout: 9000 })
      .catch(() => (note = 'still CRASHED after 9 s'));
    await page.waitForTimeout(1500);
  } catch (e) {
    note = `scenario failed: ${e.message.split('\n')[0]}`;
  }
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  const log = await sim(() => ({ ...window.__crashLog }));
  const crashStart = log.start || t0;
  const info = {
    name,
    note,
    frames: frames.length,
    crashAt: (crashStart - (frames[0]?.t ?? t0)) / 1000,
    crashDuration: log.end ? (log.end - log.start) / 1000 : null,
    reason: log.reason,
  };
  // Frame sequence at fixed times after the crash.
  const pick = (ms) => frames.reduce((best, f) => (Math.abs(f.t - ms) < Math.abs(best.t - ms) ? f : best));
  if (frames.length) {
    for (const s of SHEET_TIMES) {
      const f = pick(crashStart + s * 1000);
      writeFileSync(
        join(dir, `t${String(Math.round(s * 1000)).padStart(4, '0')}.jpg`),
        Buffer.from(f.data, 'base64'),
      );
    }
  }
  // Constant 30 fps clip from 1.2 s before the crash to the end of the capture.
  if (ffmpeg && frames.length > 2) {
    const startT = Math.max(frames[0].t, crashStart - 1200);
    const endT = frames[frames.length - 1].t;
    const proc = spawn(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'mjpeg',
      '-i',
      'pipe:0',
      '-c:v',
      'libvpx',
      '-b:v',
      '4M',
      '-pix_fmt',
      'yuv420p',
      join(out, `${name}.webm`),
    ]);
    let k = 0;
    for (let t = startT; t <= endT; t += 1000 / 30) {
      while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
      if (!proc.stdin.write(Buffer.from(frames[k].data, 'base64')))
        await new Promise((r) => proc.stdin.once('drain', r));
    }
    proc.stdin.end();
    await new Promise((r) => proc.on('close', r));
  }
  console.log(JSON.stringify(info));
  writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2));
  // Make sure the next scenario starts from a riding state.
  if ((await state()) === 'CRASHED')
    await page
      .waitForFunction(() => window.__FREESKI__.sim.player.state !== 'CRASHED', null, { timeout: 8000 })
      .catch(() => {});
}

async function contactSheet(name) {
  const dir = join(out, name);
  if (!existsSync(dir)) return;
  const files = SHEET_TIMES.map((s) => `t${String(Math.round(s * 1000)).padStart(4, '0')}.jpg`).filter((f) =>
    existsSync(join(dir, f)),
  );
  if (!files.length) return;
  const { readFileSync } = await import('node:fs');
  const imgs = files.map((f) => readFileSync(join(dir, f)).toString('base64'));
  const sheet = await browser.newPage();
  const data = await sheet.evaluate(
    async ([imgs, labels, title]) => {
      const ld = async (s) => {
        const i = new Image();
        i.src = `data:image/jpeg;base64,${s}`;
        await i.decode();
        return i;
      };
      const ims = await Promise.all(imgs.map(ld));
      const w = 480;
      const h = 270;
      const cols = 3;
      const rows = Math.ceil(ims.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * w + (cols - 1) * 6;
      c.height = rows * (h + 24) + 30;
      const x = c.getContext('2d');
      x.fillStyle = '#111';
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff';
      x.font = 'bold 18px sans-serif';
      x.fillText(title, 8, 21);
      ims.forEach((im, k) => {
        const cx = (k % cols) * (w + 6);
        const cy = 30 + Math.floor(k / cols) * (h + 24);
        x.drawImage(im, cx, cy + 20, w, h);
        x.font = 'bold 14px sans-serif';
        x.fillText(labels[k], cx + 6, cy + 15);
      });
      return c.toDataURL('image/jpeg', 0.88).split(',')[1];
    },
    [imgs, files.map((f) => `+${Number(f.slice(1, 5)) / 1000} s`), name],
  );
  writeFileSync(join(out, `${name}-sheet.jpg`), Buffer.from(data, 'base64'));
  await sheet.close();
}

const scenarios = [];

// ---------------------------------------------------------------- Glacier Park
await startPark('glacier-park');
const glacier = [
  [
    'g1-backward-fall',
    async () => {
      await teleport(0, 262, 12, 900);
      await debugFall('backward');
    },
  ],
  [
    'g2-side-fall-carving',
    async () => {
      await teleport(0, 262, 13, 400);
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(800);
      await debugFall('side', -1);
      await page.keyboard.up('KeyD');
    },
  ],
  [
    'g3-forward-fall',
    async () => {
      await teleport(0, 262, 12, 900);
      await debugFall('forward');
    },
  ],
  [
    'g4-big-jump-crash',
    async () => {
      // L kicker, frontflip held into the landing: over-rotated head-first impact.
      await kicker('k3', 12, 16);
      await page.keyboard.down('Space');
      await waitState(['AIRBORNE']);
      await page.keyboard.up('Space');
      await page.keyboard.down('KeyW');
      await waitState(['CRASHED', 'LANDING', 'RIDING', 'CARVING'], 15000).finally(() =>
        page.keyboard.up('KeyW'),
      );
    },
  ],
  [
    'g5-rail-bail',
    async () => {
      await teleport(9, 236, 9, 100);
      await waitState(['RAIL_GRINDING'], 10000);
      await page.keyboard.down('KeyA');
      await waitState(['CRASHED', 'AIRBORNE', 'LANDING', 'RIDING'], 10000).finally(() =>
        page.keyboard.up('KeyA'),
      );
    },
  ],
  [
    'g6-high-speed-tree',
    async () => {
      const t = await sim(() => {
        const trees = window.__FREESKI__.sim.park.trees.filter((tr) => tr.z > 150 && tr.z < 600);
        trees.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
        return { x: trees[0].x, z: trees[0].z };
      });
      await teleport(t.x, t.z - 16, 22, 50);
    },
  ],
];
for (const [name, setup] of glacier) {
  await record(name, setup);
  scenarios.push(name);
}

// ---------------------------------------------------------------- Big Air Ridge
await startPark('big-air');
const bigAir = [
  [
    'b1-backward-fall',
    async () => {
      await teleport(0, 60, 12, 900);
      await debugFall('backward');
    },
  ],
  [
    'b2-side-fall-carving',
    async () => {
      await teleport(0, 60, 13, 400);
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(800);
      await debugFall('side', 1);
      await page.keyboard.up('KeyA');
    },
  ],
  [
    'b3-forward-fall',
    async () => {
      await teleport(0, 60, 12, 900);
      await debugFall('forward');
    },
  ],
  [
    'b4-big-jump-crash',
    async () => {
      // XL kicker, backflip held through the whole flight: over-rotated, lands on the back / head.
      await kicker('ba1', 7, 14);
      await page.keyboard.down('Space');
      await waitState(['AIRBORNE']);
      await page.keyboard.up('Space');
      await page.keyboard.down('KeyS');
      await waitState(['CRASHED', 'LANDING', 'RIDING', 'CARVING'], 15000).finally(() =>
        page.keyboard.up('KeyS'),
      );
    },
  ],
  [
    'b5-rail-bail',
    async () => {
      await teleport(14, 128, 9, 100);
      await waitState(['RAIL_GRINDING'], 10000);
      await page.keyboard.down('KeyD');
      await waitState(['CRASHED', 'AIRBORNE', 'LANDING', 'RIDING'], 10000).finally(() =>
        page.keyboard.up('KeyD'),
      );
    },
  ],
  [
    'b6-high-speed-impact',
    async () => {
      // XXL kicker at high speed with a held frontflip: hard head-first impact at speed.
      await kicker('ba3', 14, 20);
      await page.keyboard.down('Space');
      await waitState(['AIRBORNE']);
      await page.keyboard.up('Space');
      await page.keyboard.down('KeyW');
      await waitState(['CRASHED', 'LANDING', 'RIDING'], 15000).finally(() => page.keyboard.up('KeyW'));
    },
  ],
];
for (const [name, setup] of bigAir) {
  await record(name, setup);
  scenarios.push(name);
}

for (const n of scenarios) await contactSheet(n);
console.log(
  JSON.stringify({ ffmpeg: !!ffmpeg, errors: errors.filter((e) => !e.includes('deprecated')) }, null, 2),
);
await browser.close();
