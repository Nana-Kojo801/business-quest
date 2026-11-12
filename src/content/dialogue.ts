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
