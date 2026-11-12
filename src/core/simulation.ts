import type { Command } from './commands';
import { boundaryNormal, isWalkable } from './collision';
import { TERRAIN } from './terrain';
import { interactTarget } from './interact';
import type { PlayerState, WorldState } from './types';

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

const MAX_SPEED = 4.5;
const ACCEL = 30;
const TURN_RATE = 12;
/** The playable area: the valley floor. */
export const WORLD_RADIUS = TERRAIN.playRadius;

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
          interaction: null,
        };
      }
      break;
    case 'leave':
      delete world.players[cmd.playerId];
      break;
    case 'interact': {
      const p = world.players[cmd.playerId];
      if (!p) break;
      const target = interactTarget(p);
      if (target) p.interaction = { targetId: target, tick: world.tick };
      break;
    }
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
  let dx = 0;
  let dz = 0;
  if (p.speed > 0 && mag > 0.05) {
    dx = (p.intent.x / mag) * p.speed * dt;
    dz = (p.intent.z / mag) * p.speed * dt;
  } else if (p.speed > 0) {
    dx = Math.sin(p.heading) * p.speed * dt;
    dz = -Math.cos(p.heading) * p.speed * dt;
  }
  if (dx === 0 && dz === 0) return;

  const { x, z } = p.position;
  if (isWalkable(x + dx, z + dz)) {
    p.position.x = x + dx;
    p.position.z = z + dz;
    return;
  }

  // Blocked (lake, valley edge): keep the part of the motion that runs along the boundary,
  // so the player glides around shores instead of stopping dead.
  const n = boundaryNormal(x, z);
  const tx = -n.z;
  const tz = n.x;
  const along = dx * tx + dz * tz;
  // A small nudge away from the boundary stops the player hugging the exact edge,
  // where a curved shore would block even a sideways step.
  const push = Math.abs(along) * 0.35;
  const candidates: [number, number][] = [
    [tx * along + n.x * push, tz * along + n.z * push],
    [tx * along, tz * along],
  ];
  // Fallback for awkward corners: angled versions of the original step.
  for (const angle of SLIDE_ANGLES) {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    candidates.push([(dx * c - dz * sn) * c, (dx * sn + dz * c) * c]);
  }
  for (const [mx, mz] of candidates) {
    if (Math.abs(mx) + Math.abs(mz) < 1e-6) continue;
    if (isWalkable(x + mx, z + mz)) {
      p.position.x = x + mx;
      p.position.z = z + mz;
      return;
    }
  }
  p.speed = 0;
}

/** Directions tried when the straight path is blocked (radians), in a fixed order for determinism. */
const SLIDE_ANGLES = [0.5, -0.5, 1.0, -1.0, 1.4, -1.4];

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
