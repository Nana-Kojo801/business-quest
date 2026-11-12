import * as THREE from 'three';
import { TERRAIN, heightAt, pathMask } from '../../core';

/** Terrain palette (sRGB). Tuned for golden-hour light. */
const PALETTE = {
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

const SIZE = 300; // world units across
const SEGMENTS = 220;

/**
 * Builds the ground mesh from the core height function, on a grid that is
 * dense near the player and sparse toward the horizon.
 */
function buildGeometry() {
  const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const path = new Float32Array(pos.count);
  const half = SIZE / 2;
  // Warp grid coordinates so vertices bunch up near the centre.
  const warp = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), 1.7) * half;
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i));
    const z = warp(pos.getZ(i));
    pos.setXYZ(i, x, heightAt(x, z), z);
    path[i] = pathMask(x, z);
  }
  geo.setAttribute('aPath', new THREE.BufferAttribute(path, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const TERRAIN_PARS_VERTEX = /* glsl */ `
attribute float aPath;
varying float vPath;
varying vec3 vTWorld;
varying vec3 vTNormal;
`;

const TERRAIN_VERTEX = /* glsl */ `
vPath = aPath;
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const TERRAIN_PARS_FRAGMENT = /* glsl */ `
varying float vPath;
varying vec3 vTWorld;
varying vec3 vTNormal;
uniform vec3 tGrassCool, tGrassWarm, tGrassDeep, tMeadowGold, tDirt, tDirtDark, tSand, tLakeBed, tRock, tRockWarm;
uniform float tWaterLevel;

float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}

vec3 terrainColor() {
  vec2 p = vTWorld.xz;
  float n1 = tNoise(p * 0.06);            // broad colour patches
  float n2 = tNoise(p * 0.31 + 17.0);     // medium breakup
  float n3 = tNoise(p * 0.85 + 41.0);     // fine dabs, visible up close
  // Brush strokes: noise stretched along one diagonal, like loaded-brush dabs.
  vec2 bp = vec2(dot(p, vec2(0.8, 0.6)) * 0.9, dot(p, vec2(-0.6, 0.8)) * 0.22);
  float stroke = tNoise(bp) * 0.65 + tNoise(bp * 2.3 + 5.0) * 0.35;

  // Grass: warm and cool greens in soft patches, deep green in hollows, gold meadow highlights.
  vec3 c = mix(tGrassCool, tGrassWarm, smoothstep(0.25, 0.75, n1 * 0.7 + n3 * 0.3));
  c = mix(c, tGrassDeep, smoothstep(0.58, 0.9, n2) * 0.45);
  c = mix(c, tMeadowGold, smoothstep(0.68, 0.9, n1 * 0.7 + stroke * 0.3) * 0.55);
  c *= 0.84 + 0.32 * stroke;

  // Sandy shore and lake bed near the water line.
  float wl = vTWorld.y - tWaterLevel + (n2 - 0.5) * 0.35;
  c = mix(c, tSand, 1.0 - smoothstep(0.1, 0.65, wl));
  c = mix(c, tLakeBed, 1.0 - smoothstep(-0.6, -0.1, wl));

  // Footpaths.
  float pm = smoothstep(0.3, 0.7, vPath + (n2 - 0.5) * 0.4);
  vec3 dirt = mix(tDirtDark, tDirt, stroke) ;
  c = mix(c, dirt, pm);

  // Rock on steep slopes; warmer, lighter rock up high.
  float slope = 1.0 - clamp(vTNormal.y, 0.0, 1.0);
  float rockMask = smoothstep(0.24, 0.42, slope + (n2 - 0.5) * 0.18);
  vec3 rock = mix(tRock, tRockWarm, smoothstep(8.0, 30.0, vTWorld.y) * 0.7 + n1 * 0.3);
  rock *= 0.85 + 0.3 * stroke;
  c = mix(c, rock, rockMask);
  return c;
}
`;

export function createTerrain(): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms: Record<string, THREE.IUniform> = { tWaterLevel: { value: TERRAIN.waterLevel } };
  for (const [k, v] of Object.entries(PALETTE)) {
    uniforms['t' + k[0].toUpperCase() + k.slice(1)] = { value: new THREE.Color(v) };
  }
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
