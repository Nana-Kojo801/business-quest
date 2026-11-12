import * as THREE from 'three';

/** Ground palette (sRGB), shared by the terrain and the grass so blades match the ground. */
export const PALETTE = {
  grassCool: '#4f9156',
  grassWarm: '#9cc25a',
  grassDeep: '#3d7a50',
  meadowGold: '#c8c463',
  dirt: '#cfae82',
  dirtDark: '#a88664',
  sand: '#e2cc98',
  lakeBed: '#5e7f6a',
  rock: '#968c86',
  rockWarm: '#bca48e',
};

/** Uniforms named tGrassCool, tGrassWarm, ... */
export function paletteUniforms(): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {};
  for (const [k, v] of Object.entries(PALETTE)) u['t' + k[0].toUpperCase() + k.slice(1)] = { value: new THREE.Color(v) };
  return u;
}

export const PALETTE_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 tGrassCool, tGrassWarm, tGrassDeep, tMeadowGold, tDirt, tDirtDark, tSand, tLakeBed, tRock, tRockWarm;
`;

/**
 * Meadow colour at a ground position. Requires NOISE_GLSL and PALETTE_UNIFORMS_GLSL.
 * Also returns the noise values the terrain reuses for shores, paths and rock.
 */
export const GRASS_COLOR_GLSL = /* glsl */ `
vec3 bqGrassColor(vec2 p, out float n1, out float n2, out float stroke) {
  n1 = bqNoiseA(p * 0.06);             // broad colour patches
  n2 = bqNoiseB(p * 0.31 + 17.0);      // medium breakup
  float n3 = bqNoiseC(p * 0.85 + 41.0); // fine dabs, visible up close
  // Brush strokes: noise stretched along one diagonal, like loaded-brush dabs.
  vec2 bp = vec2(dot(p, vec2(0.8, 0.6)) * 0.9, dot(p, vec2(-0.6, 0.8)) * 0.22);
  stroke = bqNoiseD(bp) * 0.65 + bqNoiseA(bp * 2.3 + 5.0) * 0.35;

  // Warm and cool greens in soft patches, deep green in hollows, gold meadow highlights.
  vec3 c = mix(tGrassCool, tGrassWarm, smoothstep(0.25, 0.75, n1 * 0.7 + n3 * 0.3));
  c = mix(c, tGrassDeep, smoothstep(0.58, 0.9, n2) * 0.45);
  c = mix(c, tMeadowGold, smoothstep(0.68, 0.9, n1 * 0.7 + stroke * 0.3) * 0.55);
  return c * (0.84 + 0.32 * stroke);
}
`;
