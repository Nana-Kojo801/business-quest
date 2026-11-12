import type { PlayerId } from './types';

/**
 * Everything that can change game state goes through a command.
 * Locally, commands come from the input layer; later they can also arrive from
 * the network. The simulation never reads devices directly.
 */
export type Command =
  | { type: 'join'; playerId: PlayerId; x: number; z: number }
  | { type: 'leave'; playerId: PlayerId }
  | { type: 'move'; playerId: PlayerId; x: number; z: number };
