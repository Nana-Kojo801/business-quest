import { test, expect, type Page } from '@playwright/test';

type Debug = {
  camera: { yaw: number; pitch: number; distance: number };
  actionTarget: string | null;
  interaction: { targetId: string; tick: number } | null;
  mode: 'explore' | 'dialogue' | 'menu';
  objective: string;
  met: string[];
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

/**
 * Run pixel analysis on a screenshot in a fresh, idle page. The game page's main
 * thread is busy rendering (slowly, on CI's CPU renderer), so work queued there can
 * time out; a separate browser context runs in its own process.
 */
async function inIdlePage<T>(page: Page, fn: (b64: string) => Promise<T>, arg: string): Promise<T> {
  const browser = page.context().browser()!;
  const ctx = await browser.newContext();
  try {
    const idle = await ctx.newPage();
    return await idle.evaluate(fn, arg);
  } finally {
    await ctx.close();
  }
}

async function distinctColours(page: Page) {
  const png = await page.locator('#app canvas').screenshot();
  return inIdlePage(page, async (b64: string) => {
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
  // The first test in each project pays for compiling every shader on CI's CPU renderer; if it
  // runs out of time mid-way, the shared browser is left broken for the tests after it.
  test.setTimeout(120_000);
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

/** Dispatch a touch pointer event on the controls surface. */
const touch = (page: Page, type: string, x: number, y: number, id = 7) =>
  page.evaluate(({ type, x, y, id }) => {
    document.querySelector('#controls')!.dispatchEvent(
      new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 7 }),
    );
  }, { type, x, y, id });

test('touch joystick (lower left) moves the player', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait');
  await load(page);
  const vp = page.viewportSize()!;
  const before = await readDebug(page);
  const x = vp.width * 0.25;
  const y = vp.height * 0.8;
  await touch(page, 'pointerdown', x, y);
  await expect(page.getByTestId('joystick')).toBeVisible();
  // Push the stick to the right and hold until the player has moved.
  await touch(page, 'pointermove', x + 60, y);
  await expect.poll(async () => (await readDebug(page)).player.x, { timeout: 20_000 }).toBeGreaterThan(before.player.x + 0.3);
  await touch(page, 'pointerup', x + 60, y);
});

test('dragging on the right turns the camera; pinch zooms', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait');
  await load(page);
  const vp = page.viewportSize()!;
  const before = await readDebug(page);
  await touch(page, 'pointerdown', vp.width * 0.75, vp.height * 0.4);
  for (let i = 1; i <= 5; i++) await touch(page, 'pointermove', vp.width * 0.75 - i * 30, vp.height * 0.4);
  await touch(page, 'pointerup', vp.width * 0.75 - 150, vp.height * 0.4);
  await expect.poll(async () => Math.abs((await readDebug(page)).camera.yaw - before.camera.yaw), { timeout: 20_000 }).toBeGreaterThan(0.3);
  // Pinch out (fingers apart) zooms in.
  const d0 = (await readDebug(page)).camera.distance;
  await touch(page, 'pointerdown', vp.width * 0.5, vp.height * 0.3, 8);
  await touch(page, 'pointerdown', vp.width * 0.5, vp.height * 0.4, 9);
  for (let i = 1; i <= 5; i++) {
    await touch(page, 'pointermove', vp.width * 0.5, vp.height * 0.3 - i * 15, 8);
    await touch(page, 'pointermove', vp.width * 0.5, vp.height * 0.4 + i * 15, 9);
  }
  await touch(page, 'pointerup', 0, 0, 8);
  await touch(page, 'pointerup', 0, 0, 9);
  await expect.poll(async () => (await readDebug(page)).camera.distance, { timeout: 20_000 }).toBeLessThan(d0 - 0.5);
});

test('mouse drag orbits and the wheel zooms', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await load(page);
  const before = await readDebug(page);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await readDebug(page)).camera.yaw - before.camera.yaw), { timeout: 20_000 }).toBeGreaterThan(0.2);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await readDebug(page)).camera.distance, { timeout: 20_000 }).toBeGreaterThan(before.camera.distance + 0.5);
});

// Spawn 1.4 m in front of the keeper (see src/core/npcs.ts).
const NEAR_KEEPER = '?quality=low&adaptive=0&spawn=7.66,-22.17';

test('talking to a villager opens a conversation that can be read through to the end', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = await load(page, NEAR_KEEPER, 3);
  await expect.poll(async () => (await readDebug(page)).actionTarget, { timeout: 20_000 }).toBe('keeper');
  if (info.project.name === 'desktop') {
    await expect(page.getByTestId('action-prompt')).toHaveClass(/show/);
    await page.keyboard.press('KeyE');
  } else {
    const button = page.getByTestId('action-button');
    await expect(button).toHaveClass(/show/);
    await button.dispatchEvent('pointerdown');
  }
  await expect.poll(async () => (await readDebug(page)).mode, { timeout: 20_000 }).toBe('dialogue');
  const dialogue = page.getByTestId('dialogue');
  await expect(dialogue).toHaveClass(/open/);
  // Tap to finish typing; the first line offers choices.
  await dialogue.dispatchEvent('pointerdown');
  await expect(page.getByTestId('choice-1')).toBeVisible();
  await page.getByTestId('choice-1').dispatchEvent('pointerdown'); // "What is this tower?"
  await expect(page.getByTestId('dialogue-text')).not.toBeEmpty();
  // Keep tapping until the conversation ends.
  for (let i = 0; i < 12 && (await readDebug(page)).mode === 'dialogue'; i++) {
    await dialogue.dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await readDebug(page)).mode, { timeout: 20_000 }).toBe('explore');
  const d = await readDebug(page);
  expect(d.met).toContain('keeper');
  expect(d.objective).toContain('(1/2)');
  await expect(page.getByTestId('objective')).toContainText('(1/2)');
  expect(errors).toEqual([]);
});

test('the menu opens, shows the journal, and remembers settings', async ({ page }) => {
  test.setTimeout(60_000);
  await load(page);
  await page.getByTestId('menu-button').dispatchEvent('pointerdown');
  await expect(page.getByTestId('menu')).toHaveClass(/open/);
  await expect(page.getByTestId('menu')).toContainText('First Steps');
  expect((await readDebug(page)).mode).toBe('menu');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('fps-setting').check();
  await expect(page.getByTestId('debug-overlay')).toBeVisible();
  await page.getByTestId('menu-close').click();
  await expect(page.getByTestId('menu')).not.toHaveClass(/open/);
  expect((await readDebug(page)).mode).toBe('explore');
  // Settings survive a reload.
  await page.reload();
  await expect.poll(async () => (await readDebug(page))?.frames ?? 0, { timeout: 40_000 }).toBeGreaterThan(2);
  await expect(page.getByTestId('debug-overlay')).toBeVisible();
});

test('no action is offered away from villagers', async ({ page }) => {
  await load(page);
  expect((await readDebug(page)).actionTarget).toBeNull();
  await expect(page.getByTestId('action-button')).not.toHaveClass(/show/);
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
    // Only high adds the painterly pass; low and medium render scene, final.
    expect(d.passes.length).toBe(tier === 'high' ? 3 : 2);
    expect(await distinctColours(page)).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });
  }
});

test.describe('starting tier', () => {
  // Only the device type matters here; a small viewport keeps the CPU renderer responsive.
  test.use({ viewport: { width: 270, height: 480 } });

  test('picks a starting tier by device and shows the debug overlay', async ({ page }, info) => {
    test.setTimeout(60_000);
    await load(page, '?debug=1&adaptive=0', 3);
    const d = await readDebug(page);
    expect(d.quality.tier).toBe(info.project.name === 'phone-portrait' ? 'medium' : 'high');
    await expect(page.getByTestId('debug-overlay')).toContainText('fps');
  });
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
      const [top, low] = await inIdlePage(page, async (b64: string) => {
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
  test.setTimeout(180_000);
  const errors = await load(page, '?quality=low&adaptive=0', 3);
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await readDebug(page)).player.x, { timeout: 150_000 }).toBeLessThan(-5);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  const png = await page.locator('#app canvas').screenshot();
  // Count clearly blue pixels (water) in the left half of the screen.
  const blueShare = await inIdlePage(page, async (b64: string) => {
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

test.describe('the first quest', () => {
  test.use({ viewport: { width: 360, height: 700 } });

  test('help Mira price her peaches: shortage, then balance, then the storm, then the debrief', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one run is enough (desktop for keyboard)');
    test.setTimeout(300_000);
    const errors = await load(page, '?quality=low&adaptive=0&quest=market&spawn=5.16,-6.28', 3);
    const dbg = () => readDebug(page) as Promise<Debug & { stage: string; pricingOpen: boolean; marketPlaying: boolean }>;
    const tapThrough = async (until: () => Promise<boolean>) => {
      for (let i = 0; i < 20 && !(await until()); i++) {
        await page.getByTestId('dialogue').dispatchEvent('pointerdown');
        await page.waitForTimeout(150);
      }
    };
    const setPrice = async (p: number) => {
      await page.getByTestId('price-range').fill(String(p));
      await expect(page.getByTestId('price-value')).toContainText(String(p));
    };
    const openAndWait = async () => {
      await page.getByTestId('open-stall').click();
      await expect.poll(async () => (await dbg()).marketPlaying, { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => (await dbg()).marketPlaying, { timeout: 120_000 }).toBe(false);
      await expect(page.getByTestId('price-result')).toBeVisible();
    };

    // Mira asks for help.
    await expect.poll(async () => (await dbg()).actionTarget, { timeout: 20_000 }).toBe('merchant');
    await page.keyboard.press('KeyE');
    await tapThrough(async () => (await dbg()).pricingOpen);
    await expect(page.getByTestId('pricing')).toHaveClass(/open/);

    // Too cheap: a shortage; the Lens shows who would buy.
    await setPrice(4);
    await expect(page.getByTestId('lens-tag-1')).toHaveClass(/on/); // limit 12
    await expect(page.getByTestId('lens-tag-2')).not.toHaveClass(/on/); // limit 3
    await openAndWait();
    await expect(page.getByTestId('price-result')).toContainText('Not enough peaches');
    await page.getByTestId('result-next').click();

    // The balancing price.
    await setPrice(7);
    await openAndWait();
    await expect(page.getByTestId('price-result')).toContainText('Every peach sold');
    await page.getByTestId('result-next').click();

    // The storm: three peaches; the old price leaves people without.
    await tapThrough(async () => (await dbg()).pricingOpen && (await page.getByTestId('open-stall').count()) > 0);
    await setPrice(7);
    await openAndWait();
    await expect(page.getByTestId('price-result')).toContainText('Not enough peaches');
    await page.getByTestId('result-next').click();
    await setPrice(9);
    await openAndWait();
    await expect(page.getByTestId('price-result')).toContainText('Every peach sold');
    await page.getByTestId('result-next').click();
    await tapThrough(async () => (await dbg()).mode === 'explore');
    await expect.poll(async () => (await dbg()).stage, { timeout: 20_000 }).toBe('debrief');
    expect(errors).toEqual([]);
  });

  test('the debrief completes the quest and fills the Codex', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    test.setTimeout(120_000);
    await load(page, '?quality=low&adaptive=0&quest=debrief&spawn=7.66,-22.17', 3);
    await expect.poll(async () => (await readDebug(page)).actionTarget, { timeout: 20_000 }).toBe('keeper');
    await page.keyboard.press('KeyE');
    await expect(page.getByTestId('dialogue')).toHaveClass(/open/);
    for (let i = 0; i < 20 && (await readDebug(page)).mode !== 'explore'; i++) {
      await page.getByTestId('dialogue').dispatchEvent('pointerdown');
      if (await page.getByTestId('choice-1').isVisible()) await page.getByTestId('choice-1').dispatchEvent('pointerdown');
      await page.waitForTimeout(150);
    }
    await expect.poll(async () => ((await readDebug(page)) as Debug & { stage: string }).stage, { timeout: 20_000 }).toBe('done');
    await page.getByTestId('menu-button').dispatchEvent('pointerdown');
    await page.getByTestId('tab-codex').click();
    await expect(page.getByTestId('codex')).toContainText('Equilibrium price');
    await expect(page.getByTestId('codex')).toContainText('Shortage');
  });
});

test('loading screen fades away, and sound starts on the first tap', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?quality=low&adaptive=0');
  await expect(page.getByTestId('loading')).toBeAttached();
  await expect(page.getByTestId('loading')).not.toBeAttached({ timeout: 60_000 });
  expect(((await readDebug(page)) as Debug & { audio: string }).audio).toBe('locked');
  await page.mouse.click(400, 300);
  await expect.poll(async () => ((await readDebug(page)) as Debug & { audio: string }).audio, { timeout: 10_000 }).toBe('running');
  // Walk a bit with sound running (footsteps, ambience): no errors.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});
