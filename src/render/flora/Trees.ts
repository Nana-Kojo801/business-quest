import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBSTACLES, TERRAIN, heightAt, noise2 } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Code-built painterly trees.
 *
 * Canopies are clusters of lumpy blobs. Their normals point outward from the
 * canopy's centre rather than following each lump, so light wraps around the
 * whole crown softly, the way painted trees read. Colour runs from cool and
 * dark underneath to warm and light on top. Canopies sway in the wind and glow
 * at their edges when the sun is behind them.
 */
interface Palette {
  low: string;
  high: string;
}

const CANOPY_PALETTES: Palette[] = [
  { low: '#2f6343', high: '#9cc85e' }, // round broadleaf
  { low: '#29573f', high: '#7fb35a' }, // tall
  { low: '#c98a86', high: '#ffd9cf' }, // blossom: soft peach-pink
];
const FAR_PALETTE: Palette = { low: '#2c5a40', high: '#6f9f52' };
const TRUNK_LOW = new THREE.Color('#5e4636');
const TRUNK_HIGH = new THREE.Color('#9a7a60');

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

interface Blob {
  c: THREE.Vector3;
  r: number;
}

function canopyBlobs(variant: number, r: () => number): Blob[] {
  const blobs: Blob[] = [];
  if (variant === 1) {
    // Tall: a stack of shrinking blobs.
    for (let i = 0; i < 5; i++) {
      const y = 2.3 + i * 0.75;
      blobs.push({ c: new THREE.Vector3((r() - 0.5) * 0.4, y, (r() - 0.5) * 0.4), r: 1.25 - i * 0.17 });
    }
  } else {
    // Round (and blossom, wider and flatter): one big crown with smaller lobes around it.
    const wide = variant === 2 ? 1.2 : 1;
    blobs.push({ c: new THREE.Vector3(0, 3.3, 0), r: 1.45 * wide });
    const lobes = 5;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + r() * 0.6;
      const d = (0.95 + r() * 0.3) * wide;
      blobs.push({ c: new THREE.Vector3(Math.cos(a) * d, 2.8 + r() * 0.9, Math.sin(a) * d), r: (0.85 + r() * 0.35) * wide });
    }
  }
  return blobs;
}

function canopyGeometry(blobs: Blob[], palette: Palette, detail: number, seed: number) {
  const low = new THREE.Color(palette.low);
  const high = new THREE.Color(palette.high);
  const centre = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    centre.add(b.c);
    minY = Math.min(minY, b.c.y - b.r);
    maxY = Math.max(maxY, b.c.y + b.r);
  }
  centre.divideScalar(blobs.length);

  const parts = blobs.map((b, bi) => {
    const g = new THREE.IcosahedronGeometry(b.r, detail);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = new Float32Array(pos.count * 3);
    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const dir = v.clone().normalize();
      // Lumpy outline from noise on the blob's surface.
      const bump = 1 + 0.22 * (noise2(dir.x * 2.3 + bi * 7 + seed, dir.z * 2.3 + dir.y * 1.7, 41) - 0.5) * 2;
      v.copy(dir).multiplyScalar(b.r * bump).add(b.c);
      pos.setXYZ(i, v.x, v.y, v.z);
      // Normal: mostly away from the whole crown's centre, a little from the blob.
      n.copy(v).sub(centre).normalize().multiplyScalar(0.7).addScaledVector(dir, 0.3).normalize();
      nor.set([n.x, n.y, n.z], i * 3);
      const t = THREE.MathUtils.smoothstep(v.y, minY, maxY);
      c.copy(low).lerp(high, t * 0.85 + 0.15 * Math.max(0, n.y));
      c.multiplyScalar(0.9 + 0.2 * noise2(v.x * 1.7 + seed, v.z * 1.7 + v.y, 43));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(parts)!;
}

function trunkGeometry(variant: number, seed: number) {
  const height = variant === 1 ? 3.2 : 2.8;
  const g = new THREE.CylinderGeometry(0.14, 0.3, height, 7, 5, true);
  g.translate(0, height / 2 - 0.15, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // A gentle bend so trunks are not ruler-straight.
    pos.setX(i, pos.getX(i) + Math.sin(y * 0.9 + seed) * 0.12 * (y / height));
    c.copy(TRUNK_LOW).lerp(TRUNK_HIGH, y / height);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const CANOPY_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
${NOISE_GLSL}
`;

const CANOPY_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  // Wind in the tree's own (rotated) space so every tree leans the same way.
  vec3 localWind = transpose(mat3(instanceMatrix)) * uWind;
  localWind /= max(dot(localWind, localWind), 1e-4);
  float gust = bqNoiseA(treePos * 0.05 - uWind.xz * uTime * 0.35);
  float sway = (gust - 0.4) * 0.09 + sin(uTime * 1.4 + treePos.x * 0.4 + treePos.y * 0.3) * 0.025;
  transformed += localWind * sway * max(position.y - 1.6, 0.0);
#endif
`;

const CANOPY_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSunDirView;
uniform vec3 uSunGlow;
${NOISE_GLSL}
`;

/** Leaf clumps: darker gaps between brighter tufts across the crown. Requires vBqWorldPos. */
const CANOPY_LEAVES = /* glsl */ `
#include <color_fragment>
{
  vec3 lp = vBqWorldPos;
  float clump = bqNoiseB(lp.xz * 2.2 + lp.y * 1.9) * 0.65 + bqNoiseC(lp.xz * 5.0 - lp.y * 3.1) * 0.35;
  diffuseColor.rgb *= 0.78 + 0.36 * smoothstep(0.25, 0.75, clump);
}
`;

/**
 * Dissolve tree fragments that sit between the camera and the player, so the
 * player is never hidden. Uses an ordered dither (screen-door transparency),
 * which needs no sorting and costs almost nothing. Requires vBqWorldPos.
 */
export const OCCLUSION_FADE_PARS = /* glsl */ `
uniform vec3 uPlayerPos;
float bqBayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 Bayer matrix, row by row.
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[int(i)] + 0.5) / 16.0;
}
`;

export const OCCLUSION_FADE = /* glsl */ `
{
  vec3 seg = uPlayerPos + vec3(0.0, 0.8, 0.0) - cameraPosition;
  float segLen = length(seg);
  vec3 segDir = seg / max(segLen, 1e-4);
  vec3 rel = vBqWorldPos - cameraPosition;
  float along = dot(rel, segDir);
  float off = length(rel - segDir * along);
  // Only in front of the player, close to the camera-player line.
  float block = step(0.0, along) * (1.0 - smoothstep(segLen - 1.5, segLen - 0.5, along));
  float fade = block * (1.0 - smoothstep(1.4, 2.8, off));
  if (fade * 0.85 > bqBayer4(gl_FragCoord.xy)) discard;
}
`;

const CANOPY_GLOW = /* glsl */ `
#include <emissivemap_fragment>
{
  // Edges of the crown light up when the sun is behind the tree.
  vec3 toCam = normalize(vViewPosition);
  float rim = pow(1.0 - clamp(dot(normal, toCam), 0.0, 1.0), 2.5);
  float behind = pow(max(dot(-toCam, uSunDirView), 0.0), 2.0);
  totalEmissiveRadiance += uSunGlow * diffuseColor.rgb * rim * behind;
}
`;

export interface TreeSettings {
  farCount: number;
}

export function createTrees(atmosphere: Atmosphere, settings: TreeSettings) {
  const group = new THREE.Group();
  group.name = 'trees';
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(0.8, 0, 0.6).normalize() },
    bqNoise: { value: getNoiseTexture() },
    uSunDirView: { value: new THREE.Vector3() },
    uSunGlow: { value: new THREE.Color() },
    uPlayerPos: { value: new THREE.Vector3() },
  };

  const canopyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  canopyMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CANOPY_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', CANOPY_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CANOPY_FRAGMENT_PARS}\n${OCCLUSION_FADE_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OCCLUSION_FADE}`)
      .replace('#include <color_fragment>', CANOPY_LEAVES)
      .replace('#include <emissivemap_fragment>', CANOPY_GLOW);
  };
  canopyMaterial.customProgramCacheKey = () => 'bq-canopy';
  const trunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  trunkMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayerPos = uniforms.uPlayerPos;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OCCLUSION_FADE_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OCCLUSION_FADE}`);
  };
  trunkMaterial.customProgramCacheKey = () => 'bq-trunk';

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, z: number, rot: number, s: number, stretch: number) =>
    matrix.compose(
      new THREE.Vector3(x, heightAt(x, z) - 0.1, z),
      q.setFromAxisAngle(up, rot),
      new THREE.Vector3(s, s * stretch, s),
    );

  // Valley trees: instanced per shape variant and per 32 m cell, so trees behind the camera
  // (and outside the shadow box) are culled instead of always being drawn.
  const trees = OBSTACLES.filter((o) => o.kind === 'tree');
  const CELL = 32;
  for (let variant = 0; variant < 3; variant++) {
    const mine = trees.filter((t) => t.variant === variant);
    if (mine.length === 0) continue;
    const r = rng(500 + variant);
    const canopyGeo = canopyGeometry(canopyBlobs(variant, r), CANOPY_PALETTES[variant], 1, variant * 13);
    const trunkGeo = trunkGeometry(variant, variant);
    const cells = new Map<string, typeof mine>();
    for (const t of mine) {
      const key = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(t);
    }
    for (const list of cells.values()) {
      const canopy = new THREE.InstancedMesh(canopyGeo, canopyMaterial, list.length);
      const trunk = new THREE.InstancedMesh(trunkGeo, trunkMaterial, list.length);
      list.forEach((t, i) => {
        place(t.x, t.z, t.rot, t.scale, 0.9 + 0.2 * ((t.rot * 7) % 1));
        canopy.setMatrixAt(i, matrix);
        trunk.setMatrixAt(i, matrix);
      });
      canopy.computeBoundingSphere();
      trunk.computeBoundingSphere();
      group.add(canopy, trunk);
    }
  }

  // Distant trees on the lower mountain slopes: simpler, no collision, lost in the haze.
  if (settings.farCount > 0) {
    const r = rng(900);
    // Slim, upright crowns that sit on the ground: read as forest on the slopes, not floating blobs.
    const farGeo = canopyGeometry(
      [
        { c: new THREE.Vector3(0, 1.2, 0), r: 1.1 },
        { c: new THREE.Vector3(0.1, 2.2, 0.05), r: 0.85 },
        { c: new THREE.Vector3(0, 3.0, 0), r: 0.55 },
      ],
      FAR_PALETTE,
      0, // low detail: they are small and hazy
      77,
    );
    const far = new THREE.InstancedMesh(farGeo, canopyMaterial, settings.farCount);
    let n = 0;
    for (let tries = 0; tries < settings.farCount * 6 && n < settings.farCount; tries++) {
      const a = r() * Math.PI * 2;
      const d = 62 + r() * 30;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (-z / d > 0.55 && r() < 0.75) continue; // keep the view ahead open
      const h = heightAt(x, z);
      if (h > 13 || h < TERRAIN.waterLevel + 1) continue; // lower slopes only
      const e = 1.5;
      const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      if (slope > 0.9 || r() > 0.4 + 0.6 * noise2(x * 0.03, z * 0.03, 47)) continue; // in clumps, off cliffs
      place(x, z, r() * Math.PI * 2, 0.9 + r() * 0.7, 1.15);
      matrix.elements[13] -= 0.5; // sink slightly so no gap shows on slopes
      far.setMatrixAt(n++, matrix);
    }
    far.count = n;
    far.computeBoundingSphere();
    far.name = 'farTrees';
    group.add(far);
  }

  atmosphere.adopt(group, { cast: true, receive: true });
  // Canopies self-shadowing at a low sun looks speckled; they cast but don't receive.
  group.children.forEach((m) => {
    if ((m as THREE.Mesh).material === canopyMaterial) m.receiveShadow = false;
    if (m.name === 'farTrees') m.castShadow = false;
  });

  const sunView = new THREE.Vector3();
  return {
    group,
    update(time: number, camera: THREE.Camera, player: THREE.Vector3) {
      uniforms.uTime.value = time;
      uniforms.uPlayerPos.value.copy(player);
      sunView.copy(atmosphere.uniforms.bqSunDir.value).transformDirection(camera.matrixWorldInverse);
      uniforms.uSunDirView.value.copy(sunView);
      uniforms.uSunGlow.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.35);
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      canopyMaterial.dispose();
      trunkMaterial.dispose();
    },
  };
}
