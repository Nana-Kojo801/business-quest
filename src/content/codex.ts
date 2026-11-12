/** Terms for the Codex. Unlocked by quests; written plainly, with where you met them. */
export interface CodexEntry {
  id: string;
  term: string;
  /** Other names a business graduate would use. */
  aka?: string;
  definition: string;
  seenIt: string;
}

export const CODEX: CodexEntry[] = [
  {
    id: 'willingness-to-pay',
    term: 'Willingness to pay',
    aka: 'Reservation price',
    definition: 'The most a buyer would pay for something. Below it they buy; above it they walk away.',
    seenIt: "The coins the Ledger Lens showed above each villager's head.",
  },
  {
    id: 'demand',
    term: 'Demand',
    aka: 'Quantity demanded',
    definition: 'How much of something buyers want at each price. As the price rises, fewer people want to buy.',
    seenIt: "Each time you raised Mira's price, fewer hands went up.",
  },
  {
    id: 'supply',
    term: 'Supply',
    aka: 'Quantity supplied',
    definition: 'How much of something sellers have to offer.',
    seenIt: "Mira's basket: five sunpeaches, then only three after the storm.",
  },
  {
    id: 'equilibrium',
    term: 'Equilibrium price',
    aka: 'Market-clearing price',
    definition: 'The price at which the amount buyers want equals the amount for sale. Everything sells, and nobody willing to pay that price goes without.',
    seenIt: 'The price where exactly as many villagers wanted a peach as Mira had.',
  },
  {
    id: 'shortage',
    term: 'Shortage',
    aka: 'Excess demand',
    definition: 'When the price is below equilibrium, more people want to buy than there is to sell, so some go without.',
    seenIt: 'Pricing too low: a crowd of eager hands, and some villagers leaving cross and empty-handed.',
  },
  {
    id: 'surplus',
    term: 'Surplus',
    aka: 'Excess supply',
    definition: 'When the price is above equilibrium, there is more for sale than people want, so goods are left over.',
    seenIt: 'Pricing too high: peaches left on the counter, going soft.',
  },
  {
    id: 'supply-shift',
    term: 'A fall in supply',
    definition: 'When there is less to sell but buyers want it just as much, the equilibrium price rises.',
    seenIt: "After the storm, Mira's price had to go up to match her smaller basket.",
  },
];
