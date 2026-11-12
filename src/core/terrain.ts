/**
 * The shape of the land, as pure math. The renderer builds its mesh from this,
 * and the simulation can ask for ground height or walkability, so every machine
 * agrees on where the ground is. Uses integer hashing (no Math.sin) so results
 * are bit-identical across browsers.
 */

export interface Vec2Like {
  x: number;
  z: number;
}

/** Layout of the starting valley. */
export const TERRAIN = {
  spawn: { x: 0, z: 0 },
  lake: { x: -15, z: -20, radius: 11 },
  plateau: { x: 6, z: -27, radius: 10, height: 2.8 },
  /** Walkable radius from the valley centre. */
  playRadius: 40,
  /** Mountains begin rising here. */
  mountainStart: 60,
  /** Height of the meadow floor above the water. */
  meadowLevel: 1.6,
  /** Footpaths as polylines (x, z). */
  paths: [
    [
      [0, 3],
      [2, -5],
      [4.5, -12],
      [5.5, -18],
      [6.2, -24.6],
    ],
    [
      [2, -5],
      [-3, -10],
      [-8, -13],
    ],
  ] as [number, number][][],
  /** Height of the water surface; terrain below this is lake bed. */
  waterLevel: 0,
} as const;

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1). */
export function noise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm2(x: number, z: number, octaves: number, seed = 0): number {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x, z, seed + i * 31);
    norm += amp;
    // Rotate and scale each octave to hide grid alignment.
    const nx = x * 1.6 - z * 1.2;
    z = x * 1.2 + z * 1.6;
    x = nx;
    amp *= 0.5;
  }
  return v / norm;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance to the nearest footpath. */
export function distToPath(x: number, z: number): number {
  let best = Infinity;
  for (const path of TERRAIN.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      best = Math.min(best, distToSegment(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]));
    }
  }
  return best;
}

/** 1 on a footpath, fading to 0 at its edges (edges wobble so they look trodden, not ruled). */
export function pathMask(x: number, z: number): number {
  const wobble = (noise2(x * 0.6, z * 0.6, 7) - 0.5) * 0.9;
  return 1 - smoothstep(0.45, 1.3, distToPath(x, z) + wobble);
}

/** Ground height at a point. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);

  // Gentle rolling meadow above the water line, flattened around the spawn point.
  let roll = (fbm2(x * 0.035, z * 0.035, 4, 1) - 0.5) * 2.6;
  roll *= 0.25 + 0.75 * smoothstep(3, 14, r);
  let h = TERRAIN.meadowLevel + roll;

  // Raised plateau: soft grassy shoulders, gently domed top.
  const p = TERRAIN.plateau;
  const dp = Math.hypot(x - p.x, z - p.z) + (noise2(x * 0.25, z * 0.25, 3) - 0.5) * 2.5;
  h += p.height * (1 - smoothstep(p.radius * 0.3, p.radius, dp));

  // Lake basin, dipping below the water line.
  const l = TERRAIN.lake;
  const dl = Math.hypot(x - l.x, z - l.z) + (noise2(x * 0.2, z * 0.2, 5) - 0.5) * 4;
  const bowl = 1 - smoothstep(l.radius * 0.3, l.radius * 1.15, dl);
  h = h * (1 - bowl) - 2.2 * bowl;

  // Footpaths are worn a little flatter and lower.
  h -= pathMask(x, z) * 0.1;

  // Mountain ring framing the valley. Lower straight ahead of the starting view so the sky stays
  // visible in a tall portrait frame; taller to the sides and behind.
  const m = smoothstep(TERRAIN.mountainStart - 6, TERRAIN.mountainStart + 30, r);
  if (m > 0) {
    const ridge = 1 - Math.abs(fbm2(x * 0.02, z * 0.02, 5, 11) * 2 - 1);
    const big = fbm2(x * 0.008, z * 0.008, 3, 13);
    const ahead = Math.max(0, -z / Math.max(r, 1e-6));
    const sides = 1 - 0.5 * ahead * ahead;
    h += m * (6 + 20 * ridge * ridge * (0.5 + big)) * sides;
  }
  return h;
}
