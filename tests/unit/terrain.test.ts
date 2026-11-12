import { describe, expect, it } from 'vitest';
import { Simulation, TERRAIN, distToPath, fbm2, heightAt, isWalkable, noise2, pathMask } from '../../src/core';

describe('terrain', () => {
  it('noise is deterministic and in range', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 1.37 - 50;
      const z = i * -0.91 + 20;
      const n = noise2(x, z);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      expect(noise2(x, z)).toBe(n);
      const f = fbm2(x, z, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('known heights do not drift (guards cross-machine agreement)', () => {
    // If the height function changes on purpose, update these snapshots.
    expect(heightAt(0, 0)).toMatchSnapshot();
    expect(heightAt(TERRAIN.plateau.x, TERRAIN.plateau.z)).toMatchSnapshot();
    expect(heightAt(TERRAIN.lake.x, TERRAIN.lake.z)).toMatchSnapshot();
    expect(heightAt(70, 10)).toMatchSnapshot();
  });

  it('spawn is dry, walkable and nearly flat', () => {
    const { x, z } = TERRAIN.spawn;
    expect(isWalkable(x, z)).toBe(true);
    expect(heightAt(x, z)).toBeGreaterThan(TERRAIN.waterLevel + 0.8);
    const slope = Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)) / 2;
    expect(slope).toBeLessThan(0.15);
  });

  it('the lake centre is below water and not walkable', () => {
    const { x, z } = TERRAIN.lake;
    expect(heightAt(x, z)).toBeLessThan(TERRAIN.waterLevel - 1);
    expect(isWalkable(x, z)).toBe(false);
  });

  it('the plateau stands above the meadow', () => {
    const { x, z } = TERRAIN.plateau;
    expect(heightAt(x, z)).toBeGreaterThan(heightAt(0, 0) + 2);
    // The landmark stands at its centre; the plateau in front of it is walkable.
    expect(isWalkable(x, z + 3)).toBe(true);
  });

  it('mountains rise outside the walkable valley', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.cos(a) * 85;
      const z = Math.sin(a) * 85;
      expect(heightAt(x, z)).toBeGreaterThan(5);
      expect(isWalkable(x, z)).toBe(false);
    }
  });

  it('paths start at spawn and lead to the plateau', () => {
    expect(distToPath(0, 0)).toBeLessThan(1);
    expect(pathMask(2, -5)).toBeGreaterThan(0.5); // a point on the path's centre line
    expect(distToPath(TERRAIN.plateau.x, TERRAIN.plateau.z)).toBeLessThan(3);
    expect(pathMask(30, 10)).toBe(0);
  });
});

describe('simulation on terrain', () => {
  it('a player walking into the lake stops at the shore', () => {
    const sim = new Simulation();
    sim.enqueue({ type: 'join', playerId: 'a', x: -4, z: -9 });
    sim.step();
    const dx = TERRAIN.lake.x - -4;
    const dz = TERRAIN.lake.z - -9;
    const len = Math.hypot(dx, dz);
    sim.enqueue({ type: 'move', playerId: 'a', x: dx / len, z: dz / len });
    for (let i = 0; i < 60 * 10; i++) sim.step();
    const p = sim.state.players.a.position;
    expect(isWalkable(p.x, p.z)).toBe(true);
    expect(Math.hypot(p.x - TERRAIN.lake.x, p.z - TERRAIN.lake.z)).toBeGreaterThan(2);
  });

  it('a player slides along the shore instead of sticking', () => {
    const sim = new Simulation();
    sim.enqueue({ type: 'join', playerId: 'a', x: -4, z: -9 });
    sim.step();
    // Walk toward the lake at an angle: the shore blocks part of the motion, the rest continues.
    const dx = TERRAIN.lake.x - -4;
    const dz = TERRAIN.lake.z - -9;
    const len = Math.hypot(dx, dz);
    const a = 0.35; // a glancing angle: hits the shore, then has room to slide
    const ux = (dx * Math.cos(a) - dz * Math.sin(a)) / len;
    const uz = (dx * Math.sin(a) + dz * Math.cos(a)) / len;
    sim.enqueue({ type: 'move', playerId: 'a', x: ux, z: uz });
    const track: { x: number; z: number }[] = [];
    for (let i = 0; i < 60 * 8; i++) {
      sim.step();
      if (i % 60 === 59) track.push({ ...sim.state.players.a.position });
    }
    for (const p of track) expect(isWalkable(p.x, p.z)).toBe(true);
    // It really did reach the shore (not just walk past the lake).
    const nearest = Math.min(...track.map((p) => Math.hypot(p.x - TERRAIN.lake.x, p.z - TERRAIN.lake.z)));
    expect(nearest).toBeLessThan(TERRAIN.lake.radius);
    // ...and kept moving along it rather than sticking.
    const last = track[4];
    const prev = track[3];
    expect(Math.hypot(last.x - prev.x, last.z - prev.z)).toBeGreaterThan(0.5);
  });
});
