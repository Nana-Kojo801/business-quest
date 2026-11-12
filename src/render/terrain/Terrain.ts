import * as THREE from 'three';
import { TERRAIN, heightAt, pathMask } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import { GRASS_COLOR_GLSL, PALETTE_UNIFORMS_GLSL, paletteUniforms } from './palette';


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
${PALETTE_UNIFORMS_GLSL}
uniform float tWaterLevel;
${NOISE_GLSL}
${GRASS_COLOR_GLSL}

vec3 terrainColor() {
  vec2 p = vTWorld.xz;
  float n1, n2, stroke;
  vec3 c = bqGrassColor(p, n1, n2, stroke);
  // Fine detail that shows up close: small clumps and short directional strokes.
  float fine = bqNoiseD(p * 2.4) * 0.6 + bqNoiseB(vec2(dot(p, vec2(0.8, 0.6)) * 6.0, dot(p, vec2(-0.6, 0.8)) * 1.6)) * 0.4;
  c *= 0.8 + 0.4 * fine;

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
  const uniforms: Record<string, THREE.IUniform> = {
    tWaterLevel: { value: TERRAIN.waterLevel },
    bqNoise: { value: getNoiseTexture() },
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
