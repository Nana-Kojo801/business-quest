import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCRIPTS } from '../../src/content/dialogue';
import { EXPRESSIONS, EXPRESSION_NAMES } from '../../src/render/characters/face';
import { buildHair } from '../../src/render/characters/hair';
import { LOOKS, villagerLook } from '../../src/render/characters/looks';
import * as B from '../../src/render/characters/body';
import { detail, type Part } from '../../src/render/characters/shapes';

const tris = (ps: Part[]) =>
  ps.reduce((n, p) => n + ((p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3) * (p.outline !== false ? 2 : 1), 0);
function triangles(look: ReturnType<typeof villagerLook>) {
  const C = new THREE.Vector3(0, 0.155, 0);
  const R = 0.163;
  const h = buildHair(look.hairStyle, look.hair, C, R, !!look.hat);
  return (
    tris(B.hipParts(look, 1)) + tris(B.torsoParts(look, 1)) + tris(B.headParts(look, C, R)) + tris(h.head) + tris(h.back) + tris(h.cowlick) +
    2 * (tris(B.thighParts(look)) + tris(B.shinParts(look)) + tris(B.footParts(look)) + tris(B.upperArmParts(look)) + tris(B.forearmParts(look, 1)))
  );
}

describe('character builder', () => {
  it('every mood used in dialogue is an expression a face can show', () => {
    for (const [name, script] of Object.entries(SCRIPTS)) {
      for (const [id, line] of Object.entries(script.lines)) {
        if (line.mood) expect(EXPRESSION_NAMES, `${name}.${id}`).toContain(line.mood);
      }
    }
  });

  it('every expression has eyes, a mouth and a talking mouth', () => {
    for (const e of Object.values(EXPRESSIONS)) {
      expect(e.eyes).toBeGreaterThanOrEqual(0);
      expect(e.mouth).toBeGreaterThanOrEqual(0);
      expect(e.talk).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds every look and stays inside the triangle budget (hero ~30k, crowd ~17k)', () => {
    for (const look of Object.values(LOOKS)) expect(triangles(look)).toBeLessThan(34000);
    detail.crowd = true;
    try {
      for (const seed of [1, 11, 23, 37, 41, 59]) expect(triangles(villagerLook(seed))).toBeLessThan(19000);
    } finally {
      detail.crowd = false;
    }
  });

  it('hair styles give every part a surface type and a colour', () => {
    for (const style of ['short', 'bun', 'long'] as const) {
      const h = buildHair(style, '#7a3f2c', new THREE.Vector3(0, 0.155, 0), 0.163, false);
      for (const p of [...h.head, ...h.back, ...h.cowlick]) {
        expect(p.color).toMatch(/^#/);
        expect(typeof p.mat).toBe('number');
      }
      expect(h.head.length).toBeGreaterThan(10);
    }
  });
});
