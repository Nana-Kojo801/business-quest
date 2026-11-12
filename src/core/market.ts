/**
 * A tiny market: one seller with a fixed number of goods, buyers who each have a
 * most they'd pay. At a given price, everyone whose limit is at least the price
 * wants to buy. Pure and deterministic, so quests and tests agree.
 */
export interface MarketResult {
  price: number;
  supply: number;
  /** How many want to buy at this price (quantity demanded). */
  wanting: number;
  sold: number;
  revenue: number;
  /** Wanted one but went without (price below the clearing price). */
  shortage: number;
  /** Left unsold (price above the clearing price). */
  surplus: number;
  /** Indexes of buyers who got one (first in line wins when there are too few). */
  buyers: number[];
  /** Indexes of buyers who wanted one but missed out. */
  missedOut: number[];
  /** Quantity demanded equals quantity supplied. */
  cleared: boolean;
}

export function wantingAt(price: number, limits: readonly number[]): number {
  return limits.filter((w) => w >= price).length;
}

/**
 * Settle a day of trading. Buyers queue in arrival order (their index), so in a
 * shortage it's not the keenest who get served, just the earliest.
 */
export function settle(price: number, supply: number, limits: readonly number[]): MarketResult {
  const want = limits.map((w, i) => ({ w, i })).filter((b) => b.w >= price).map((b) => b.i);
  const buyers = want.slice(0, supply);
  const missedOut = want.slice(supply);
  const sold = buyers.length;
  return {
    price,
    supply,
    wanting: want.length,
    sold,
    revenue: sold * price,
    shortage: missedOut.length,
    surplus: supply - sold,
    buyers,
    missedOut,
    cleared: want.length === supply,
  };
}

/** All prices (in a range) where quantity demanded equals quantity supplied. */
export function clearingPrices(supply: number, limits: readonly number[], min = 1, max = 20): number[] {
  const out: number[] = [];
  for (let p = min; p <= max; p++) if (wantingAt(p, limits) === supply) out.push(p);
  return out;
}
