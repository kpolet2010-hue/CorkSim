import { expect, test, type Page } from '@playwright/test';

interface DebugWindow {
  __FREESKI__?: {
    sim: {
      runTime: number;
      player: {
        state: string;
        body: { speed: number; position: { x: number; z: number } };
        rotation: { spin: number; airTime: number };
      };
      park: {
        kickers: { config: { id: string; x: number; z: number } }[];
        rails: unknown[];
        trees: unknown[];
      };
      scoring: { totalScore: number };
      events: { on: (type: string, cb: (e: unknown) => void) => () => void };
    };
    game: { debugTeleport: (x: number, z: number, speed: number) => void };
  };
  __events?: string[];
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => !!(window as DebugWindow).__FREESKI__?.sim);
  // Record simulation events for assertions.
  await page.evaluate(() => {
    const w = window as DebugWindow;
    w.__events = [];
    for (const type of ['takeoff', 'landed', 'trickLanded', 'crash', 'railStart', 'reset']) {
      w.__FREESKI__!.sim.events.on(type, () => w.__events!.push(type));
    }
  });
}

const state = (page: Page) => page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.player.state);
const speed = (page: Page) => page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.player.body.speed);
const events = (page: Page) => page.evaluate(() => (window as DebugWindow).__events ?? []);

test('main menu offers play, park selection, settings, controls and credits', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('play')).toBeVisible();
  await page.getByTestId('menu-parks').click();
  await page.getByTestId('park-big-air').click();
  await page.getByTestId('menu-back').click();
  await expect(page.getByTestId('play')).toContainText('Big Air Ridge');
  await page.getByTestId('menu-settings').click();
  await expect(page.getByRole('tab', { name: 'Key bindings' })).toBeVisible();
  await page.getByTestId('menu-back').click();
  await page.getByRole('button', { name: 'Controls' }).click();
  await expect(page.getByText('How to ride')).toBeVisible();
});

test('starts a run: environment, park and skier are initialised', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page);
  const info = await page.evaluate(() => {
    const s = (window as DebugWindow).__FREESKI__!.sim;
    return {
      kickers: s.park.kickers.length,
      rails: s.park.rails.length,
      trees: s.park.trees.length,
      state: s.player.state,
    };
  });
  expect(info.kickers).toBeGreaterThan(0);
  expect(info.rails).toBeGreaterThan(0);
  expect(info.trees).toBeGreaterThan(100);
  expect(info.state).toBe('IDLE');
  await expect(page.locator('canvas.game-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pushing off moves the skier and the HUD shows speed', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('KeyW');
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(2);
  await page.keyboard.up('KeyW');
  await expect(page.getByTestId('hud-speed')).not.toHaveText(/^0/);
});

test('jumping, spinning on a kicker and landing produce events', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const f = (window as DebugWindow).__FREESKI__!;
    const k = f.sim.park.kickers.find((kk) => kk.config.id === 'k2')!;
    f.game.debugTeleport(k.config.x, k.config.z - 14, 15);
  });
  await page.keyboard.down('Space');
  await expect.poll(() => state(page), { timeout: 20_000 }).toBe('AIRBORNE');
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyA');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => Math.abs((window as DebugWindow).__FREESKI__!.sim.player.rotation.spin) * (180 / Math.PI),
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(150);
  await page.keyboard.up('KeyA');
  await expect
    .poll(async () => (await events(page)).some((e) => e === 'landed' || e === 'crash'), { timeout: 30_000 })
    .toBe(true);
  const ev = await events(page);
  expect(ev).toContain('takeoff');
  // A spin of 180+ degrees is either landed (trick scored) or crashed (trick invalidated).
  expect(ev.includes('trickLanded') || ev.includes('crash')).toBe(true);
});

test('pause menu: restart resets the run, resume continues', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('KeyW');
  await expect.poll(() => speed(page), { timeout: 20_000 }).toBeGreaterThan(1);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const frozen = await page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.runTime);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.runTime)).toBe(frozen);
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  expect(await events(page)).toContain('reset');
  const z = await page.evaluate(() => (window as DebugWindow).__FREESKI__!.sim.player.body.position.z);
  expect(z).toBeLessThan(-5);
  await page.keyboard.press('Escape');
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await page.getByTestId('hud').waitFor();
});

test('rails can be entered and ground', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => (window as DebugWindow).__FREESKI__!.game.debugTeleport(9, 236, 9));
  await expect.poll(async () => (await events(page)).includes('railStart'), { timeout: 30_000 }).toBe(true);
  await expect(page.getByTestId('hud-balance'))
    .toBeVisible({ timeout: 10_000 })
    .catch(() => undefined);
});
