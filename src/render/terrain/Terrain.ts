import * as THREE from 'three';
import { TERRAIN, heightAt } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { GRASS_COLOR_GLSL, PALETTE_UNIFORMS_GLSL, paletteUniforms } from './palette';
import { GROUND_DATA_GLSL, type GroundData } from './groundData';
import { PATH_GLSL, pathUniforms } from './pathGlsl';


const SIZE = 300; // world units across
const SEGMENTS = 220;

/**
 * Builds the ground mesh from the core height function, on a grid that is
 * dense near the player and sparse toward the horizon.
 */
function buildGeometry() {
  const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const half = SIZE / 2;
  // Warp grid coordinates so vertices bunch up near the centre.
  const warp = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), 1.7) * half;
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i));
    const z = warp(pos.getZ(i));
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const TERRAIN_PARS_VERTEX = /* glsl */ `
varying vec3 vTWorld;
varying vec3 vTNormal;
`;

const TERRAIN_VERTEX = /* glsl */ `
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const TERRAIN_PARS_FRAGMENT = /* glsl */ `
varying vec3 vTWorld;
varying vec3 vTNormal;
${PALETTE_UNIFORMS_GLSL}
uniform float tWaterLevel;
${NOISE_GLSL}
${PATH_GLSL}
${GROUND_DATA_GLSL}
${GRASS_COLOR_GLSL}

float bqHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** Scattered pebbles: at most one per cell, irregular, lit from the sun's side with a soft shadow opposite. */
vec3 pebbles(vec2 p, vec3 base, float amount) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = bqHash(cell);
  if (h > amount) return base;
  vec2 centre = 0.32 + 0.36 * vec2(bqHash(cell + 7.1), bqHash(cell + 3.7));
  float size = bqHash(cell + 1.3);
  float rad = 0.07 + 0.2 * size * size;
  vec2 q = (f - centre) * vec2(1.0, 1.25 + 0.4 * bqHash(cell + 5.5));
  // Lumpy outline rather than a perfect oval.
  float ang = atan(q.y, q.x);
  float d = length(q) * (1.0 + 0.16 * sin(ang * 3.0 + h * 40.0) + 0.08 * sin(ang * 5.0 + h * 17.0));
  float aa = fwidth(d) * 1.2;
  float stone = 1.0 - smoothstep(rad - aa, rad + aa, d);
  float shadow = 1.0 - smoothstep(rad * 0.9, rad * 1.6, length(q + bqSunDir.xz * rad * 0.55));
  vec3 col = mix(base * 1.35, mix(tRock, tRockWarm, 0.5), 0.35 + 0.35 * bqHash(cell + 9.2));
  col *= 0.82 + 0.3 * smoothstep(rad, -rad, dot(q, -bqSunDir.xz) + rad * 0.25);
  base *= 1.0 - 0.28 * shadow * (1.0 - stone);
  return mix(base, col, stone);
}

vec3 terrainColor() {
  vec2 p = vTWorld.xz;
  float camDist = distance(vTWorld, cameraPosition);
  float n1, n2, stroke;
  vec3 c = bqGrassColor(p, n1, n2, stroke);
  vec4 gd = bqGroundAt(p);
  // Fine detail that shows up close: small clumps and short directional strokes.
  float fine = bqNoiseD(p * 2.4) * 0.6 + bqNoiseB(vec2(dot(p, vec2(0.8, 0.6)) * 6.0, dot(p, vec2(-0.6, 0.8)) * 3.0)) * 0.4;
  c *= 0.8 + 0.4 * fine;
  // Micro detail under the blades (gaps between tufts), faded out with distance before it can shimmer.
  float near = 1.0 - smoothstep(5.0, 16.0, camDist);
  float micro = bqNoiseD(p * 11.0) * 0.55 + bqNoiseC(vec2(dot(p, vec2(0.8, 0.6)), dot(p, vec2(-0.6, 0.8))) * vec2(26.0, 9.0)) * 0.45;
  c *= mix(1.0, 0.8 + 0.34 * micro, near * gd.g);
  // Mid-distance tufts, so slopes beyond the drawn grass keep some texture; faded out as they
  // get smaller than a couple of pixels, before they can shimmer.
  float tuftPx = length(fwidth(p * 4.0));
  float tuft = bqNoiseC(p * 4.0 + 13.0) * 0.6 + bqNoiseD(p * 9.0) * 0.4;
  c *= mix(1.0, 0.86 + 0.26 * tuft, (1.0 - smoothstep(0.35, 0.9, tuftPx)) * (1.0 - near * gd.g));
  // Past the edge of the drawn grass, lift the ground to the blades' average colour (their tips
  // are lighter), so there is no line where the grass ends.
  c *= mix(1.0, 1.1, gd.g * smoothstep(8.0, 16.0, camDist));

  // Sandy shore and lake bed near the water line.
  float wl = vTWorld.y - tWaterLevel + (n2 - 0.5) * 0.35;
  c = mix(c, tSand, 1.0 - smoothstep(0.1, 0.65, wl));
  c = mix(c, tLakeBed, 1.0 - smoothstep(-0.6, -0.1, wl));

  // Footpaths: a crisp, irregular edge, a compacted darker rim just inside it, a worn lighter
  // centre, and a darker lip of grass just outside.
  float d = pathEdgeDistance(p);
  const float EDGE = PATH_EDGE;
  float aa = fwidth(d) * 0.8 + 0.015;
  float pm = 1.0 - smoothstep(EDGE - aa, EDGE + aa, d);
  if (pm > 0.0 || d < EDGE + 0.3) {
    vec3 dirt = mix(tDirtDark, tDirt, smoothstep(EDGE - 0.05, 0.1, d) * (0.7 + 0.3 * stroke));
    dirt *= 1.0 - 0.18 * (1.0 - smoothstep(EDGE - 0.22, EDGE - 0.02, d));
    // Trodden texture: soft mottling and fine grit.
    dirt *= 0.9 + 0.12 * bqNoiseC(p * 3.0) + 0.1 * (bqNoiseD(p * 18.0) - 0.5) * near;
    // Pebbles gather toward the edges; the trodden centre stays mostly clear.
    float edgeBand = smoothstep(0.25, EDGE - 0.1, d);
    if (near > 0.0) dirt = pebbles(p * 4.0, dirt, near * (0.04 + 0.2 * edgeBand));
    c *= 1.0 - 0.22 * (1.0 - smoothstep(EDGE, EDGE + 0.28, d)) * (1.0 - pm);
    c = mix(c, dirt, pm);
  }

  // Rock on steep slopes; warmer, lighter rock up high.
  float slope = 1.0 - clamp(vTNormal.y, 0.0, 1.0);
  float rockMask = smoothstep(0.24, 0.42, slope + (n2 - 0.5) * 0.18);
  vec3 rock = mix(tRock, tRockWarm, smoothstep(8.0, 30.0, vTWorld.y) * 0.7 + n1 * 0.3);
  rock *= 0.85 + 0.3 * stroke;
  c = mix(c, rock, rockMask);

  // Contact shading: darker and a little cooler where things meet the ground.
  c *= mix(vec3(1.0), vec3(0.5, 0.56, 0.68), gd.a);
  return c;
}
`;

export function createTerrain(ground: GroundData): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms: Record<string, THREE.IUniform> = {
    tWaterLevel: { value: TERRAIN.waterLevel },
    ...pathUniforms(),
    bqNoise: { value: getNoiseTexture() },
    bqGround: { value: ground.texture },
    bqGroundExtent: { value: ground.extent },
  };
  Object.assign(uniforms, paletteUniforms());
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_VERTEX}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TERRAIN_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_FRAGMENT}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = terrainColor();`);
  };
  material.customProgramCacheKey = () => 'bq-terrain';

  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'terrain';
  return mesh;
}
