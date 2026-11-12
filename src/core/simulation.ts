import type { Command } from './commands';
import type { PlayerState, WorldState } from './types';

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

const MAX_SPEED = 4.5;
const ACCEL = 30;
const TURN_RATE = 12;
/** The playable area is a disc of this radius for now. */
export const WORLD_RADIUS = 26;

/** State is plain JSON data, so a JSON round-trip is an exact deep copy. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function createWorld(): WorldState {
  return { tick: 0, players: {} };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function applyCommand(world: WorldState, cmd: Command) {
  switch (cmd.type) {
    case 'join':
      if (!world.players[cmd.playerId]) {
        world.players[cmd.playerId] = {
          id: cmd.playerId,
          position: { x: cmd.x, z: cmd.z },
          heading: 0,
          speed: 0,
          intent: { x: 0, z: 0 },
        };
      }
      break;
    case 'leave':
      delete world.players[cmd.playerId];
      break;
    case 'move': {
      const p = world.players[cmd.playerId];
      if (!p) break;
      let { x, z } = cmd;
      if (!Number.isFinite(x) || !Number.isFinite(z)) break; // reject bad input
      const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      p.intent = { x, z };
      break;
    }
  }
}

function stepPlayer(p: PlayerState, dt: number) {
  const mag = Math.hypot(p.intent.x, p.intent.z);
  const targetSpeed = mag * MAX_SPEED;
  p.speed += clamp(targetSpeed - p.speed, -ACCEL * dt, ACCEL * dt);

  if (mag > 0.05) {
    // heading 0 faces -z; atan2(x, -z) gives that convention.
    const target = Math.atan2(p.intent.x, -p.intent.z);
    const diff = wrapAngle(target - p.heading);
    p.heading = wrapAngle(p.heading + clamp(diff, -TURN_RATE * dt, TURN_RATE * dt));
  }

  // Move in the intended direction (not the heading) so control stays responsive.
  if (p.speed > 0 && mag > 0.05) {
    p.position.x += (p.intent.x / mag) * p.speed * dt;
    p.position.z += (p.intent.z / mag) * p.speed * dt;
  } else if (p.speed > 0) {
    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += -Math.cos(p.heading) * p.speed * dt;
  }

  const r = Math.hypot(p.position.x, p.position.z);
  if (r > WORLD_RADIUS) {
    p.position.x *= WORLD_RADIUS / r;
    p.position.z *= WORLD_RADIUS / r;
  }
}

/**
 * Deterministic fixed-step simulation. Given the same starting state and the
 * same commands on the same ticks, it produces the same result on any machine.
 */
export class Simulation {
  state: WorldState;
  private queue: Command[] = [];

  constructor(state: WorldState = createWorld()) {
    this.state = state;
  }

  enqueue(cmd: Command) {
    this.queue.push(cmd);
  }

  /** Advance exactly one fixed tick. */
  step() {
    const cmds = this.queue;
    this.queue = [];
    for (const c of cmds) applyCommand(this.state, c);
    for (const id of Object.keys(this.state.players).sort()) {
      stepPlayer(this.state.players[id], TICK_DT);
    }
    this.state.tick++;
  }

  snapshot(): WorldState {
    return clone(this.state);
  }

  restore(snapshot: WorldState) {
    this.state = clone(snapshot);
    this.queue = [];
  }
}
