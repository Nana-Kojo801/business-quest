/** The market-morning quest: who comes to Mira's stall, and how many peaches she has. */
export interface Shopper {
  /** The most this villager would pay for a sunpeach, in coins. */
  limit: number;
  /** Look variation seed. */
  seed: number;
}

// Arrival order matters: in a shortage the earliest in line are served, not the keenest.
export const SHOPPERS: Shopper[] = [
  { limit: 6, seed: 11 },
  { limit: 12, seed: 23 },
  { limit: 3, seed: 37 },
  { limit: 9, seed: 41 },
  { limit: 7, seed: 53 },
  { limit: 4, seed: 67 },
  { limit: 10, seed: 71 },
  { limit: 8, seed: 89 },
];

export interface MarketRound {
  supply: number;
  /** Price the dial starts on. */
  startPrice: number;
}

export const MARKET_ROUNDS: MarketRound[] = [
  { supply: 5, startPrice: 3 },
  { supply: 3, startPrice: 7 },
];

export const PRICE_MIN = 1;
export const PRICE_MAX = 14;
