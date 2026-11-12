import * as THREE from 'three';
import { OBSTACLES, TERRAIN, heightAt } from '../../core';
import { GROUND_DATA_GLSL, type GroundData } from '../terrain/groundData';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Small moving lights and specks, all animated on the GPU:
 * - motes: pollen and dust drifting around the player, sparkling when backlit
 * - fireflies: blinking lights near the lake and groves (strongest at dusk)
 * - petals: drifting down from the blossom trees
 * Each is a point cloud with soft round sprites and additive blending.
 */
export interface ParticleSettings {
  motes: number;
  fireflies: number;
  petalsPerTree: number;
}

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

const COMMON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uSunDir;
uniform vec2 uWind;
uniform vec3 uFocus;
attribute vec4 aSeed;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${GROUND_DATA_GLSL}
// How strongly light scatters toward the camera off a speck between it and the sun.
float backlit(vec3 worldPos) {
  vec3 toSpeck = normalize(worldPos - cameraPosition);
  return pow(max(dot(toSpeck, uSunDir), 0.0), 4.0);
}
`;

const MOTES_VERTEX = /* glsl */ `
${COMMON_VERTEX}
uniform float uWrap;
uniform vec3 uMoteColor;
void main() {
  // Drift with the wind, wrapped in a box that follows the player.
  vec3 p = position + vec3(uWind.x, 0.0, uWind.y) * uTime * (0.25 + aSeed.x * 0.35);
  p.x += sin(uTime * (0.4 + aSeed.y) + aSeed.z * 6.28) * 0.6;
  p.z += cos(uTime * (0.3 + aSeed.z) + aSeed.y * 6.28) * 0.6;
  vec2 rel = mod(p.xz - uFocus.xz + 0.5 * uWrap, uWrap) - 0.5 * uWrap;
  vec2 xz = uFocus.xz + rel;
  float ground = bqGroundAt(xz).r;
  float y = ground + 0.25 + aSeed.w * 4.5 + sin(uTime * (0.5 + aSeed.x) + aSeed.w * 9.0) * 0.25;
  vec3 world = vec3(xz.x, y, xz.y);

  float edge = 1.0 - smoothstep(0.35, 0.5, length(rel) / uWrap);
  float twinkle = 0.6 + 0.4 * sin(uTime * (2.0 + aSeed.y * 3.0) + aSeed.x * 20.0);
  float glint = backlit(world);
  vColor = uMoteColor * (0.35 + 3.5 * glint) * twinkle;
  vAlpha = edge;
  vShape = 0.0;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.05 + 0.05 * aSeed.y) * uPixelRatio * 600.0 / -mv.z;
  vAlpha *= smoothstep(0.6, 2.0, -mv.z); // fade out right in front of the camera
}
`;

const FIREFLY_VERTEX = /* glsl */ `
${COMMON_VERTEX}
uniform vec3 uFlyColor;
uniform float uFlyStrength;
void main() {
  // Lazy loops around a home spot.
  float t = uTime * (0.25 + aSeed.x * 0.3) + aSeed.y * 6.28;
  vec3 world = position + vec3(sin(t) * 1.2, sin(t * 1.7 + aSeed.z * 3.0) * 0.35, cos(t * 0.8) * 1.2);
  float blink = smoothstep(0.55, 1.0, sin(uTime * (0.9 + aSeed.z * 1.4) + aSeed.w * 20.0));
  vColor = uFlyColor * blink * uFlyStrength;
  vAlpha = 1.0;
  vShape = 0.0;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 0.16 * uPixelRatio * 600.0 / -mv.z;
  vAlpha *= smoothstep(0.6, 2.0, -mv.z);
}
`;

const PETAL_VERTEX = /* glsl */ `
${COMMON_VERTEX}
uniform vec3 uPetalColor;
void main() {
  // Each petal falls from the crown over a few seconds, drifting downwind, then starts again.
  float period = 7.0 + aSeed.x * 5.0;
  float phase = fract(uTime / period + aSeed.y);
  float ground = bqGroundAt(position.xz).r;
  vec3 world = position;
  world.y = mix(position.y, ground + 0.05, phase);
  world.xz += vec2(uWind.x, uWind.y) * phase * (2.5 + aSeed.z * 2.0);
  world.x += sin(phase * 12.0 + aSeed.w * 6.28) * 0.35;
  world.z += cos(phase * 9.0 + aSeed.w * 6.28) * 0.35;
  float fadeIn = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.85, 1.0, phase));
  float glint = backlit(world);
  vColor = uPetalColor * (0.8 + 1.5 * glint);
  vAlpha = fadeIn * (1.0 - smoothstep(18.0, 24.0, distance(world.xz, uFocus.xz)));
  // Tumbling: the sprite flattens and widens as the petal turns.
  vShape = 0.25 + 0.75 * abs(sin(uTime * (2.0 + aSeed.z * 2.0) + aSeed.x * 10.0));
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 0.12 * uPixelRatio * 600.0 / -mv.z;
  vAlpha *= smoothstep(0.6, 2.0, -mv.z);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  // Petals squash into tumbling ellipses; motes and fireflies stay round.
  if (vShape > 0.0) d.y /= max(vShape, 0.2);
  float r = length(d) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

function points(geo: THREE.BufferGeometry, vertexShader: string, uniforms: Record<string, THREE.IUniform>, additive: boolean) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

function seeds(count: number, r: () => number) {
  const s = new Float32Array(count * 4);
  for (let i = 0; i < s.length; i++) s[i] = r();
  return new THREE.BufferAttribute(s, 4);
}

export function createParticles(atmosphere: Atmosphere, ground: GroundData, settings: ParticleSettings, pixelRatio: () => number) {
  const group = new THREE.Group();
  group.name = 'particles';
  const shared = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uSunDir: atmosphere.uniforms.bqSunDir,
    uWind: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uFocus: { value: new THREE.Vector3() },
    bqGround: { value: ground.texture },
    bqGroundExtent: { value: ground.extent },
  };
  const fireflyStrength = { value: 1 };

  // Motes around the player.
  if (settings.motes > 0) {
    const r = rng(11);
    const wrap = 26;
    const pos = new Float32Array(settings.motes * 3);
    for (let i = 0; i < settings.motes; i++) pos.set([r() * wrap, 0, r() * wrap], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', seeds(settings.motes, r));
    group.add(points(g, MOTES_VERTEX, { ...shared, uWrap: { value: wrap }, uMoteColor: { value: new THREE.Color('#fff1c9') } }, true));
  }

  // Fireflies near the lake shore and under trees.
  if (settings.fireflies > 0) {
    const r = rng(22);
    const homes: [number, number][] = [];
    const trees = OBSTACLES.filter((o) => o.kind === 'tree' && Math.hypot(o.x, o.z) < 38);
    for (let i = 0; i < settings.fireflies; i++) {
      if (i % 2 === 0) {
        const a = r() * Math.PI * 2;
        const d = TERRAIN.lake.radius * (0.9 + r() * 0.4);
        homes.push([TERRAIN.lake.x + Math.cos(a) * d, TERRAIN.lake.z + Math.sin(a) * d]);
      } else {
        const t = trees[Math.floor(r() * trees.length)];
        homes.push([t.x + (r() - 0.5) * 4, t.z + (r() - 0.5) * 4]);
      }
    }
    const pos = new Float32Array(homes.length * 3);
    homes.forEach(([x, z], i) => pos.set([x, Math.max(heightAt(x, z), TERRAIN.waterLevel) + 0.6 + r() * 1.2, z], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', seeds(homes.length, r));
    group.add(
      points(g, FIREFLY_VERTEX, { ...shared, uFlyColor: { value: new THREE.Color('#e9ff8a').multiplyScalar(3) }, uFlyStrength: fireflyStrength }, true),
    );
  }

  // Petals falling from blossom trees.
  const blossoms = OBSTACLES.filter((o) => o.kind === 'tree' && o.variant === 2 && Math.hypot(o.x, o.z) < 45);
  if (settings.petalsPerTree > 0 && blossoms.length) {
    const r = rng(33);
    const n = blossoms.length * settings.petalsPerTree;
    const pos = new Float32Array(n * 3);
    let k = 0;
    for (const t of blossoms) {
      for (let i = 0; i < settings.petalsPerTree; i++) {
        const a = r() * Math.PI * 2;
        const d = r() * 1.6 * t.scale;
        pos.set([t.x + Math.cos(a) * d, heightAt(t.x, t.z) + (2.6 + r() * 1.6) * t.scale, t.z + Math.sin(a) * d], k++ * 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', seeds(n, r));
    group.add(points(g, PETAL_VERTEX, { ...shared, uPetalColor: { value: new THREE.Color('#ffd2dc') } }, false));
  }

  return {
    group,
    update(time: number, focus: THREE.Vector3) {
      shared.uTime.value = time;
      shared.uPixelRatio.value = pixelRatio();
      shared.uFocus.value.copy(focus);
      // Fireflies come out as the light goes: faint at golden hour, bright at dusk, none by day.
      const preset = atmosphere.presetName;
      fireflyStrength.value = preset === 'dusk' ? 1 : preset === 'goldenHour' ? 0.55 : 0;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Points) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
  };
}
