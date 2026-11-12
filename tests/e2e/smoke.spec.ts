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
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  const after = await readDebug(page);
  expect(after.player.z).toBeLessThan(before.player.z - 0.3);
});

test('touch drag moves the player', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait');
  await load(page);
  const vp = page.viewportSize()!;
  const before = await readDebug(page);
  const x = vp.width / 2;
  const y = vp.height * 0.8;
  // Dispatch pointer events as a touch pointer would (drag to the right).
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector('#app canvas')!;
    const ev = (type: string, cx: number) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, isPrimary: true }));
    ev('pointerdown', x);
    ev('pointermove', x + 80);
  }, { x, y });
  await page.waitForTimeout(400);
  await page.evaluate(({ x, y }) => {
    document.querySelector('#app canvas')!.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x + 80, clientY: y, bubbles: true }),
    );
  }, { x, y });
  const after = await readDebug(page);
  expect(after.player.x).toBeGreaterThan(before.player.x + 0.3);
});

test.describe('quality tiers', () => {
  // Correctness, not speed: a small viewport keeps the CPU renderer used in CI fast.
  test.use({ viewport: { width: 270, height: 480 }, deviceScaleFactor: 1 });

  for (const tier of ['low', 'medium', 'high'] as const) {
  test(`renders on the ${tier} quality tier`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-portrait', 'tier rendering is device-independent');
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
