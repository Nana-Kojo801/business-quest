import { test, expect, type Page } from '@playwright/test';

type Debug = {
  frames: number;
  player: { x: number; z: number };
  quality: { tier: string; scale: number; pixelRatio: number };
  passes: string[];
};
const readDebug = (page: Page) => page.evaluate(() => (window as unknown as { __bq: Debug }).__bq);

// CI and this test machine render on the CPU, so tests use the cheapest tier
// unless they are testing tiers, and turn off adaptive changes for stability.
async function load(page: Page, query = '?quality=low&adaptive=0', minFrames = 10) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/' + query);
  await expect.poll(async () => (await readDebug(page))?.frames ?? 0, { timeout: 40_000 }).toBeGreaterThan(minFrames);
  return errors;
}

async function distinctColours(page: Page) {
  const png = await page.locator('#app canvas').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, png.toString('base64'));
}

test('loads and renders a non-blank frame without errors', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await load(page);
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();

  const box = (await canvas.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);

  // A rendered scene has many distinct colours; a blank or failed canvas has one or two.
  expect(await distinctColours(page)).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});

test('phone layout is portrait', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait');
  await load(page);
  const vp = page.viewportSize()!;
  expect(vp.height).toBeGreaterThan(vp.width);
});

test('keyboard moves the player', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await load(page);
  const before = await readDebug(page);
  // Hold the key until the player has moved. No fixed wait: CI renders on a slow CPU.
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await readDebug(page)).player.z, { timeout: 20_000 }).toBeLessThan(before.player.z - 0.3);
  await page.keyboard.up('KeyW');
});

test('touch drag moves the player', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait');
  await load(page);
  const vp = page.viewportSize()!;
  const before = await readDebug(page);
  const x = vp.width / 2;
  const y = vp.height * 0.8;
  const touch = (type: string, cx: number) =>
    page.evaluate(({ type, cx, y }) => {
      document.querySelector('#app canvas')!.dispatchEvent(
        new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, isPrimary: true }),
      );
    }, { type, cx, y });
  // Drag to the right and hold until the player has moved.
  await touch('pointerdown', x);
  await touch('pointermove', x + 80);
  await expect.poll(async () => (await readDebug(page)).player.x, { timeout: 20_000 }).toBeGreaterThan(before.player.x + 0.3);
  await touch('pointerup', x + 80);
});

test.describe('quality tiers', () => {
  // Correctness, not speed: a small viewport keeps the CPU renderer used in CI fast.
  test.use({ viewport: { width: 270, height: 480 }, deviceScaleFactor: 1 });
  // Device-independent: run once (phone project), skipping before any browser page starts.
  test.skip(({ isMobile }) => !isMobile, 'runs on the phone project only');

  for (const tier of ['low', 'medium', 'high'] as const) {
  test(`renders on the ${tier} quality tier`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors = await load(page, `?quality=${tier}&adaptive=0`, 3);
    const d = await readDebug(page);
    expect(d.quality.tier).toBe(tier);
    // Low skips the painterly pass; the others render scene, painterly, final.
    expect(d.passes.length).toBe(tier === 'low' ? 2 : 3);
    expect(await distinctColours(page)).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });
  }
});

test('picks a starting tier by device and shows the debug overlay', async ({ page }, info) => {
  test.setTimeout(60_000);
  await load(page, '?debug=1&adaptive=0', 3);
  const d = await readDebug(page);
  expect(d.quality.tier).toBe(info.project.name === 'phone-portrait' ? 'medium' : 'high');
  await expect(page.getByTestId('debug-overlay')).toContainText('fps');
});

test.describe('sky', () => {
  test.use({ viewport: { width: 270, height: 480 }, deviceScaleFactor: 1 });
  test.skip(({ isMobile }) => !isMobile, 'runs on the phone project only');

  for (const sky of ['goldenHour', 'day', 'dusk']) {
    test(`${sky} sky renders a gradient above the horizon`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = await load(page, `?quality=low&adaptive=0&sky=${sky}`, 3);
      const png = await page.locator('#app canvas').screenshot();
      // Average colour of a strip near the top of the screen and one just above the horizon.
      const [top, low] = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const avg = (y0: number, y1: number) => {
          const d = ctx.getImageData(0, Math.floor(img.height * y0), img.width, Math.floor(img.height * (y1 - y0))).data;
          const s = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
          return s.map((v) => v / (d.length / 4));
        };
        return [avg(0.0, 0.06), avg(0.28, 0.33)];
      }, png.toString('base64'));
      // The sky is not one flat colour: the top and the horizon band clearly differ.
      const diff = Math.abs(top[0] - low[0]) + Math.abs(top[1] - low[1]) + Math.abs(top[2] - low[2]);
      expect(diff).toBeGreaterThan(25);
      expect(errors).toEqual([]);
    });
  }
});

test('walking toward the lake shows water', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
  test.setTimeout(90_000);
  const errors = await load(page, '?quality=low&adaptive=0', 3);
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await readDebug(page)).player.x, { timeout: 60_000 }).toBeLessThan(-5);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  const png = await page.locator('#app canvas').screenshot();
  // Count clearly blue pixels (water) in the left half of the screen.
  const blueShare = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, Math.floor(img.width / 2), img.height).data;
    let blue = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 30 && d[i + 2] > d[i + 1] - 10) blue++;
    return blue / (d.length / 4);
  }, png.toString('base64'));
  expect(blueShare).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
