import { describe, expect, it } from 'vitest';
import { clearingPrices, settle, wantingAt } from '../../src/core';
import { MARKET_ROUNDS, SHOPPERS } from '../../src/content/market';

const limits = [12, 10, 9, 8, 7, 6, 4, 3];

describe('market', () => {
  it('fewer people want to buy as the price rises', () => {
    let last = Infinity;
    for (let p = 1; p <= 14; p++) {
      const w = wantingAt(p, limits);
      expect(w).toBeLessThanOrEqual(last);
      last = w;
    }
  });

  it('too cheap: shortage, some go without, all sold', () => {
    const r = settle(4, 5, limits);
    expect(r).toMatchObject({ wanting: 7, sold: 5, shortage: 2, surplus: 0, cleared: false, revenue: 20 });
    expect(r.missedOut).toHaveLength(2);
  });

  it('too dear: surplus left over', () => {
    const r = settle(10, 5, limits);
    expect(r).toMatchObject({ wanting: 2, sold: 2, shortage: 0, surplus: 3, cleared: false, revenue: 20 });
  });

  it('at the clearing price everything sells and nobody who wants one misses out', () => {
    const r = settle(7, 5, limits);
    expect(r).toMatchObject({ wanting: 5, sold: 5, shortage: 0, surplus: 0, cleared: true, revenue: 35 });
  });

  it('the quest rounds each have exactly one clearing price, and less supply means a higher price', () => {
    const wtps = SHOPPERS.map((s) => s.limit);
    const prices = MARKET_ROUNDS.map((r) => clearingPrices(r.supply, wtps));
    for (const p of prices) expect(p).toHaveLength(1);
    expect(prices[1][0]).toBeGreaterThan(prices[0][0]);
  });
});

describe('first quests flow', () => {
  it('meet both, return, market (two mornings), debrief, done', async () => {
    const { FirstQuests } = await import('../../src/quests/firstQuests');
    const q = new FirstQuests();
    expect(q.stage).toBe('meet');
    q.talked('merchant', q.conversation('merchant').after);
    expect(q.stage).toBe('meet');
    q.talked('keeper', q.conversation('keeper').after);
    expect(q.stage).toBe('return');
    expect(q.conversation('keeper').after).toBe('giveLens');
    q.talked('keeper', 'giveLens');
    expect(q.stage).toBe('market');
    expect(q.conversation('merchant').after).toBe('startMarket');
    expect(q.play(4).cleared).toBe(false);
    expect(q.play(7).cleared).toBe(true);
    expect(q.advanceMarket()).toBe('storm');
    expect(q.round.supply).toBe(3);
    expect(q.play(7).shortage).toBeGreaterThan(0);
    expect(q.play(9).cleared).toBe(true);
    expect(q.advanceMarket()).toBe('complete');
    expect(q.stage).toBe('debrief');
    expect(q.codex()).toHaveLength(0);
    q.talked('keeper', q.conversation('keeper').after);
    expect(q.stage).toBe('done');
    expect(q.codex().length).toBeGreaterThan(5);
  });
});
