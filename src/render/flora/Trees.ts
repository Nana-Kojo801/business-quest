import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBSTACLES, TERRAIN, heightAt, noise2 } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { addFade } from '../fade';
import { LEAF_CELLS, getLeafAtlas } from './leafAtlas';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Code-built stylized trees.
 *
 * Broadleaf crowns are a cluster of sculpted clumps (flat-ish undersides, darker
 * where clumps press together) plus a fringe of hand-drawn leaf-cluster cards that
 * always face the camera, so the outline reads as leaves from every angle. All
 * normals lean outward from the crown's centre, so light wraps around the whole
 * crown softly, the way painted trees read. Pines are stacked skirts with jagged,
 * drooping hems. Trunks flare into roots and fork into branches under the crown.
 *
 * Everything in a crown shares one material and one draw call: the solid clumps
 * simply ignore the leaf texture (aLeaf.x = 0).
 */
interface Palette {
  low: string;
  high: string;
}

const PALETTES = {
  round: { low: '#2a5a3e', high: '#a8d066' },
  pine: { low: '#1f4a3c', high: '#6fa35c' },
  blossom: { low: '#c27f86', high: '#ffe0d6' },
  far: { low: '#2b5a40', high: '#78a656' },
  farPine: { low: '#22493d', high: '#5f9455' },
} satisfies Record<string, Palette>;
const BARK_DARK = new THREE.Color('#3e2c22');
const BARK = new THREE.Color('#7d5e48');
const BARK_LIGHT = new THREE.Color('#a08066');

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

/** Add the per-vertex leaf attributes (zeros for solid geometry) so every crown part merges. */
function withLeafAttrs(g: THREE.BufferGeometry, corner?: number[], leaf?: number[]) {
  const n = g.attributes.position.count;
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner ?? new Array(n * 2).fill(0), 2));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf ?? new Array(n * 3).fill(0), 3));
  g.deleteAttribute('uv');
  return g;
}

interface Clump {
  c: THREE.Vector3;
  r: number;
}

/** Clumps of a rounded broadleaf crown. `wide` stretches it sideways (blossom trees). */
function roundClumps(r: () => number, wide: number, lift: number): Clump[] {
  const centre = new THREE.Vector3(0, 3.35 + lift, 0);
  const clumps: Clump[] = [{ c: centre.clone(), r: 1.15 * wide }];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.7;
    // Mostly around the equator and upper half, so the crown is domed with a fuller top.
    const e = -0.25 + r() * 1.05;
    const d = 1.0 * wide;
    clumps.push({
      c: new THREE.Vector3(Math.cos(a) * Math.cos(e) * d * 1.05, centre.y + Math.sin(e) * 0.95, Math.sin(a) * Math.cos(e) * d * 1.05),
      r: (0.68 + r() * 0.22) * wide,
    });
  }
  // A top clump so the crown doesn't flatten.
  clumps.push({ c: new THREE.Vector3((r() - 0.5) * 0.3, centre.y + 1.0, (r() - 0.5) * 0.3), r: 0.8 * wide });
  return clumps;
}

/**
 * Crown geometry: solid clumps plus camera-facing leaf cards on the clump surfaces.
 * @param cell which atlas cell the cards use
 * @param cardsPerUnitArea leaf card density
 */
function crownGeometry(clumps: Clump[], palette: Palette, seed: number, cell: number, cardsPerUnitArea: number, detail = 1) {
  const low = new THREE.Color(palette.low);
  const high = new THREE.Color(palette.high);
  const centre = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of clumps) {
    centre.add(b.c);
    minY = Math.min(minY, b.c.y - b.r);
    maxY = Math.max(maxY, b.c.y + b.r);
  }
  centre.divideScalar(clumps.length);

  const tmp = new THREE.Vector3();
  const shadeAt = (v: THREE.Vector3, dir: THREE.Vector3, self: number, out: THREE.Color, nOut: THREE.Vector3) => {
    nOut.copy(v).sub(centre).normalize().multiplyScalar(0.6).addScaledVector(dir, 0.4).normalize();
    const t = THREE.MathUtils.smoothstep(v.y, minY, maxY);
    out.copy(low).lerp(high, THREE.MathUtils.clamp(t * 0.72 + 0.28 * Math.max(0, nOut.y) + 0.12 * Math.max(0, dir.y), 0, 1));
    // Darker in the creases where clumps press into each other.
    let crease = 0;
    clumps.forEach((o, oi) => {
      if (oi === self) return;
      const d = tmp.copy(v).sub(o.c).length() / o.r;
      crease = Math.max(crease, 1 - THREE.MathUtils.smoothstep(d, 0.95, 1.35));
    });
    out.multiplyScalar((1 - 0.32 * crease) * (0.92 + 0.16 * noise2(v.x * 1.7 + seed, v.z * 1.7 + v.y, 43)));
  };

  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  clumps.forEach((b, bi) => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = new Float32Array(pos.count * 3);
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i).normalize();
      const bump = 1 + 0.12 * (noise2(dir.x * 2.3 + bi * 7 + seed, dir.z * 2.3 + dir.y * 1.7, 41) - 0.5) * 2;
      v.copy(dir).multiplyScalar(b.r * bump);
      if (v.y < 0) v.y *= 0.62; // flatter underside, like a painted clump
      v.add(b.c);
      pos.setXYZ(i, v.x, v.y, v.z);
      shadeAt(v, dir, bi, c, n);
      nor.set([n.x, n.y, n.z], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(withLeafAttrs(g.index ? g.toNonIndexed() : g));
  });

  // Leaf cards on the outer surface.
  const r = rng(seed * 31 + 7);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const corner: number[] = [];
  const leaf: number[] = [];
  const idx: number[] = [];
  const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
  clumps.forEach((b, bi) => {
    const count = Math.round(cardsPerUnitArea * 4 * Math.PI * b.r * b.r);
    for (let k = 0; k < count * 3 && pos.length / 12 < 4000; k++) {
      if (k >= count && r() < 0.67) continue;
      dir.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue;
      dir.normalize();
      if (dir.y < -0.55) continue; // few cards underneath
      v.copy(dir).multiplyScalar(b.r * (0.9 + r() * 0.14));
      if (v.y < 0) v.y *= 0.62;
      v.add(b.c);
      // Skip cards buried inside another clump.
      if (clumps.some((o, oi) => oi !== bi && tmp.copy(v).sub(o.c).length() < o.r * 0.88)) continue;
      shadeAt(v, dir, bi, c, n);
      c.multiplyScalar(0.95 + r() * 0.14);
      const half = 0.27 + r() * 0.12;
      const phase = r();
      const base = pos.length / 3;
      for (let q = 0; q < 4; q++) {
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
        corner.push(CORNERS[q * 2], CORNERS[q * 2 + 1]);
        leaf.push(half, phase, cell);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    withLeafAttrs(g, corner, leaf);
    g.setIndex(idx);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

/** A pine: stacked conical skirts with jagged, drooping hems, plus its trunk. */
function pineGeometry(palette: Palette, seed: number, tiers: number, segments: number, withTrunk: boolean) {
  const low = new THREE.Color(palette.low);
  const high = new THREE.Color(palette.high);
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const top = 6.2;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y0 = 1.25 + f * 3.6;
    const radius = 1.75 - f * 1.25;
    const h = 1.7 - f * 0.55;
    const apex = new THREE.Vector3(0, Math.min(y0 + h, top), 0);
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const rot = r() * Math.PI;
    const rim: THREE.Vector3[] = [];
    const segs = segments * 2;
    for (let i = 0; i < segs; i++) {
      const a = rot + (i / segs) * Math.PI * 2;
      const tip = i % 2 === 0;
      const rr = radius * (tip ? 1 : 0.72) * (0.86 + r() * 0.26);
      rim.push(new THREE.Vector3(Math.cos(a) * rr, y0 + (tip ? -0.26 - r() * 0.12 : 0.1) + (r() - 0.5) * 0.08, Math.sin(a) * rr));
    }
    const under = new THREE.Vector3(0, y0 + 0.45, 0);
    const c = new THREE.Color();
    const n = new THREE.Vector3();
    const push = (p: THREE.Vector3, shade: number, out: number) => {
      pos.push(p.x, p.y, p.z);
      // Soft normals: outward from the trunk axis and up, like a painted cone.
      n.set(p.x, 0, p.z).normalize().multiplyScalar(out).add(new THREE.Vector3(0, 0.75, 0)).normalize();
      if (out < 0) n.set(p.x * 0.3, -1, p.z * 0.3).normalize();
      nor.push(n.x, n.y, n.z);
      const ty = THREE.MathUtils.smoothstep(p.y, 1, top);
      c.copy(low).lerp(high, THREE.MathUtils.clamp(ty * 0.75 + 0.25 * shade, 0, 1));
      col.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < segs; i++) {
      const a = rim[i];
      const b = rim[(i + 1) % segs];
      // Upper skirt.
      const facet = 0.2 + r() * 0.3;
      push(a, facet, 1);
      push(b, facet, 1);
      push(apex, 1, 1);
      // Shaded underside.
      push(b, 0, -1);
      push(a, 0, -1);
      push(under, 0, -1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    // Underside darker.
    for (let i = 0; i < col.length / 3; i++) {
      if (nor[i * 3 + 1] < 0) {
        col[i * 3] *= 0.7;
        col[i * 3 + 1] *= 0.74;
        col[i * 3 + 2] *= 0.8;
      }
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(withLeafAttrs(g));
  }
  if (withTrunk) parts.push(withLeafAttrs(trunkGeometry('pine', seed).toNonIndexed()));
  return mergeGeometries(parts)!;
}

/** A trunk that flares into roots at the base; broadleaf trunks fork into branches under the crown. */
function trunkGeometry(kind: 'round' | 'pine', seed: number) {
  const r = rng(seed + 99);
  const height = kind === 'pine' ? 1.9 : 2.9;
  const parts: THREE.BufferGeometry[] = [];
  const radial = 9;
  const main = new THREE.CylinderGeometry(1, 1, height, radial, 6, true);
  main.translate(0, height / 2 - 0.2, 0);
  const pos = main.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const a = Math.atan2(z, x);
    const t = THREE.MathUtils.clamp((y + 0.2) / height, 0, 1);
    let rad = THREE.MathUtils.lerp(0.27, 0.13, Math.pow(t, 0.8));
    // Root flare: lobes that swell toward the ground.
    const flare = 1 - THREE.MathUtils.smoothstep(t, 0, 0.32);
    rad *= 1 + flare * (0.45 + 0.4 * Math.max(0, Math.cos(a * 4 + seed)));
    const bend = Math.sin(y * 0.9 + seed) * 0.1 * t;
    pos.setXYZ(i, Math.cos(a) * rad + bend, y, Math.sin(a) * rad);
  }
  parts.push(main.toNonIndexed());
  if (kind === 'round') {
    // Branches reaching up into the crown.
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI * 2 + r() * 0.8;
      const len = 1.15 + r() * 0.35;
      const g = new THREE.CylinderGeometry(0.045, 0.1, len, 6, 1, true);
      g.translate(0, len / 2, 0);
      g.rotateZ(-(0.65 + r() * 0.25));
      g.rotateY(-a);
      g.translate(0, 1.85 + r() * 0.5, 0);
      parts.push(g.toNonIndexed());
    }
  }
  const merged = mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
  merged.computeVertexNormals();
  const mp = merged.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(mp.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    // Dark at the roots (contact with the ground) and up under the crown's shade.
    c.copy(BARK).lerp(BARK_LIGHT, THREE.MathUtils.smoothstep(y, 0, 1.2) * 0.5);
    c.lerp(BARK_DARK, 1 - THREE.MathUtils.smoothstep(y, -0.1, 0.35));
    c.lerp(BARK_DARK, THREE.MathUtils.smoothstep(y, 1.4, 2.6) * 0.75);
    col.set([c.r, c.g, c.b], i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

const CANOPY_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
attribute vec2 aCorner;
attribute vec3 aLeaf; // half size, phase, atlas cell (half size 0 = solid geometry)
varying vec2 vLeafUv;
varying float vCard;
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
vCard = step(0.001, aLeaf.x);
vLeafUv = vec2((aLeaf.z + aCorner.x * 0.5 + 0.5) / ${LEAF_CELLS.toFixed(1)}, aCorner.y * 0.5 + 0.5);
`;

/** Leaf cards turn to face the camera, each with its own rotation and a gentle flutter. */
const CANOPY_PROJECT = /* glsl */ `
#include <project_vertex>
if (aLeaf.x > 0.0) {
  float inst = 1.0;
  #ifdef USE_INSTANCING
    inst = length(instanceMatrix[0].xyz);
  #endif
  float ang = aLeaf.y * 6.2831853 + sin(uTime * 2.1 + aLeaf.y * 37.0) * 0.14;
  float ca = cos(ang), sa = sin(ang);
  vec2 cr = mat2(ca, sa, -sa, ca) * aCorner;
  mvPosition.xy += cr * aLeaf.x * inst;
  // Nudge toward the camera so cards sit over the solid crown rather than cutting into it.
  mvPosition.z += aLeaf.x * inst * 0.35;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CANOPY_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSunDirView;
uniform vec3 uSunGlow;
uniform sampler2D uLeafTex;
varying vec2 vLeafUv;
varying float vCard;
${NOISE_GLSL}
`;

/** Cut out leaf shapes (crisp at every distance), plus leaf clumping on the solid crown. */
const CANOPY_LEAVES = /* glsl */ `
#include <color_fragment>
{
  vec4 lt = texture2D(uLeafTex, vLeafUv);
  // Sharpen the cut-out edge to about one pixel at every mip level, so distant crowns
  // don't thin out and near ones don't blur.
  float a = (lt.a - 0.5) / max(fwidth(lt.a), 1e-4) * 0.75 + 0.5;
  a = mix(1.0, a, vCard);
  #ifdef BQ_A2C
    if (a < 0.02) discard;
    diffuseColor.a = clamp(a, 0.0, 1.0);
  #else
    if (a < 0.5) discard;
  #endif
  // Blossoms (second atlas cell) are lifted a little so they glow against the crown, never muddy it.
  diffuseColor.rgb *= mix(1.0, lt.r * (vLeafUv.x > 0.5 ? 1.2 : 1.0), vCard);
  vec3 lp = vBqWorldPos;
  float clump = bqNoiseB(lp.xz * 2.2 + lp.y * 1.9) * 0.65 + bqNoiseC(lp.xz * 5.0 - lp.y * 3.1) * 0.35;
  diffuseColor.rgb *= mix(0.8 + 0.32 * smoothstep(0.25, 0.75, clump), 1.0, vCard);
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

/** Bark: vertical streaks and knots. */
const BARK_FRAGMENT = /* glsl */ `
#include <color_fragment>
{
  vec3 bp = vBqWorldPos;
  float streak = bqNoiseC(vec2((bp.x + bp.z) * 9.0, bp.y * 0.9)) * 0.7 + bqNoiseB(vec2((bp.x - bp.z) * 4.0, bp.y * 2.5)) * 0.3;
  diffuseColor.rgb *= 0.78 + 0.4 * streak;
}
`;

export interface TreeSettings {
  farCount: number;
  /** Smooth leaf edges with alpha-to-coverage (only when the scene is multisampled). */
  alphaToCoverage: boolean;
}

export function createTrees(atmosphere: Atmosphere, settings: TreeSettings) {
  const group = new THREE.Group();
  group.name = 'trees';
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(0.8, 0, 0.6).normalize() },
    bqNoise: { value: getNoiseTexture() },
    uLeafTex: { value: getLeafAtlas() },
    uSunDirView: { value: new THREE.Vector3() },
    uSunGlow: { value: new THREE.Color() },
    uPlayerPos: { value: new THREE.Vector3() },
  };

  const canopyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  canopyMaterial.alphaToCoverage = settings.alphaToCoverage;
  if (settings.alphaToCoverage) canopyMaterial.defines = { BQ_A2C: '' };
  canopyMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CANOPY_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', CANOPY_VERTEX)
      .replace('#include <project_vertex>', CANOPY_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CANOPY_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', CANOPY_LEAVES)
      .replace('#include <emissivemap_fragment>', CANOPY_GLOW);
  };
  canopyMaterial.customProgramCacheKey = () => 'bq-canopy' + (settings.alphaToCoverage ? '-a2c' : '');
  // Crowns are big: dissolve them sooner near the camera and in a wider cone toward it, so a
  // tree beside the lens never walls off the view.
  addFade(canopyMaterial, uniforms, { near: 2.8, cone: 3.5 });

  const trunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  trunkMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.bqNoise = uniforms.bqNoise;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', BARK_FRAGMENT);
  };
  trunkMaterial.customProgramCacheKey = () => 'bq-trunk';
  addFade(trunkMaterial, uniforms);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, z: number, rot: number, s: number, stretch: number) =>
    matrix.compose(
      new THREE.Vector3(x, heightAt(x, z) - 0.1, z),
      q.setFromAxisAngle(up, rot),
      new THREE.Vector3(s, s * stretch, s),
    );

  // One crown and one trunk shape per variant: 0 round broadleaf, 1 pine, 2 blossom.
  const crownFor = (variant: number) => {
    if (variant === 1) return pineGeometry(PALETTES.pine, 41, 6, 9, false);
    const r = rng(500 + variant);
    return variant === 2
      ? crownGeometry(roundClumps(r, 1.18, -0.15), PALETTES.blossom, 26, 1, 3.4)
      : crownGeometry(roundClumps(r, 1, 0), PALETTES.round, 0, 0, 3.0);
  };

  // Valley trees: instanced per shape variant and per 32 m cell, so trees behind the camera
  // (and outside the shadow box) are culled instead of always being drawn.
  const trees = OBSTACLES.filter((o) => o.kind === 'tree');
  const CELL = 32;
  for (let variant = 0; variant < 3; variant++) {
    const mine = trees.filter((t) => t.variant === variant);
    if (mine.length === 0) continue;
    const canopyGeo = crownFor(variant);
    const trunkGeo = trunkGeometry(variant === 1 ? 'pine' : 'round', variant * 5 + 1);
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
        // Pines run a little taller and slimmer.
        const stretch = (variant === 1 ? 1.08 : 0.92) + 0.18 * ((t.rot * 7) % 1);
        place(t.x, t.z, t.rot, t.scale, stretch);
        canopy.setMatrixAt(i, matrix);
        trunk.setMatrixAt(i, matrix);
      });
      canopy.computeBoundingSphere();
      trunk.computeBoundingSphere();
      canopy.name = 'crowns';
      trunk.name = 'trunks';
      group.add(canopy, trunk);
    }
  }

  // Distant trees on the lower mountain slopes: simpler, no collision, softened by the haze.
  // A mix of pines and rounded crowns, each a single low-detail shape with a stub of trunk.
  if (settings.farCount > 0) {
    const r = rng(900);
    const farPine = pineGeometry(PALETTES.farPine, 77, 4, 6, true);
    const farRound = crownGeometry(
      [
        { c: new THREE.Vector3(0, 2.6, 0), r: 1.45 },
        { c: new THREE.Vector3(0.55, 3.3, 0.2), r: 0.9 },
        { c: new THREE.Vector3(-0.5, 3.2, -0.25), r: 0.85 },
      ],
      PALETTES.far,
      78,
      0,
      0,
      1,
    );
    const farRoundFull = mergeGeometries([farRound, withLeafAttrs(trunkGeometry('pine', 3).toNonIndexed())])!;
    const spots: { m: THREE.Matrix4; pine: boolean }[] = [];
    for (let tries = 0; tries < settings.farCount * 6 && spots.length < settings.farCount; tries++) {
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
      // Pines higher up, rounded trees lower down.
      const pine = r() < 0.35 + 0.5 * THREE.MathUtils.smoothstep(h, 3, 10);
      place(x, z, r() * Math.PI * 2, 0.9 + r() * 0.7, pine ? 1.2 : 1.0);
      matrix.elements[13] -= 0.3; // sink slightly so no gap shows on slopes
      spots.push({ m: matrix.clone(), pine });
    }
    for (const [geo, pine] of [[farPine, true], [farRoundFull, false]] as const) {
      const list = spots.filter((s) => s.pine === pine);
      if (!list.length) continue;
      const far = new THREE.InstancedMesh(geo, canopyMaterial, list.length);
      list.forEach((s, i) => far.setMatrixAt(i, s.m));
      far.computeBoundingSphere();
      far.name = 'farTrees';
      group.add(far);
    }
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
