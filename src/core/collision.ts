/** Where players may stand, and which way to slide when they can't. */
import { obstacleAt } from './flora';
import { TERRAIN, heightAt, type Vec2Like } from './terrain';

/** Player body radius used against trees and boulders. */
export const PLAYER_RADIUS = 0.35;

/** Whether a player may stand here: inside the valley, out of the lake, not inside a tree or rock. */
export function isWalkable(x: number, z: number): boolean {
  if (Math.hypot(x, z) > TERRAIN.playRadius) return false;
  if (heightAt(x, z) <= TERRAIN.waterLevel - 0.15) return false;
  return obstacleAt(x, z, PLAYER_RADIUS) === undefined;
}

/**
 * Direction pointing away from whatever blocks movement near a point, as a unit
 * vector. Terrain boundaries are smoothed over about a metre so small bumps in
 * the shoreline don't count.
 */
export function boundaryNormal(x: number, z: number): Vec2Like {
  const near = obstacleAt(x, z, PLAYER_RADIUS + 0.3);
  if (near) {
    const dx = x - near.x;
    const dz = z - near.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
  const r = Math.hypot(x, z);
  if (r > TERRAIN.playRadius - 1) return { x: -x / r, z: -z / r }; // valley edge: point inward
  const e = 0.9;
  // Uphill from the water is away from the lake.
  const gx = heightAt(x + e, z) - heightAt(x - e, z);
  const gz = heightAt(x, z + e) - heightAt(x, z - e);
  const len = Math.hypot(gx, gz);
  return len > 1e-9 ? { x: gx / len, z: gz / len } : { x: 0, z: 0 };
}
