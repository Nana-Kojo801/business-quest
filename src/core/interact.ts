import { NPCS } from './npcs';
import type { PlayerState } from './types';

/** How far (centre to centre) a player can reach to talk to someone. */
export const INTERACT_RANGE = 2.8;

/**
 * What a player can interact with right now: the nearest villager in reach,
 * preferring ones in front. Pure, so the UI prompt and the simulation agree.
 */
export function interactTarget(p: PlayerState): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  const fx = Math.sin(p.heading);
  const fz = -Math.cos(p.heading);
  for (const n of NPCS) {
    const dx = n.x - p.position.x;
    const dz = n.z - p.position.z;
    const d = Math.hypot(dx, dz);
    if (d > INTERACT_RANGE) continue;
    const facing = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
    const score = d - facing * 0.6; // nearer and more in front wins
    if (score < bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}
