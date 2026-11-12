import type { Command, Simulation } from '../core';

/**
 * Where commands go. Single-player sends them straight into the local simulation.
 * A future network transport would send them to a server (or peers) instead,
 * and the rest of the game would not change.
 */
export interface CommandTransport {
  send(cmd: Command): void;
}

export class LocalTransport implements CommandTransport {
  constructor(private sim: Simulation) {}
  send(cmd: Command) {
    this.sim.enqueue(cmd);
  }
}
