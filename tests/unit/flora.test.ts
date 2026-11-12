import { describe, expect, it } from 'vitest';
import { OBSTACLES, PLAYER_RADIUS, Simulation, TERRAIN, distToPath, heightAt, isWalkable, obstacleAt } from '../../src/core';

describe('flora layout', () => {
  const trees = OBSTACLES.filter((o) => o.kind === 'tree');
  const boulders = OBSTACLES.filter((o) => o.kind === 'boulder');

  it('places a stable number of trees and boulders (guards cross-machine agreement)', () => {
    expect({ trees: trees.length, boulders: boulders.length }).toMatchSnapshot();
    expect(trees.length).toBeGreaterThan(40);
    expect(boulders.length).toBeGreaterThan(5);
  });

  it('keeps paths, spawn, water and the plateau top clear', () => {
    for (const o of OBSTACLES) {
      expect(distToPath(o.x, o.z)).toBeGreaterThan(1.1);
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(4.5);
      expect(heightAt(o.x, o.z)).toBeGreaterThan(TERRAIN.waterLevel + 0.3);
      const p = TERRAIN.plateau;
      expect(Math.hypot(o.x - p.x, o.z - p.z)).toBeGreaterThan(p.radius * 0.6);
    }
  });

  it('obstacles do not overlap each other badly', () => {
    for (const b of boulders) {
      for (const o of OBSTACLES) {
        if (o === b) continue;
        expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThan((o.r + b.r) * 0.6);
      }
    }
  });

  it('the whole footpath stays walkable', () => {
    for (const path of TERRAIN.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        for (let t = 0; t <= 1; t += 0.1) {
          const x = path[i][0] + (path[i + 1][0] - path[i][0]) * t;
          const z = path[i][1] + (path[i + 1][1] - path[i][1]) * t;
          expect(isWalkable(x, z), `${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true);
        }
      }
    }
  });
});

describe('collision with trees and rocks', () => {
  it('a player cannot walk through a tree', () => {
    const tree = OBSTACLES.find((o) => o.kind === 'tree' && Math.hypot(o.x, o.z) < 30 && !obstacleAt(o.x + 4, o.z, 1) && isWalkable(o.x + 4, o.z))!;
    expect(tree).toBeDefined();
    const sim = new Simulation();
    sim.enqueue({ type: 'join', playerId: 'a', x: tree.x + 4, z: tree.z });
    sim.step();
    sim.enqueue({ type: 'move', playerId: 'a', x: -1, z: 0 });
    for (let i = 0; i < 60 * 4; i++) {
      sim.step();
      const p = sim.state.players.a.position;
      expect(Math.hypot(p.x - tree.x, p.z - tree.z)).toBeGreaterThanOrEqual(tree.r + PLAYER_RADIUS - 1e-9);
    }
  });
});
