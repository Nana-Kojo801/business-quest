/**
 * Villagers standing in the valley. They block movement, and later the quest
 * and dialogue systems will look them up by id, so they live in the core.
 */
import { STRUCTURES } from './structures';
import { TERRAIN } from './terrain';

export interface Npc {
  id: string;
  /** Which appearance to draw (render-side look table). */
  look: string;
  x: number;
  z: number;
  /** Resting facing, radians; the front faces +z at 0. */
  rot: number;
  r: number;
}

function facing(x: number, z: number, tx: number, tz: number) {
  return Math.atan2(tx - x, tz - z);
}

const stall = STRUCTURES.find((s) => s.kind === 'stall')!;
const pathEnd = TERRAIN.paths[0][TERRAIN.paths[0].length - 1];

// The merchant stands inside the stall, behind the counter (the stall's local -z side).
const mx = stall.x - Math.sin(stall.rot) * 0.15;
const mz = stall.z - Math.cos(stall.rot) * 0.15;
// The keeper waits beside the tower steps, looking down the path.
const kx = pathEnd[0] + 1.9;
const kz = pathEnd[1] + 1.1;

export const NPCS: readonly Npc[] = [
  { id: 'merchant', look: 'merchant', x: mx, z: mz, rot: stall.rot, r: 0.35 },
  { id: 'keeper', look: 'keeper', x: kx, z: kz, rot: facing(kx, kz, 2, -5), r: 0.35 },
];

export function npcAt(x: number, z: number, pad = 0): Npc | undefined {
  for (const n of NPCS) {
    const dx = x - n.x;
    const dz = z - n.z;
    const rr = n.r + pad;
    if (dx * dx + dz * dz < rr * rr) return n;
  }
  return undefined;
}
