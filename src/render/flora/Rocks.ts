import * as THREE from 'three';
import { OBSTACLES, TERRAIN, distToPath, heightAt, noise2, obstacleAt } from '../../core';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Code-built rocks: lumpy, flattened stones in a warm grey, with moss on the
 * upward faces. Boulders stand where the core places them (they block movement);
 * small decorative stones are scattered along the shore and path edges.
 */
const ROCK = new THREE.Color('#cdb99f');
const ROCK_DARK = new THREE.Color('#a48f80');
const MOSS = new THREE.Color('#82ad58');

function rockGeometry(variant: number) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const seed = variant * 17;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise2(v.x * 1.6 + seed, v.z * 1.6 + v.y * 1.3, 51);
    const big = noise2(v.x * 0.7 + seed, v.y * 0.7 - v.z, 53);
    v.multiplyScalar(0.75 + 0.35 * big + 0.12 * n);
    v.y *= 0.62 + variant * 0.08; // flattened
    if (v.y < -0.15) v.y = -0.15 - (v.y + 0.15) * 0.2; // flat-ish bottom sunk into the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Facet the stone slightly: unshare vertices so faces read as chiselled planes.
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const p = flat.attributes.position as THREE.BufferAttribute;
  const nor = flat.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const ny = nor.getY(i);
    c.copy(ROCK_DARK).lerp(ROCK, THREE.MathUtils.smoothstep(p.getY(i), -0.2, 0.5));
    c.multiplyScalar(0.92 + 0.16 * noise2(p.getX(i) * 3 + seed, p.getZ(i) * 3, 55));
    c.lerp(MOSS, THREE.MathUtils.smoothstep(ny, 0.55, 0.85) * 0.85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRocks(atmosphere: Atmosphere, pebbleCount: number) {
  const group = new THREE.Group();
  group.name = 'rocks';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const geos = [0, 1, 2].map(rockGeometry);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // Boulders at the core's positions.
  const boulders = OBSTACLES.filter((o) => o.kind === 'boulder');
  for (let variant = 0; variant < 3; variant++) {
    const mine = boulders.filter((b) => b.variant === variant);
    if (!mine.length) continue;
    const mesh = new THREE.InstancedMesh(geos[variant], material, mine.length);
    mine.forEach((b, i) => {
      const s = b.scale * 1.15;
      matrix.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z), b.z), q.setFromAxisAngle(up, b.rot), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Small stones along the lake shore and path edges (decoration only).
  if (pebbleCount > 0) {
    const r = rng(321);
    const mesh = new THREE.InstancedMesh(geos[1], material, pebbleCount);
    let n = 0;
    for (let tries = 0; tries < pebbleCount * 20 && n < pebbleCount; tries++) {
      const x = (r() - 0.5) * 80;
      const z = (r() - 0.5) * 80 - 8;
      const h = heightAt(x, z);
      const shore = h > TERRAIN.waterLevel + 0.05 && h < TERRAIN.waterLevel + 0.9;
      const pathEdge = Math.abs(distToPath(x, z) - 1.5) < 0.5;
      if (!(shore || pathEdge) || obstacleAt(x, z, 0.4)) continue;
      const s = 0.12 + r() * r() * 0.3;
      matrix.compose(new THREE.Vector3(x, h, z), q.setFromAxisAngle(up, r() * 6.28), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(n++, matrix);
    }
    mesh.count = n;
    mesh.computeBoundingSphere();
    mesh.name = 'pebbles';
    group.add(mesh);
  }

  atmosphere.adopt(group, { cast: true, receive: true });
  group.children.forEach((m) => {
    if (m.name === 'pebbles') m.castShadow = false;
  });
  return {
    group,
    dispose() {
      geos.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
