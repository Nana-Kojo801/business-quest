/**
 * Conversation scripts (data only). A script is a small graph of lines; a line
 * either continues to `next`, offers `choices`, or ends the conversation.
 * The full dialogue and quest engine (#18) will build on this format.
 */
export interface Choice {
  label: string;
  /** Line to go to; null ends the conversation. */
  next: string | null;
}

export interface Line {
  speaker: string;
  text: string;
  next?: string | null;
  choices?: Choice[];
}

export interface Script {
  start: string;
  lines: Record<string, Line>;
}

export const SPEAKERS = {
  merchant: 'Mira',
  keeper: 'Keeper Aldous',
};

export const SCRIPTS: Record<string, Script> = {
  merchant: {
    start: 'hello',
    lines: {
      hello: {
        speaker: SPEAKERS.merchant,
        text: "Oh! A new face in Sunmeadow. Welcome, traveller! Fresh fruit, fair prices, and the best gossip in the vale.",
        choices: [
          { label: "What's for sale?", next: 'wares' },
          { label: 'Fair prices?', next: 'fair' },
          { label: 'Just passing through.', next: 'bye' },
        ],
      },
      wares: {
        speaker: SPEAKERS.merchant,
        text: 'Sunpeaches, river plums, emberapples… The peaches are gone by noon. Everyone wants them, and I only get one basket a day.',
        next: 'wares2',
      },
      wares2: {
        speaker: SPEAKERS.merchant,
        text: "Funny thing: the fewer I have, the more people offer for them. Some mornings I could ask double and still sell out.",
        choices: [
          { label: 'Why not ask double, then?', next: 'fair' },
          { label: 'Good to know. Bye!', next: 'bye' },
        ],
      },
      fair: {
        speaker: SPEAKERS.merchant,
        text: "Fair to me and fair to you. Price too high, and you walk to the next stall. Too low, and I can't pay for tomorrow's basket.",
        next: 'bye',
      },
      bye: {
        speaker: SPEAKERS.merchant,
        text: "Safe travels! And if you head up the hill, say hello to the Keeper. They've been watching the road all morning.",
        next: null,
      },
    },
  },
  keeper: {
    start: 'hello',
    lines: {
      hello: {
        speaker: SPEAKERS.keeper,
        text: "Ah. So you're the one the wind has been whispering about.",
        choices: [
          { label: 'Whispering about me?', next: 'who' },
          { label: 'What is this tower?', next: 'tower' },
        ],
      },
      who: {
        speaker: SPEAKERS.keeper,
        text: 'Every few years someone wanders into the vale with that look in their eyes. Curious. Restless. Ready to learn.',
        next: 'tower',
      },
      tower: {
        speaker: SPEAKERS.keeper,
        text: 'This is the Ledger Spire. Long ago it kept the accounts of the whole vale: every coin, every promise, every debt. Lately… the numbers have stopped making sense.',
        next: 'task',
      },
      task: {
        speaker: SPEAKERS.keeper,
        text: 'Meet the people of Sunmeadow and get your bearings. When you are ready, come back to me. I may have a task worthy of you.',
        next: null,
      },
    },
  },
  keeperMeetFirst: {
    start: 'go',
    lines: {
      go: {
        speaker: SPEAKERS.keeper,
        text: 'Have you met Mira at the market stall yet? Go on. Every traveller should know where to find a good peach.',
        next: null,
      },
    },
  },
  // The keeper's task: the market is out of balance, and here is a tool to see why.
  keeperQuest: {
    start: 'back',
    lines: {
      back: {
        speaker: SPEAKERS.keeper,
        text: 'You have met the vale. Good. Then you have seen the market. Every morning, chaos at Mira\'s stall: shouting, sulking, peaches gone too fast or left to rot.',
        next: 'why',
      },
      why: {
        speaker: SPEAKERS.keeper,
        text: 'The Spire\'s old ledgers say a market can find its balance. A price where it all simply… works. Mira has never found it.',
        choices: [
          { label: 'How would I find it?', next: 'lens' },
          { label: 'Why does it matter?', next: 'matter' },
        ],
      },
      matter: {
        speaker: SPEAKERS.keeper,
        text: 'Too cheap, and people fight over too little. Too dear, and good fruit spoils while people go hungry. Either way, someone loses.',
        next: 'lens',
      },
      lens: {
        speaker: SPEAKERS.keeper,
        text: 'Take this: the Ledger Lens. Through it you will see what each person in a crowd is willing to give. Use it at Mira\'s stall, and help her set her price.',
        next: 'go',
      },
      go: {
        speaker: SPEAKERS.keeper,
        text: 'Return when the market is calm. I want to hear what you learn.',
        next: null,
      },
    },
  },
  keeperWaiting: {
    start: 'w',
    lines: {
      w: { speaker: SPEAKERS.keeper, text: "Mira's stall is waiting. Look through the Lens, and watch how the crowd answers each price.", next: null },
    },
  },
  merchantQuest: {
    start: 'hi',
    lines: {
      hi: {
        speaker: SPEAKERS.merchant,
        text: 'The Keeper sent you? Bless them. Five sunpeaches came in this morning, and look, the crowd is already gathering.',
        next: 'ask',
      },
      ask: {
        speaker: SPEAKERS.merchant,
        text: "I never know what to charge. Will you set today's price? Look through that Lens of yours and see how they answer.",
        next: null,
      },
    },
  },
  merchantStorm: {
    start: 'storm',
    lines: {
      storm: {
        speaker: SPEAKERS.merchant,
        text: 'That was the calmest morning in years! But… a storm came through last night. The wind stripped the orchard. Only three peaches today.',
        next: 'again',
      },
      again: {
        speaker: SPEAKERS.merchant,
        text: "Same folk, just as hungry for peaches. Will you set the price again? I don't think yesterday's will do.",
        next: null,
      },
    },
  },
  merchantDone: {
    start: 'thanks',
    lines: {
      thanks: {
        speaker: SPEAKERS.merchant,
        text: 'Fewer peaches, a higher price, and still not a single sour face. I think I finally understand my own stall. Thank you, truly.',
        next: 'keeper',
      },
      keeper: {
        speaker: SPEAKERS.merchant,
        text: "Go and tell the Keeper. And here, a peach for you. On the house. Don't tell the others.",
        next: null,
      },
    },
  },
  keeperDebrief: {
    start: 'calm',
    lines: {
      calm: {
        speaker: SPEAKERS.keeper,
        text: 'The market is quiet. Tell me, then. What did you find?',
        choices: [
          { label: 'Lower prices brought more buyers.', next: 'demand' },
          { label: 'There was one price where it all balanced.', next: 'balance' },
        ],
      },
      demand: {
        speaker: SPEAKERS.keeper,
        text: 'Yes. Raise the price and fewer hands go up. The ledgers call that demand: how much people want at each price.',
        next: 'balance',
      },
      balance: {
        speaker: SPEAKERS.keeper,
        text: 'And where the number who want to buy meets the number for sale, every peach sells and no willing buyer goes without. Merchants call it the equilibrium price. The market-clearing price.',
        next: 'storm',
      },
      storm: {
        speaker: SPEAKERS.keeper,
        text: 'Below it, a shortage. Above it, a surplus. And when the storm took peaches away, the balance moved up. Less supply, higher price.',
        next: 'end',
      },
      end: {
        speaker: SPEAKERS.keeper,
        text: 'I have written it all in your Codex. Keep it close, traveller. The vale has many more ledgers out of balance.',
        next: null,
      },
    },
  },
  keeperAfter: {
    start: 'a',
    lines: {
      a: { speaker: SPEAKERS.keeper, text: 'Supply, demand, and the price that balances them. A good first page in your ledger.', next: null },
    },
  },
  merchantAfter: {
    start: 'a',
    lines: {
      a: { speaker: SPEAKERS.merchant, text: 'Every peach sold, every face happy. I owe you a basket, friend.', next: null },
    },
  },
  keeperReturn: {
    start: 'soon',
    lines: {
      soon: {
        speaker: SPEAKERS.keeper,
        text: "You've met the vale's folk. Good. The task ahead needs a clear head and sharp eyes. Rest a moment, traveller. We begin soon.",
        next: null,
      },
    },
  },
};
