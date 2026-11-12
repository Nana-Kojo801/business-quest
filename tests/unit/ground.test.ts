import { describe, expect, it } from 'vitest';
import { OBSTACLES, STRUCTURES, TERRAIN } from '../../src/core';
import { GROUND_DATA_EXTENT, bakeGroundData } from '../../src/render/terrain/groundData';
import { PATH_SEGMENTS } from '../../src/render/terrain/pathGlsl';

const data = bakeGroundData();
const SIZE = data.texture.image.width;
const raw = data.texture.image.data as Uint16Array;
const fromHalf = (h: number) => {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  return s * 2 ** (e - 15) * (1 + f / 1024);
};
/** Contact shading (alpha channel) at the texel nearest a world point. */
function shadeAt(x: number, z: number) {
  const step = (GROUND_DATA_EXTENT * 2) / (SIZE - 1);
  const i = Math.round((x + GROUND_DATA_EXTENT) / step);
  const j = Math.round((z + GROUND_DATA_EXTENT) / step);
  return fromHalf(raw[(j * SIZE + i) * 4 + 3]);
}

describe('contact shading bake', () => {
  it('darkens the ground where trees, rocks and buildings stand', () => {
    const tree = OBSTACLES.find((o) => o.kind === 'tree')!;
    const rock = OBSTACLES.find((o) => o.kind === 'boulder')!;
    const tower = STRUCTURES.find((s) => s.kind === 'tower')!;
    expect(shadeAt(tree.x, tree.z)).toBeGreaterThan(0.3);
    expect(shadeAt(rock.x, rock.z)).toBeGreaterThan(0.3);
    expect(shadeAt(tower.x, tower.z + tower.r + 0.2)).toBeGreaterThan(0.1);
  });

  it('leaves open meadow untouched and stays in range', () => {
    expect(shadeAt(TERRAIN.spawn.x, TERRAIN.spawn.z)).toBeLessThan(0.02);
    for (let k = 3; k < raw.length; k += 4 * 37) {
      const v = fromHalf(raw[k]);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('shared path edge', () => {
  it('covers every footpath segment', () => {
    const expected = TERRAIN.paths.reduce((n, p) => n + p.length - 1, 0);
    expect(PATH_SEGMENTS.length).toBe(expected);
    const [a, b] = TERRAIN.paths[0];
    expect(PATH_SEGMENTS[0].toArray()).toEqual([a[0], a[1], b[0], b[1]]);
  });
});
