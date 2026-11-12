import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation, TICK_RATE, WORLD_RADIUS, type Command } from '../../src/core';

function run(commandsByTick: Record<number, Command[]>, ticks: number) {
  const sim = new Simulation();
  for (let t = 0; t < ticks; t++) {
    for (const c of commandsByTick[t] ?? []) sim.enqueue(c);
    sim.step();
  }
  return sim;
}

describe('simulation', () => {
  it('adds and removes players', () => {
    const sim = run({ 0: [{ type: 'join', playerId: 'a', x: 1, z: 2 }] }, 1);
    expect(sim.state.players.a.position).toEqual({ x: 1, z: 2 });
    sim.enqueue({ type: 'leave', playerId: 'a' });
    sim.step();
    expect(sim.state.players.a).toBeUndefined();
  });

  it('moves a player in the commanded direction', () => {
    const sim = run({
      0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }],
      1: [{ type: 'move', playerId: 'a', x: 0, z: -1 }],
    }, TICK_RATE + 1);
    const p = sim.state.players.a;
    expect(p.position.z).toBeLessThan(-3);
    expect(Math.abs(p.position.x)).toBeLessThan(1e-9);
    expect(p.heading).toBeCloseTo(0);
  });

  it('decelerates and stops when input is released', () => {
    const sim = run({
      0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }],
      1: [{ type: 'move', playerId: 'a', x: 1, z: 0 }],
      30: [{ type: 'move', playerId: 'a', x: 0, z: 0 }],
    }, 90);
    const p = sim.state.players.a;
    expect(p.speed).toBe(0);
    const x = p.position.x;
    sim.step();
    expect(sim.state.players.a.position.x).toBe(x);
  });

  it('clamps oversized and rejects invalid input', () => {
    const sim = run({
      0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }],
      1: [{ type: 'move', playerId: 'a', x: 10, z: 0 }, { type: 'move', playerId: 'a', x: NaN, z: 0 }],
    }, 2);
    expect(sim.state.players.a.intent).toEqual({ x: 1, z: 0 });
  });

  it('keeps players inside the world', () => {
    const sim = run({
      0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }],
      1: [{ type: 'move', playerId: 'a', x: 1, z: 0 }],
    }, TICK_RATE * 20);
    const p = sim.state.players.a.position;
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WORLD_RADIUS + 1e-9);
  });

  it('is deterministic: same commands give identical state', () => {
    const cmds: Record<number, Command[]> = {
      0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }, { type: 'join', playerId: 'b', x: 3, z: 3 }],
      5: [{ type: 'move', playerId: 'a', x: 0.3, z: -0.8 }],
      9: [{ type: 'move', playerId: 'b', x: -1, z: 0.2 }],
      70: [{ type: 'move', playerId: 'a', x: 0, z: 0 }],
    };
    expect(run(cmds, 200).state).toEqual(run(cmds, 200).state);
  });

  it('snapshots are independent copies and restore exactly', () => {
    const sim = run({ 0: [{ type: 'join', playerId: 'a', x: 0, z: 0 }], 1: [{ type: 'move', playerId: 'a', x: 1, z: 0 }] }, 10);
    const snap = sim.snapshot();
    for (let i = 0; i < 20; i++) sim.step();
    expect(snap.players.a.position.x).not.toBe(sim.state.players.a.position.x);
    sim.restore(snap);
    expect(sim.state).toEqual(snap);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain data
  });
});

describe('architecture boundaries', () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? srcFiles(join(dir, e.name)) : [join(dir, e.name)]);

  it('core never imports three.js or other layers', () => {
    for (const f of srcFiles('src/core')) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/from ['"]three/);
      expect(code, f).not.toMatch(/from ['"]\.\.\//);
    }
  });

  it('only the render layer imports three.js', () => {
    for (const f of srcFiles('src')) {
      if (f.startsWith(join('src', 'render'))) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]three/);
    }
  });
});
