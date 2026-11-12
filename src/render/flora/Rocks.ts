import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBSTACLES, TERRAIN, distToPath, heightAt, noise2, obstacleAt } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { addFade } from '../fade';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Code-built rocks: lumpy stones sliced by a few random planes, so they read as
 * chiselled, with flat facets and softened edges. Moss, faint strata and a darker
 * base where the stone sits in the ground are drawn in the shader. Boulders stand
 * where the core places them (they block movement); small decorative stones are
 * scattered along the shore and path edges.
 */
const ROCK = new THREE.Color('#c9b8a2');
const ROCK_DARK = new THREE.Color('#8c7f6c');

function rockGeometry(variant: number, detail = 3) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const seed = variant * 17;
  const r = rng(40 + variant);
  // Cutting planes: mostly around the sides and on top, so the stone has broad faces.
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.6;
    const up = i === 0 ? 1 : r() * 0.7 - 0.1;
    planes.push({ n: new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize(), d: 0.62 + r() * 0.2 });
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise2(v.x * 1.6 + seed, v.z * 1.6 + v.y * 1.3, 51);
    const big = noise2(v.x * 0.7 + seed, v.y * 0.7 - v.z, 53);
    v.multiplyScalar(0.8 + 0.3 * big + 0.08 * n);
    for (const pl of planes) {
      const k = v.dot(pl.n) - pl.d;
      if (k > 0) v.addScaledVector(pl.n, -k);
    }
    v.y *= 0.66 + variant * 0.08; // flattened
    if (v.y < -0.12) v.y = -0.12 - (v.y + 0.12) * 0.2; // flat-ish bottom sunk into the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Smooth normals soften the facet edges like a worn bevel; the facets themselves stay flat.
  g.computeVertexNormals();
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const h = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - min.y) / (max.y - min.y);
    h[i] = y;
    c.copy(ROCK_DARK).lerp(ROCK, THREE.MathUtils.smoothstep(y, 0.0, 0.8));
    c.multiplyScalar(0.93 + 0.14 * noise2(pos.getX(i) * 3 + seed, pos.getZ(i) * 3, 55));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const ROCK_VERTEX_PARS = /* glsl */ `
attribute float aH;
varying float vH;
varying vec3 vRockN;
`;
const ROCK_VERTEX = /* glsl */ `
vH = aH;
{
  mat3 m = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    m = m * mat3(instanceMatrix);
  #endif
  vRockN = normalize(m * objectNormal);
}
`;
const ROCK_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uMoss;
uniform vec3 uMossDark;
varying float vH;
varying vec3 vRockN;
${NOISE_GLSL}
`;
const ROCK_FRAGMENT = /* glsl */ `
{
  vec3 wp = vBqWorldPos;
  // Faint strata and speckle.
  float strata = bqNoiseC(vec2(wp.x * 0.7 + wp.z * 0.7, wp.y * 9.0));
  diffuseColor.rgb *= 0.9 + 0.16 * strata + 0.08 * (bqNoiseD(wp.xz * 9.0 + wp.y * 5.0) - 0.5);
  // Moss on upward faces, with a crisp, irregular edge and a darker rim.
  float up = vRockN.y + (bqNoiseB(wp.xz * 3.0 + wp.y * 2.0) - 0.5) * 0.7;
  float aa = fwidth(up) + 0.02;
  float moss = smoothstep(0.74 - aa, 0.74 + aa, up);
  float rim = smoothstep(0.6, 0.74, up) * (1.0 - moss);
  vec3 mossCol = mix(uMossDark, uMoss, bqNoiseC(wp.xz * 6.0) * 0.6 + 0.4 * smoothstep(0.55, 0.95, vRockN.y));
  diffuseColor.rgb *= 1.0 - 0.18 * rim;
  diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, moss);
  // Darker where the stone sits in the ground.
  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.35, vH));
}
`;

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
  const uniforms = {
    uPlayerPos: { value: new THREE.Vector3() },
    bqNoise: { value: getNoiseTexture() },
    uMoss: { value: new THREE.Color('#8fb85a') },
    uMossDark: { value: new THREE.Color('#4d7a3e') },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${ROCK_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCK_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'bq-rock';
  // Rocks are too low to hide the player; they only fade right in front of the lens.
  addFade(material, uniforms, { occlusion: false });
  const geos = [0, 1, 2].map((v) => rockGeometry(v));
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
    // Small stones are a few centimetres across: a low-detail shape is plenty.
    const pebbleGeo = rockGeometry(1, 1);
    geos.push(pebbleGeo);
    const mesh = new THREE.InstancedMesh(pebbleGeo, material, pebbleCount);
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
    update(player: THREE.Vector3) {
      uniforms.uPlayerPos.value.copy(player);
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
