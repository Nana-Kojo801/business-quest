/**
 * Where trees and boulders stand. Deterministic (integer hashing), so every
 * machine places them identically; they block movement, so the simulation
 * needs them, and the renderer draws them at the same spots.
 */
import { TERRAIN, distToPath, fbm2, heightAt, noise2, smoothstep } from './terrain';

export type ObstacleKind = 'tree' | 'boulder';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Collision radius. */
  r: number;
  /** Visual size multiplier. */
  scale: number;
  /** Rotation around the vertical axis, radians. */
  rot: number;
  /** Which shape variant to draw. */
  variant: number;
}

function hash01(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pickVariant(h: number) {
  return h < 0.55 ? 0 : h < 0.86 ? 1 : 2;
}

function slopeAt(x: number, z: number) {
  const e = 0.8;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}

/** Places that must stay clear: spawn, paths, water, the plateau top. */
function isClearZone(x: number, z: number, margin: number) {
  if (Math.hypot(x - TERRAIN.spawn.x, z - TERRAIN.spawn.z) < 6 + margin) return true;
  if (distToPath(x, z) < 2.4 + margin) return true;
  if (heightAt(x, z) < TERRAIN.waterLevel + 0.9) return true;
  const p = TERRAIN.plateau;
  if (Math.hypot(x - p.x, z - p.z) < p.radius * 0.75) return true;
  return false;
}

function generate(): Obstacle[] {
  const out: Obstacle[] = [];
  const extent = 64;

  // Trees: jittered grid, kept where the grove noise is high and densest past the walkable edge.
  const cell = 5;
  for (let iz = -extent / cell; iz <= extent / cell; iz++) {
    for (let ix = -extent / cell; ix <= extent / cell; ix++) {
      const x = (ix + 0.15 + 0.7 * hash01(ix, iz, 1)) * cell;
      const z = (iz + 0.15 + 0.7 * hash01(ix, iz, 2)) * cell;
      const r = Math.hypot(x, z);
      if (r > 62) continue;
      const grove = smoothstep(0.48, 0.68, fbm2(x * 0.028, z * 0.028, 3, 21));
      // Thinner straight ahead of the starting view, so the forest doesn't wall off the vista.
      const ahead = Math.max(0, -z / Math.max(r, 1e-6));
      const rim = smoothstep(33, 44, r) * (1 - 0.8 * ahead * ahead);
      const density = Math.min(0.92, grove * 0.75 + rim * 0.8);
      if (hash01(ix, iz, 3) > density) continue;
      if (isClearZone(x, z, 0) || slopeAt(x, z) > 0.55) continue;
      const scale = 0.8 + 0.55 * hash01(ix, iz, 4);
      out.push({
        kind: 'tree',
        x,
        z,
        r: 0.45 * scale,
        scale,
        rot: hash01(ix, iz, 5) * Math.PI * 2,
        // Mostly round broadleaf, some tall, blossom as an occasional accent.
        variant: pickVariant(hash01(ix, iz, 6)),
      });
    }
  }

  // Boulders: sparser, a few near the lake shore and path edges for interest.
  const bcell = 8;
  for (let iz = -extent / bcell; iz <= extent / bcell; iz++) {
    for (let ix = -extent / bcell; ix <= extent / bcell; ix++) {
      const x = (ix + 0.1 + 0.8 * hash01(ix, iz, 11)) * bcell;
      const z = (iz + 0.1 + 0.8 * hash01(ix, iz, 12)) * bcell;
      if (Math.hypot(x, z) > 50) continue;
      if (hash01(ix, iz, 13) > 0.3 + 0.3 * noise2(x * 0.05, z * 0.05, 23)) continue;
      if (isClearZone(x, z, -1.2)) continue;
      const scale = 0.55 + 1.1 * hash01(ix, iz, 14) ** 2;
      // Keep boulders off trees.
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.4 * scale + 0.6)) continue;
      out.push({
        kind: 'boulder',
        x,
        z,
        r: 0.85 * scale,
        scale,
        rot: hash01(ix, iz, 15) * Math.PI * 2,
        variant: Math.floor(hash01(ix, iz, 16) * 3),
      });
    }
  }
  return out;
}

/** All trees and boulders in the valley. */
export const OBSTACLES: readonly Obstacle[] = generate();

/** The obstacle a point is inside (with optional padding), if any. */
export function obstacleAt(x: number, z: number, pad = 0): Obstacle | undefined {
  for (const o of OBSTACLES) {
    const dx = x - o.x;
    const dz = z - o.z;
    const rr = o.r + pad;
    if (dx * dx + dz * dz < rr * rr) return o;
  }
  return undefined;
}
