import * as THREE from 'three';
import { TERRAIN, heightAt } from '../../core';
import { NOISE_GLSL, getNoiseTexture } from '../noiseTexture';
import {
  ATMOSPHERE_UNIFORMS_GLSL,
  FOG_FRAGMENT_GLSL,
  FOG_UNIFORMS_GLSL,
  SKY_COLOR_GLSL,
} from '../sky/atmosphereGlsl';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Stylized lake water:
 * - colour by depth: clear turquoise shallows to deep blue
 * - reflects the real sky colour (same function as the sky dome) with fresnel
 * - sun glints bright enough to catch the bloom
 * - animated foam along the shore
 * - ripples from the baked noise texture, so it stays cheap on phones
 *
 * Depth below the surface is baked per vertex from the core height function.
 */
const vertex = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vBqWorldPos;
void main() {
  vDepth = aDepth;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vBqWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
${ATMOSPHERE_UNIFORMS_GLSL}
${FOG_UNIFORMS_GLSL}
${SKY_COLOR_GLSL}
${NOISE_GLSL}
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSunColor;
varying float vDepth;

void main() {
  if (vDepth < -0.02) discard; // above the water line

  vec3 wp = vBqWorldPos;
  vec3 V = normalize(cameraPosition - wp);
  float t = uTime;

  // Two ripple layers drifting in different directions; noise channels stand in for slopes.
  vec4 a = texture2D(bqNoise, (wp.xz * 0.7 + vec2(t * 0.08, t * 0.05)) / 8.0);
  vec4 b = texture2D(bqNoise, (wp.xz * 1.8 + vec2(-t * 0.11, t * 0.09)) / 16.0);
  vec2 slope = (a.gb - 0.5) * 0.14 + (b.ba - 0.5) * 0.09;
  vec3 N = normalize(vec3(slope.x, 1.0, slope.y));

  // Body colour by depth.
  vec3 body = mix(uShallow, uDeep, smoothstep(0.05, 2.0, vDepth));

  // Sky reflection with fresnel: stronger at grazing angles.
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  // Capped so the lake keeps its own colour instead of turning into a mirror of the horizon.
  float fres = 0.05 + 0.55 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(body, bqSkyColor(normalize(R)), fres);

  // Sun glints: a tight highlight broken into sparkles by the ripples.
  float sunDot = max(dot(R, bqSunDir), 0.0);
  float glint = pow(sunDot, 350.0) * 30.0;
  float sparkle = smoothstep(0.62, 0.72, b.r) * pow(sunDot, 40.0) * 6.0;
  col += uSunColor * (glint + sparkle);

  // Shore foam: a band that breathes in and out, broken up by noise.
  float fn = texture2D(bqNoise, (wp.xz * 0.7 + t * 0.03) / 16.0).g;
  float breathe = 0.28 + 0.12 * sin(t * 1.3 + fn * 6.2831);
  float band = 1.0 - smoothstep(0.0, breathe, vDepth);
  float foam = smoothstep(0.5, 0.62, band * 0.75 + fn * 0.45) * band;
  col = mix(col, uFoam, foam);

  // See the lake bed through shallow water; fade the very edge so the shoreline is soft.
  float alpha = mix(0.5, 0.94, smoothstep(0.0, 1.4, vDepth));
  alpha = max(alpha, foam * 0.95);
  alpha *= smoothstep(-0.02, 0.05, vDepth);

  gl_FragColor = vec4(col, alpha);
  ${FOG_FRAGMENT_GLSL}
}
`;

export function createWater(atmosphere: Atmosphere): { mesh: THREE.Mesh; update: (time: number) => void } {
  const { lake, waterLevel } = TERRAIN;
  const size = lake.radius * 3.4;
  const seg = 96;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(lake.x, waterLevel, lake.z);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = waterLevel - heightAt(pos.getX(i), pos.getZ(i));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

  const uniforms = {
    ...atmosphere.uniforms,
    bqNoise: { value: getNoiseTexture() },
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color('#58d0c0') },
    uDeep: { value: new THREE.Color('#236a8c') },
    uFoam: { value: new THREE.Color('#fff4e2') },
    uSunColor: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'water';
  mesh.renderOrder = 1;

  return {
    mesh,
    update(time: number) {
      uniforms.uTime.value = time;
      uniforms.uSunColor.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.5);
    },
  };
}
