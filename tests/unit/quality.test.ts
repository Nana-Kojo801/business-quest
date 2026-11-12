import { describe, expect, it } from 'vitest';
import { QualityManager, TIER_SETTINGS, initialTier } from '../../src/render/quality';

const feed = (q: QualityManager, ms: number, totalMs: number) => {
  for (let t = 0; t < totalMs; t += ms) q.sample(ms);
};

describe('quality', () => {
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
    feed(q, 40, 1600); // one evaluation at 25 fps
    expect(q.state.scale).toBeCloseTo(0.9);
    while (q.state.scale > TIER_SETTINGS.high.minScale + 1e-6) feed(q, 40, 1600);
    expect(q.state.tier).toBe('high');
    feed(q, 40, 1600);
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
    expect(q.pixelRatio(3)).toBe(1.5);
    expect(q.pixelRatio(1)).toBe(1);
  });
});
