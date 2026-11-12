import { NPCS, settle, type MarketResult } from '../core';
import { CODEX, type CodexEntry } from '../content/codex';
import { SCRIPTS, type Script } from '../content/dialogue';
import { MARKET_ROUNDS, PRICE_MAX, PRICE_MIN, SHOPPERS } from '../content/market';
import type { Objective } from '../ui/hud';
import type { QuestView } from '../ui/menu';

/**
 * The opening quests, as a small state machine:
 *   meet      - talk to both villagers
 *   return    - go back to the keeper, who gives the Ledger Lens
 *   market    - help Mira set her price (two mornings: before and after the storm)
 *   debrief   - tell the keeper what you learned (unlocks the Codex entries)
 *   done
 * The general quest engine (#18) will replace this hand-written flow.
 */
export type Stage = 'meet' | 'return' | 'market' | 'debrief' | 'done';

export class FirstQuests {
  stage: Stage = 'meet';
  readonly met = new Set<string>();
  /** Market mornings completed (0, 1 or 2). */
  roundsDone = 0;
  readonly limits = SHOPPERS.map((s) => s.limit);
  readonly seeds = SHOPPERS.map((s) => s.seed);

  /** Jump to a stage (debug / tests): fills in everything that comes before it. */
  skipTo(stage: Stage) {
    const order: Stage[] = ['meet', 'return', 'market', 'debrief', 'done'];
    if (order.indexOf(stage) >= order.indexOf('return')) NPCS.forEach((n) => this.met.add(n.id));
    if (order.indexOf(stage) >= order.indexOf('debrief')) this.roundsDone = MARKET_ROUNDS.length;
    this.stage = stage;
  }

  /** Which conversation a villager starts, and what to do when it ends. */
  conversation(npcId: string): { script: Script; after: 'none' | 'giveLens' | 'startMarket' | 'finish' } {
    const s = this.stage;
    if (npcId === 'merchant') {
      if (s === 'market') return { script: SCRIPTS.merchantQuest, after: 'startMarket' };
      if (s === 'debrief' || s === 'done') return { script: SCRIPTS.merchantAfter, after: 'none' };
      return { script: SCRIPTS.merchant, after: 'none' };
    }
    if (s === 'meet') return { script: this.met.has('keeper') && !this.met.has('merchant') ? SCRIPTS.keeperMeetFirst : SCRIPTS.keeper, after: 'none' };
    if (s === 'return') return { script: SCRIPTS.keeperQuest, after: 'giveLens' };
    if (s === 'market') return { script: SCRIPTS.keeperWaiting, after: 'none' };
    if (s === 'debrief') return { script: SCRIPTS.keeperDebrief, after: 'finish' };
    return { script: SCRIPTS.keeperAfter, after: 'none' };
  }

  /** Called after any conversation ends. Returns a banner to show, if any. */
  talked(npcId: string, after: string): { sub: string; title: string } | null {
    this.met.add(npcId);
    if (this.stage === 'meet' && this.met.size >= NPCS.length) this.stage = 'return';
    if (after === 'giveLens') {
      this.stage = 'market';
      return { sub: 'New quest', title: 'The Peach Problem' };
    }
    if (after === 'finish') {
      this.stage = 'done';
      return { sub: 'Quest complete', title: 'The Peach Problem' };
    }
    return null;
  }

  get round() {
    const r = MARKET_ROUNDS[Math.min(this.roundsDone, MARKET_ROUNDS.length - 1)];
    return { ...r, limits: this.limits, min: PRICE_MIN, max: PRICE_MAX, day: this.roundsDone === 0 ? 'Morning one' : 'After the storm' };
  }

  play(price: number): MarketResult {
    return settle(price, this.round.supply, this.limits);
  }

  /** Mira's reaction to a morning's trading. */
  reaction(r: MarketResult): string {
    if (r.cleared) {
      return this.roundsDone === 0
        ? 'Every peach sold, and not one person who wanted one at that price went home without. I have never seen the square so calm!'
        : 'Only three peaches, and still: all sold, no sour faces. The price had to climb to meet the smaller basket.';
    }
    if (r.shortage > 0) {
      return `Gone in a blink! ${r.wanting} people wanted one, but I only had ${r.supply}. ${r.shortage === 1 ? 'One' : r.shortage} went home empty-handed and cross. Maybe I was too cheap?`;
    }
    return `Hmm. Only ${r.sold} sold. ${r.surplus === 1 ? 'One peach is' : `${r.surplus} peaches are`} left going soft. Too dear for most of them, I think.`;
  }

  /** A cleared morning moves the quest on. Returns what comes next. */
  advanceMarket(): 'storm' | 'complete' {
    this.roundsDone++;
    if (this.roundsDone >= MARKET_ROUNDS.length) {
      this.stage = 'debrief';
      return 'complete';
    }
    return 'storm';
  }

  objective(): Objective {
    switch (this.stage) {
      case 'meet':
        return { title: 'First Steps', text: `Meet the people of Sunmeadow (${this.met.size}/${NPCS.length})` };
      case 'return':
        return { title: 'First Steps', text: 'Return to Keeper Aldous at the Ledger Spire' };
      case 'market':
        return { title: 'The Peach Problem', text: this.roundsDone === 0 ? "Help Mira set today's sunpeach price" : 'Help Mira set her price after the storm' };
      case 'debrief':
        return { title: 'The Peach Problem', text: 'Tell Keeper Aldous what you learned' };
      default:
        return { title: 'Sunmeadow', text: 'Explore the vale. More ledgers await.' };
    }
  }

  journal(): QuestView {
    if (this.stage === 'meet' || this.stage === 'return') {
      return {
        title: 'First Steps',
        description: 'You have arrived in the valley of Sunmeadow. Get to know the people who live here.',
        steps: [
          { text: 'Talk to Mira at the market stall', done: this.met.has('merchant') },
          { text: 'Talk to Keeper Aldous by the Ledger Spire', done: this.met.has('keeper') },
          ...(this.stage === 'return' ? [{ text: 'Return to Keeper Aldous', done: false }] : []),
        ],
      };
    }
    return {
      title: 'The Peach Problem',
      description: "Every morning, chaos at Mira's stall. The Keeper believes there is a price where her market finds its balance.",
      steps: [
        { text: 'Receive the Ledger Lens', done: true },
        { text: "Set the price for Mira's five sunpeaches", done: this.roundsDone >= 1 },
        { text: 'Set the price after the storm', done: this.roundsDone >= 2 },
        { text: 'Tell Keeper Aldous what you learned', done: this.stage === 'done' },
      ],
    };
  }

  codex(): CodexEntry[] {
    return this.stage === 'done' ? CODEX : [];
  }
}
