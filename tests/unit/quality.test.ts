import { describe, expect, it } from 'vitest';
import { QualityManager, TIER_SETTINGS, frameCap, initialTier, tierOverrides } from '../../src/render/quality';

const feed = (q: QualityManager, ms: number, totalMs: number) => {
  for (let t = 0; t < totalMs; t += ms) q.sample(ms);
};

describe('quality', () => {
  it('starts weak computers lower, so they are not rebuilt (a visible freeze) on the way down', () => {
    const p = new URLSearchParams('');
    const intel = 'ANGLE (Intel Inc., Intel(R) UHD Graphics 617, OpenGL 4.1)';
    expect(initialTier(p, false, { gpu: intel, memoryGB: 4 })).toBe('low');
    expect(initialTier(p, false, { gpu: intel, memoryGB: 8 })).toBe('medium');
    expect(initialTier(p, false, { gpu: 'Apple M1', memoryGB: 4 })).toBe('medium');
    expect(initialTier(p, false, { gpu: 'ANGLE (NVIDIA GeForce RTX 3060)', memoryGB: 8 })).toBe('high');
    expect(initialTier(p, false, {})).toBe('high');
    expect(initialTier(p, true, { gpu: intel, memoryGB: 2 })).toBe('medium');
    expect(initialTier(new URLSearchParams('quality=high'), false, { gpu: intel, memoryGB: 2 })).toBe('high');
  });

  it('reports the slowest frame, which the median hides', () => {
    const q = new QualityManager('low', false);
    for (let i = 0; i < 89; i++) q.sample(1000 / 60);
    q.sample(120); // one hitch
    feed(q, 1000 / 60, 100);
    expect(q.state.fps).toBe(60);
    expect(q.state.worstMs).toBe(120);
  });

  it('a frame cap counts as fast enough and never triggers a step down', () => {
    expect(frameCap(new URLSearchParams('fps=30'))).toBe(30);
    expect(frameCap(new URLSearchParams('fps=abc'))).toBe(0);
    const q = new QualityManager('medium', true, {}, 30);
    feed(q, 1000 / 30, 10000);
    expect(q.state).toMatchObject({ tier: 'medium', scale: 1 });
  });

  it('picks a starting tier from device type and URL', () => {
    expect(initialTier(new URLSearchParams(''), true)).toBe('medium');
    expect(initialTier(new URLSearchParams(''), false)).toBe('high');
    expect(initialTier(new URLSearchParams('quality=low'), false)).toBe('low');
    expect(initialTier(new URLSearchParams('quality=bogus'), true)).toBe('medium');
  });

  it('reports fps from the median frame time', () => {
    const q = new QualityManager('high', false);
    feed(q, 1000 / 60, 2000);
    expect(q.state.fps).toBe(60);
  });

  it('lowers resolution, then tier, when frames are slow', () => {
    const q = new QualityManager('high', true);
    const changes: string[] = [];
    q.onChange = (s, tierChanged) => changes.push(tierChanged ? `tier:${s.tier}` : `scale:${s.scale.toFixed(1)}`);
    feed(q, 40, 1600); // one slow window at 25 fps: not enough on its own
    expect(q.state.scale).toBe(1);
    feed(q, 40, 1600); // a second slow window in a row steps down
    expect(q.state.scale).toBeCloseTo(0.9);
    while (q.state.scale > TIER_SETTINGS.high.minScale + 1e-6) feed(q, 40, 1600);
    expect(q.state.tier).toBe('high');
    feed(q, 40, 3200);
    expect(q.state.tier).toBe('medium');
    expect(q.state.scale).toBe(1);
    expect(changes).toContain('tier:medium');
  });

  it('never drops below low and recovers resolution when fast', () => {
    const q = new QualityManager('low', true);
    feed(q, 100, 1600 * 10);
    expect(q.state.tier).toBe('low');
    expect(q.state.scale).toBeCloseTo(TIER_SETTINGS.low.minScale);
    feed(q, 10, 1600 * 20);
    expect(q.state.scale).toBe(1);
    expect(q.state.tier).toBe('low'); // tiers never rise automatically
  });

  it('ignores hitches from hidden tabs', () => {
    const q = new QualityManager('high', true);
    feed(q, 1000, 20000);
    expect(q.state.scale).toBe(1);
  });

  it('does not adapt when adaptive is off', () => {
    const q = new QualityManager('high', false);
    feed(q, 100, 20000);
    expect(q.state).toMatchObject({ tier: 'high', scale: 1 });
  });

  it('a tier at its lowest resolution is never blurrier than the tier below', () => {
    expect(TIER_SETTINGS.high.maxPixelRatio * TIER_SETTINGS.high.minScale).toBeGreaterThan(TIER_SETTINGS.medium.maxPixelRatio);
    expect(TIER_SETTINGS.medium.maxPixelRatio * TIER_SETTINGS.medium.minScale).toBeGreaterThan(TIER_SETTINGS.low.maxPixelRatio);
  });

  it('caps pixel ratio per tier and applies scale', () => {
    const q = new QualityManager('medium', false);
    expect(q.pixelRatio(3)).toBe(TIER_SETTINGS.medium.maxPixelRatio);
    expect(q.pixelRatio(1)).toBe(1);
  });
});

describe('phone (medium) tier image budget', () => {
  it('has no smoothing filter and no MSAA (too costly in WebGL on phones: halved fps, #41)', () => {
    const m = TIER_SETTINGS.medium;
    expect(m.maxPixelRatio).toBeGreaterThanOrEqual(1.75);
    expect(m.multisampling).toBe(0);
    expect(m.painterlyRadius).toBe(0);
  });

  it('URL overrides change pixel ratio and MSAA for device testing, and ignore junk', () => {
    expect(tierOverrides(new URLSearchParams('dpr=1.5&msaa=4'))).toEqual({ maxPixelRatio: 1.5, multisampling: 4 });
    expect(tierOverrides(new URLSearchParams('dpr=abc&msaa=3'))).toEqual({});
    const q = new QualityManager('medium', false, tierOverrides(new URLSearchParams('dpr=1.25')));
    expect(q.pixelRatio(3)).toBe(1.25);
    expect(q.settings.grass).toEqual(TIER_SETTINGS.medium.grass);
  });

  it('grass has a dense near field and a wider, sparser ring', () => {
    for (const t of Object.values(TIER_SETTINGS)) {
      expect(t.grassFar.radius).toBeGreaterThan(t.grass.radius);
      expect(t.grassFar.count / t.grassFar.radius ** 2).toBeLessThan(t.grass.count / t.grass.radius ** 2);
    }
  });
});
