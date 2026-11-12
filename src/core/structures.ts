/**
 * Built things in the valley: the landmark on the plateau and the props along
 * the path. They block movement, so their layout lives in the core.
 */
import { TERRAIN } from './terrain';

export type StructureKind = 'tower' | 'stall' | 'lantern' | 'signpost';

export interface Structure {
  kind: StructureKind;
  x: number;
  z: number;
  /** Collision radius. */
  r: number;
  /** Rotation around the vertical axis; the structure's front faces +z at rot 0. */
  rot: number;
}

/** Rotation that turns a structure's front (+z) toward a point. */
function facing(x: number, z: number, tx: number, tz: number) {
  return Math.atan2(tx - x, tz - z);
}

function lanternsAlongMainPath(): Structure[] {
  const path = TERRAIN.paths[0];
  const out: Structure[] = [];
  let travelled = 0;
  let next = 4;
  let side = 1;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    while (next <= travelled + len) {
      const t = (next - travelled) / len;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      // Perpendicular offset to alternate sides of the path.
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const x = px + nx * 1.7 * side;
      const z = pz + nz * 1.7 * side;
      out.push({ kind: 'lantern', x, z, r: 0.22, rot: facing(x, z, px, pz) });
      side = -side;
      next += 6.5;
    }
    travelled += len;
  }
  return out;
}

const TOWER_X = TERRAIN.plateau.x + 0.5;
const TOWER_Z = TERRAIN.plateau.z - 2;
const pathEnd = TERRAIN.paths[0][TERRAIN.paths[0].length - 1];

export const STRUCTURES: readonly Structure[] = [
  // The landmark, its door facing the end of the path.
  { kind: 'tower', x: TOWER_X, z: TOWER_Z, r: 3.3, rot: facing(TOWER_X, TOWER_Z, pathEnd[0], pathEnd[1]) },
  // A market stall beside the fork in the path, facing the path.
  { kind: 'stall', x: 7.0, z: -5.5, r: 1.6, rot: facing(7.0, -5.5, 3.0, -7.2) },
  // A signpost at the fork.
  { kind: 'signpost', x: 3.4, z: -3.6, r: 0.25, rot: facing(3.4, -3.6, 0, 0) },
  ...lanternsAlongMainPath(),
];

export function structureAt(x: number, z: number, pad = 0): Structure | undefined {
  for (const s of STRUCTURES) {
    const dx = x - s.x;
    const dz = z - s.z;
    const rr = s.r + pad;
    if (dx * dx + dz * dz < rr * rr) return s;
  }
  return undefined;
}
