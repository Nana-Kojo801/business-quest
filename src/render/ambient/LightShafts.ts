import * as THREE from 'three';
import { OBSTACLES, TERRAIN, heightAt, obstacleAt, structureAt } from '../../core';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Soft shafts of sunlight slanting down through the groves. Each is a strip
 * leaning toward the sun and turned around its own axis to face the camera. They show most when you look toward the sun, as real shafts do, and
 * fade near the camera so you never walk "into" one.
 */
const vertex = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aParams; // width, length, phase, strength
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vStrength;
varying float vPhase;
void main() {
  // An artistic axis: mostly upright, leaning toward the sun and a little sideways. A beam
  // aligned exactly with a low sun ahead points away from the camera and collapses on screen.
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-4, 0.0, 0.0));
  vec3 axis = normalize(vec3(0.0, 1.0, 0.0) + sunFlat * 0.45 + vec3(sunFlat.z, 0.0, -sunFlat.x) * 0.35);
  float v = uv.y;
  vec3 centre = aBase + axis * v * aParams.y;
  vec3 view = normalize(centre - cameraPosition);
  vec3 side = normalize(cross(axis, view));
  float width = aParams.x * (0.55 + 0.9 * v); // wider toward the sky
  vec3 world = centre + side * (uv.x - 0.5) * width;
  vUv = uv;
  vPhase = aParams.z;
  float camDist = distance(world, cameraPosition);
  vStrength = aParams.w * smoothstep(4.0, 10.0, camDist);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uFacing;
varying vec2 vUv;
varying float vStrength;
varying float vPhase;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float soft = 1.0 - smoothstep(0.15, 1.0, across);
  float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  // Slowly drifting streaks inside the shaft.
  float streak = 0.55 + 0.45 * sin(vUv.x * 13.0 + vPhase * 6.0 + uTime * 0.25) * sin(vUv.x * 5.3 - uTime * 0.17 + vPhase);
  float a = soft * along * streak * vStrength * uFacing;
  gl_FragColor = vec4(uColor * a, a);
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

export function createLightShafts(atmosphere: Atmosphere, count: number) {
  const r = rng(77);
  // Anchor shafts in open ground near trees, 10-35 m ahead of the starting view, where they're seen.
  const trees = OBSTACLES.filter((o) => o.kind === 'tree');
  const bases: number[] = [];
  const params: number[] = [];
  for (let tries = 0; tries < 400 && bases.length / 3 < count; tries++) {
    const x = (r() - 0.5) * 50;
    const z = -10 - r() * 25;
    if (obstacleAt(x, z, 1.5) || structureAt(x, z, 2) || heightAt(x, z) < TERRAIN.waterLevel + 0.5) continue;
    const nearTree = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 6);
    if (!nearTree && r() > 0.25) continue;
    if (bases.some((_, i) => i % 3 === 0 && Math.hypot(bases[i] - x, bases[i + 2] - z) < 6)) continue;
    bases.push(x, heightAt(x, z) - 0.3, z);
    params.push(2.2 + r() * 2.0, 16 + r() * 8, r() * 10, 0.6 + r() * 0.4);
  }
  const geo = new THREE.InstancedBufferGeometry();
  const strip = new THREE.PlaneGeometry(1, 1, 1, 6).translate(0.5, 0.5, 0);
  geo.index = strip.index;
  geo.setAttribute('position', strip.getAttribute('position'));
  geo.setAttribute('uv', strip.getAttribute('uv'));
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(bases), 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  geo.instanceCount = bases.length / 3;

  const uniforms = {
    uSunDir: atmosphere.uniforms.bqSunDir,
    uColor: { value: new THREE.Color() },
    uTime: { value: 0 },
    uFacing: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'lightShafts';

  const forward = new THREE.Vector3();
  return {
    mesh,
    update(time: number, camera: THREE.Camera) {
      uniforms.uTime.value = time;
      uniforms.uColor.value.copy(atmosphere.sun.color).multiplyScalar(0.55);
      camera.getWorldDirection(forward);
      // More visible when looking toward the sun; a little always, never by a high noon sun.
      const toward = Math.max(forward.dot(atmosphere.uniforms.bqSunDir.value), 0);
      const lowSun = 1 - THREE.MathUtils.smoothstep(atmosphere.uniforms.bqSunDir.value.y, 0.35, 0.7);
      uniforms.uFacing.value = (0.35 + 0.65 * toward * toward) * lowSun;
    },
    dispose() {
      geo.dispose();
      strip.dispose();
      material.dispose();
    },
  };
}
