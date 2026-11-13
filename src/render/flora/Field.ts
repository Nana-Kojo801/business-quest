import * as THREE from 'three';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { PALETTE_UNIFORMS_GLSL, paletteUniforms } from '../terrain/palette';
import { GROUND_DATA_GLSL, type GroundData } from '../terrain/groundData';
import { PATH_GLSL, pathUniforms } from '../terrain/pathGlsl';
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
  /** Instances fade out toward this distance from the player. */
  radius: number;
  /** Instances fade in from this distance (a far ring around a denser near field); 0 = none. */
  inner?: number;
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

/**
 * A clump of slender, curving blades. Near clumps have more blades and a mid joint so each
 * blade bends; far clumps are simpler. Attributes: aPart (0 = blade), aFace (the blade's
 * facing direction, for a little light-and-shade between blades).
 */
function grassClump(detail: 'near' | 'far'): THREE.BufferGeometry {
  const pos: number[] = [];
  const face: number[] = [];
  const idx: number[] = [];
  const r = rand(detail === 'near' ? 7 : 8);
  const blades = detail === 'near' ? 6 : 4;
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2;
    const ox = Math.cos(a) * 0.13 * Math.sqrt(r());
    const oz = Math.sin(a) * 0.13 * Math.sqrt(r());
    const h = (detail === 'near' ? 0.26 : 0.32) + r() * 0.28;
    const w = (detail === 'near' ? 0.055 : 0.085) + r() * 0.03;
    const f = r() * Math.PI;
    const cx = Math.cos(f);
    const cz = Math.sin(f);
    // Bend direction: roughly across the blade's face, so it curls like a real blade.
    const lean = 0.12 + r() * 0.22;
    const lx = -cz * lean * (r() < 0.5 ? -1 : 1);
    const lz = cx * lean;
    const base = pos.length / 3;
    const pt = (u: number, t: number) => {
      const bend = t * t; // curve grows toward the tip
      pos.push(ox + cx * u + lx * bend, h * t, oz + cz * u + lz * bend);
      face.push(-cz, cx);
    };
    if (detail === 'near') {
      pt(-w / 2, 0);
      pt(w / 2, 0);
      pt(-w * 0.36, 0.55);
      pt(w * 0.36, 0.55);
      pt(0, 1);
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
    } else {
      pt(-w / 2, 0);
      pt(w / 2, 0);
      pt(0.06 * w, 0.6);
      pt(0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 1, base + 3, base + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0), 1));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 2));
  g.setIndex(idx);
  return g;
}

/**
 * A flower: a thin stem, five rounded, slightly cupped petals and a contrasting centre.
 * Attribute aPart: 0 = stem, 1 = petal (fractional part = distance out along the petal), 2 = centre.
 */
function flower(): THREE.BufferGeometry {
  const pos: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const h = 0.42;
  const sw = 0.02;
  pos.push(-sw, 0, 0, sw, 0, 0, -sw * 0.6, h, 0, sw * 0.6, h, 0);
  part.push(0, 0, 0, 0);
  idx.push(0, 1, 2, 1, 3, 2);
  const y0 = h + 0.01;
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const c = pos.length / 3;
    pos.push(0, y0, 0);
    part.push(1.0);
    // Outline of one rounded petal: narrow at the base, broad and round at the tip.
    const outline: [number, number][] = [[-0.42, 0.03], [-0.3, 0.1], [0, 0.125], [0.3, 0.1], [0.42, 0.03]];
    for (const [da, rr] of outline) {
      pos.push(Math.cos(a + da) * rr, y0 + rr * 0.45, Math.sin(a + da) * rr); // cupped upward
      part.push(1 + Math.min(0.99, rr / 0.125));
    }
    for (let k = 0; k < outline.length - 1; k++) idx.push(c, c + 2 + k, c + 1 + k);
  }
  const cc = pos.length / 3;
  pos.push(0, y0 + 0.025, 0);
  part.push(2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.035, y0 + 0.018, Math.sin(a) * 0.035);
    part.push(2);
  }
  for (let i = 0; i < 6; i++) idx.push(cc, cc + 1 + ((i + 1) % 6), cc + 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  return g;
}

const VERTEX_PARS = /* glsl */ `
attribute vec2 aBase;
attribute vec4 aRand;
attribute float aPart;
attribute vec2 aFace;
uniform vec2 uFocus;
uniform float uInner;
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
${PATH_GLSL}
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
  // Grow right up to the footpath's edge (a few blades lean over it), never on it.
  float pathD = pathEdgeDistance(wxz);
  #ifdef FLOWERS
    density *= smoothstep(PATH_EDGE + 0.1, PATH_EDGE + 0.35, pathD);
  #else
    density *= smoothstep(PATH_EDGE - 0.12, PATH_EDGE + 0.12, pathD);
  #endif
  float keep = smoothstep(aRand.x - 0.06, aRand.x + 0.06, density);
  float fade = (1.0 - smoothstep(uRadius * 0.62, uRadius, length(rel))) * (uInner > 0.0 ? smoothstep(uInner * 0.65, uInner, length(rel)) : 1.0);
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
  // Blades bend away and flatten around the player's feet.
  float trodden = 1.0 - smoothstep(0.2, 0.75, length(rel));
  p.xz += rel / max(length(rel), 1e-3) * trodden * tip * 0.3;
  p.y *= 1.0 - 0.6 * trodden;

  vec3 transformed = vec3(wxz.x + p.x * size, ground.r + p.y * size - 0.02, wxz.y + p.z * size);

  vec3 grassCol = fieldGrassColor(wxz);
  // Contact shading baked into the ground data: blades under trees and beside rocks are darker.
  grassCol *= mix(vec3(1.0), vec3(0.5, 0.56, 0.68), ground.a);
  #ifdef FLOWERS
    int ci = int(floor(aRand.y * 3.999));
    vec3 head = uFlowerColors[0];
    if (ci == 1) head = uFlowerColors[1];
    if (ci == 2) head = uFlowerColors[2];
    if (ci == 3) head = uFlowerColors[3];
    // Petals deepen toward their base; the centre is gold (or deep plum on the yellow ones).
    float along = fract(aPart);
    vec3 petal = head * (0.78 + 0.3 * along);
    vec3 centre = ci == 1 ? vec3(0.55, 0.3, 0.18) : vec3(1.0, 0.78, 0.25);
    vFieldColor = aPart < 0.5 ? grassCol * 0.8 : (aPart < 1.999 ? petal : centre);
  #else
    // Roots sit just darker than the ground (depth between blades); tips are lighter and warmer.
    // Each clump leans a little yellow or blue, and blades turned toward the sun are lighter.
    vec3 hue = mix(vec3(0.94, 1.0, 1.08), vec3(1.1, 1.04, 0.86), aRand.w);
    vec2 faceW = mat2(ca, -sa, sa, ca) * aFace;
    float facing = abs(dot(faceW, normalize(uSunDirV.xz + 1e-4)));
    vFieldColor = mix(grassCol * 0.84, grassCol * vec3(1.3, 1.27, 1.1), tip) * hue * (0.9 + 0.2 * facing);
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
  const base = kind === 'grass' ? grassClump(settings.inner ? 'far' : 'near') : flower();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('aPart', base.getAttribute('aPart'));
  geo.setAttribute('aFace', base.getAttribute('aFace'));
  // Real (upward) normals: without a normal attribute three.js silently switches to flat
  // shading, which lights every blade differently.
  const up = new Float32Array(base.getAttribute('position').count * 3);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));

  const wrap = settings.radius * 2;
  const r = rand(kind === 'grass' ? (settings.inner ? 303 : 101) : 202);
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
    ...pathUniforms(),
    bqNoise: { value: getNoiseTexture() },
    bqGround: { value: ground.texture },
    bqGroundExtent: { value: ground.extent },
    uFocus: { value: new THREE.Vector2() },
    uWrap: { value: wrap },
    uRadius: { value: settings.radius },
    uInner: { value: settings.inner ?? 0 },
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uSunDirV: atmosphere.uniforms.bqSunDir,
    uSunColorF: { value: new THREE.Color() },
    uMaxHeight: { value: kind === 'grass' ? 0.6 : 0.44 },
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
  const name = kind === 'grass' && settings.inner ? 'grassFar' : kind;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
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
