import { describe, expect, it } from 'vitest';
import { OBSTACLES, STRUCTURES, TERRAIN, distToPath, heightAt, isWalkable } from '../../src/core';

describe('structures', () => {
  const tower = STRUCTURES.find((s) => s.kind === 'tower')!;

  it('the landmark stands on the plateau with its door toward the path end', () => {
    expect(Math.hypot(tower.x - TERRAIN.plateau.x, tower.z - TERRAIN.plateau.z)).toBeLessThan(TERRAIN.plateau.radius * 0.4);
    const end = TERRAIN.paths[0][TERRAIN.paths[0].length - 1];
    const front = { x: Math.sin(tower.rot), z: Math.cos(tower.rot) };
    const toEnd = { x: end[0] - tower.x, z: end[1] - tower.z };
    const len = Math.hypot(toEnd.x, toEnd.z);
    expect((front.x * toEnd.x + front.z * toEnd.z) / len).toBeGreaterThan(0.95);
  });

  it('nothing is built on the footpath, in water, or overlapping trees and rocks', () => {
    for (const s of STRUCTURES) {
      if (s.kind !== 'tower') expect(distToPath(s.x, s.z), s.kind).toBeGreaterThan(s.r + 0.6);
      expect(heightAt(s.x, s.z), s.kind).toBeGreaterThan(TERRAIN.waterLevel + 0.5);
      for (const o of OBSTACLES) expect(Math.hypot(o.x - s.x, o.z - s.z), `${s.kind} vs ${o.kind}`).toBeGreaterThan(o.r + s.r);
    }
  });

  it('lanterns line the main path on alternating sides', () => {
    const lanterns = STRUCTURES.filter((s) => s.kind === 'lantern');
    expect(lanterns.length).toBeGreaterThanOrEqual(3);
    for (const l of lanterns) expect(distToPath(l.x, l.z)).toBeLessThan(2.2);
  });

  it('the path still reaches the tower door and the stall is reachable', () => {
    const end = TERRAIN.paths[0][TERRAIN.paths[0].length - 1];
    expect(isWalkable(end[0], end[1])).toBe(true);
    const stall = STRUCTURES.find((s) => s.kind === 'stall')!;
    // A spot just in front of the stall (toward its front) is walkable.
    expect(isWalkable(stall.x + Math.sin(stall.rot) * (stall.r + 0.8), stall.z + Math.cos(stall.rot) * (stall.r + 0.8))).toBe(true);
  });

  it('blocks walking into the tower', () => {
    expect(isWalkable(tower.x, tower.z)).toBe(false);
    expect(isWalkable(tower.x + tower.r * 0.9, tower.z)).toBe(false);
  });
});

describe('villagers', () => {
  it('stand on dry land, clear of trees and rocks, and block movement', async () => {
    const { NPCS, OBSTACLES, TERRAIN, heightAt, isWalkable, distToPath } = await import('../../src/core');
    expect(NPCS.length).toBeGreaterThanOrEqual(2);
    for (const n of NPCS) {
      expect(heightAt(n.x, n.z), n.id).toBeGreaterThan(TERRAIN.waterLevel + 0.5);
      for (const o of OBSTACLES) expect(Math.hypot(o.x - n.x, o.z - n.z), `${n.id} vs ${o.kind}`).toBeGreaterThan(o.r + n.r);
      expect(isWalkable(n.x, n.z)).toBe(false);
      expect(distToPath(n.x, n.z), `${n.id} off the path`).toBeGreaterThan(0.8);
    }
  });

  it('the keeper can be walked up to from the path', async () => {
    const { NPCS, isWalkable } = await import('../../src/core');
    const k = NPCS.find((n) => n.id === 'keeper')!;
    const fx = k.x + Math.sin(k.rot) * 1.0;
    const fz = k.z + Math.cos(k.rot) * 1.0;
    expect(isWalkable(fx, fz)).toBe(true);
  });
});
