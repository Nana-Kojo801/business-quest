import * as THREE from 'three';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { PALETTE_UNIFORMS_GLSL, paletteUniforms } from '../terrain/palette';
import { GROUND_DATA_GLSL, type GroundData } from '../terrain/groundData';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Grass and flowers around the player, drawn entirely on the GPU.
 *
 * Each instance has a fixed spot on a square grid of side L that wraps around
 * the focus point (the player), so the field always surrounds them with no
 * per-frame CPU work; instances fade out toward the edge so the wrap is never
 * seen. Height and density come from the baked ground-data texture.
 */
export type FieldKind = 'grass' | 'flowers';

export interface FieldSettings {
  count: number;
  radius: number;
}

const FLOWER_COLORS = ['#fff4e6', '#ffd65a', '#ff9cc4', '#b9a2ff'];

function rand(seed: number) {
  // Small deterministic generator so the field layout is the same every load.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A clump of four soft, tapered blades (4 vertices each). Attribute aPart: 0 = blade. */
function grassClump(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const r = rand(7);
  for (let b = 0; b < 4; b++) {
    const a = r() * Math.PI * 2;
    const ox = Math.cos(a) * 0.14 * r();
    const oz = Math.sin(a) * 0.14 * r();
    const h = 0.3 + r() * 0.22;
    const w = 0.12 + r() * 0.05;
    const face = r() * Math.PI;
    const lean = (r() - 0.5) * 0.35;
    const cx = Math.cos(face);
    const cz = Math.sin(face);
    const base = pos.length / 3;
    const pt = (u: number, y: number) => pos.push(ox + cx * u + lean * y, y, oz + cz * u + lean * y * 0.5);
    pt(-w / 2, 0);
    pt(w / 2, 0);
    pt(0.06 * w, h * 0.6); // slightly off-centre waist gives a natural curve
    pt(0, h);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0), 1));
  g.setIndex(idx);
  return g;
}

/** A flower: a thin stem and a six-petal head. Attribute aPart: 0 = stem, 1 = head. */
function flower(): THREE.BufferGeometry {
  const pos: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const h = 0.42;
  const sw = 0.022;
  pos.push(-sw, 0, 0, sw, 0, 0, -sw * 0.6, h, 0, sw * 0.6, h, 0);
  part.push(0, 0, 0, 0);
  idx.push(0, 1, 2, 1, 3, 2);
  const c = pos.length / 3;
  pos.push(0, h + 0.01, 0);
  part.push(1);
  const petals = 6;
  for (let i = 0; i < petals * 2; i++) {
    const a = (i / (petals * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? 0.11 : 0.05; // alternating tips and notches
    pos.push(Math.cos(a) * rr, h + 0.01 + Math.sin(a) * rr * 0.35, Math.sin(a) * rr);
    part.push(1);
  }
  for (let i = 0; i < petals * 2; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % (petals * 2)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

const VERTEX_PARS = /* glsl */ `
attribute vec2 aBase;
attribute vec4 aRand;
attribute float aPart;
uniform vec2 uFocus;
uniform float uWrap;
uniform float uRadius;
uniform float uTime;
uniform vec2 uWindDir;
uniform vec3 uSunDirV;
uniform float uMaxHeight;
uniform vec3 uFlowerColors[4];
${NOISE_GLSL}
${PALETTE_UNIFORMS_GLSL}
${GROUND_DATA_GLSL}
// A cheaper version of the terrain's meadow colour (its two dominant noise terms), run per vertex.
vec3 fieldGrassColor(vec2 p) {
  float n1 = bqNoiseA(p * 0.06);
  float n3 = bqNoiseC(p * 0.85 + 41.0);
  vec3 c = mix(tGrassCool, tGrassWarm, smoothstep(0.25, 0.75, n1 * 0.7 + n3 * 0.3));
  return mix(c, tMeadowGold, smoothstep(0.68, 0.9, n1) * 0.5);
}
varying vec3 vFieldColor;
varying float vGlow;
`;

const VERTEX_MAIN = /* glsl */ `
  // Place this instance on the grid that wraps around the focus point.
  vec2 rel = mod(aBase - uFocus + 0.5 * uWrap, uWrap) - 0.5 * uWrap;
  vec2 wxz = uFocus + rel;
  vec4 ground = bqGroundAt(wxz);
  #ifdef FLOWERS
    float density = ground.b;
  #else
    float density = ground.g;
  #endif
  float keep = smoothstep(aRand.x - 0.06, aRand.x + 0.06, density);
  float fade = 1.0 - smoothstep(uRadius * 0.62, uRadius, length(rel));
  float size = keep * fade * (0.7 + 0.6 * aRand.y);

  float ang = aRand.z * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  vec3 p = position;
  p.xz = mat2(ca, -sa, sa, ca) * p.xz;

  // Wind: travelling gusts plus a gentle individual flutter, stronger toward the tip.
  float tip = clamp(position.y / uMaxHeight, 0.0, 1.0);
  float gust = bqNoiseA(wxz * 0.12 - uWindDir * uTime * 0.5);
  float sway = (gust - 0.38) * 0.85 + sin(uTime * 2.3 + aRand.w * 6.2831853) * 0.1;
  p.xz += uWindDir * sway * tip * tip * 0.42;
  p.y *= 1.0 - abs(sway) * tip * 0.12; // bending shortens the blade a little

  vec3 transformed = vec3(wxz.x + p.x * size, ground.r + p.y * size - 0.02, wxz.y + p.z * size);

  vec3 grassCol = fieldGrassColor(wxz);
  #ifdef FLOWERS
    int ci = int(floor(aRand.y * 3.999));
    vec3 head = uFlowerColors[0];
    if (ci == 1) head = uFlowerColors[1];
    if (ci == 2) head = uFlowerColors[2];
    if (ci == 3) head = uFlowerColors[3];
    vFieldColor = mix(grassCol * 0.8, head, aPart);
  #else
    // Roots match the ground exactly so clumps never read as dark blobs; tips are lighter and warmer.
    vFieldColor = mix(grassCol * 0.95, grassCol * vec3(1.28, 1.25, 1.1), tip) * (0.92 + 0.16 * aRand.w);
  #endif
  // Tips glow when the low sun is behind them (light through the blade).
  vec3 toFrag = normalize(transformed - cameraPosition);
  vGlow = tip * tip * pow(max(dot(toFrag, uSunDirV), 0.0), 3.0);
`;

export function createField(
  kind: FieldKind,
  settings: FieldSettings,
  atmosphere: Atmosphere,
  ground: GroundData,
): { mesh: THREE.Mesh; update: (focus: THREE.Vector3, time: number) => void; dispose: () => void } {
  const base = kind === 'grass' ? grassClump() : flower();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('aPart', base.getAttribute('aPart'));
  // Real (upward) normals: without a normal attribute three.js silently switches to flat
  // shading, which lights every blade differently.
  const up = new Float32Array(base.getAttribute('position').count * 3);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));

  const wrap = settings.radius * 2;
  const r = rand(kind === 'grass' ? 101 : 202);
  const bases = new Float32Array(settings.count * 2);
  const rands = new Float32Array(settings.count * 4);
  for (let i = 0; i < settings.count; i++) {
    bases[i * 2] = r() * wrap;
    bases[i * 2 + 1] = r() * wrap;
    for (let k = 0; k < 4; k++) rands[i * 4 + k] = r();
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(bases, 2));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 4));
  geo.instanceCount = settings.count;

  const uniforms: Record<string, THREE.IUniform> = {
    ...paletteUniforms(),
    bqNoise: { value: getNoiseTexture() },
    bqGround: { value: ground.texture },
    bqGroundExtent: { value: ground.extent },
    uFocus: { value: new THREE.Vector2() },
    uWrap: { value: wrap },
    uRadius: { value: settings.radius },
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uSunDirV: atmosphere.uniforms.bqSunDir,
    uSunColorF: { value: new THREE.Color() },
    uMaxHeight: { value: kind === 'grass' ? 0.55 : 0.44 },
    uFlowerColors: { value: FLOWER_COLORS.map((c) => new THREE.Color(c)) },
  };

  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  if (kind === 'flowers') material.defines = { FLOWERS: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      // Normals point straight up: soft, even lighting like painted grass, no dark blade backs.
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFieldColor;\nvarying float vGlow;\nuniform vec3 uSunColorF;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vFieldColor;')
      // Double-sided blades would flip the normal on back faces and go dark; keep it pointing up.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= faceDirection; // undo the back-face flip\nnonPerturbedNormal = normal;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSunColorF * vGlow * vFieldColor * 0.3;',
      );
  };
  material.customProgramCacheKey = () => 'bq-field-' + kind;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = kind;
  mesh.frustumCulled = false; // the field always surrounds the camera
  atmosphere.adopt(mesh, { cast: false, receive: true });

  return {
    mesh,
    update(focus, time) {
      (uniforms.uFocus.value as THREE.Vector2).set(focus.x, focus.z);
      uniforms.uTime.value = time;
      (uniforms.uSunColorF.value as THREE.Color).copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity);
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
