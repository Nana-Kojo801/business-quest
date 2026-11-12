/**
 * Game state types. Everything here is plain, JSON-serializable data so it can be
 * saved, sent over a network, or compared between machines later.
 *
 * Rule: nothing under src/core may import three.js or touch the DOM. This is
 * enforced by tsconfig.core.json (no DOM lib) and a unit test.
 */

export type PlayerId = string;

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  id: PlayerId;
  position: Vec2;
  /** Facing angle in radians, 0 = facing -z (away from the default camera). */
  heading: number;
  /** Current speed in world units per second, used for animation. */
  speed: number;
  /** Latest movement intent, -1..1 on each axis, relative to the world. */
  intent: Vec2;
  /** The most recent interaction this player started (with whom, on which tick), if any. */
  interaction: { targetId: string; tick: number } | null;
}

export interface WorldState {
  /** Increments once per fixed simulation step. */
  tick: number;
  players: Record<PlayerId, PlayerState>;
}
