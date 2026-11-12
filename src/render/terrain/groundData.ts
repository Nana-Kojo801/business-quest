import * as THREE from 'three';
import { OBSTACLES, STRUCTURES, TERRAIN, heightAt, noise2, smoothstep } from '../../core';

/**
 * A texture baked once at startup that lets GPU shaders know about the ground:
 *   R = height, G = grass density (0..1), B = flower density (0..1),
 *   A = contact shading (0..1): soft darkening where trees, rocks, buildings and
 *       posts meet the ground, and under tree crowns.
 * Grass and flowers read it in their vertex shaders, so they follow the land
 * with no per-frame work on the CPU; the terrain reads it for colour.
 */
export const GROUND_DATA_EXTENT = 64; // covers [-64, 64] on x and z
const SIZE = 256;

export interface GroundData {
  texture: THREE.DataTexture;
  extent: number;
}

/** A soft disc of darkening: full strength inside `inner`, gone at `outer`. */
interface Shade {
  x: number;
  z: number;
  inner: number;
  outer: number;
  strength: number;
}

/** Where things meet the ground. Reusable: every new kind of object adds its shading here. */
function contactShades(): Shade[] {
  const out: Shade[] = [];
  for (const o of OBSTACLES) {
    if (o.kind === 'tree') {
      // Shade under the crown, and a tighter, darker ring where the trunk meets the ground.
      out.push({ x: o.x, z: o.z, inner: 0.4 * o.scale, outer: 2.6 * o.scale, strength: 0.42 });
      out.push({ x: o.x, z: o.z, inner: 0.15, outer: 0.85 * o.scale, strength: 0.35 });
    } else {
      out.push({ x: o.x, z: o.z, inner: o.r * 0.85, outer: o.r * 1.5 + 0.35, strength: 0.6 });
    }
  }
  for (const s of STRUCTURES) {
    if (s.kind === 'tower') out.push({ x: s.x, z: s.z, inner: s.r * 0.95, outer: s.r + 1.3, strength: 0.5 });
    else if (s.kind === 'stall') out.push({ x: s.x, z: s.z, inner: s.r * 0.5, outer: s.r + 0.7, strength: 0.45 });
    else out.push({ x: s.x, z: s.z, inner: 0.05, outer: 0.65, strength: 0.4 });
  }
  return out;
}

export function bakeGroundData(): GroundData {
  const shades = contactShades();
  const values = new Float32Array(SIZE * SIZE * 4);
  const step = (GROUND_DATA_EXTENT * 2) / (SIZE - 1);
  const boulders = OBSTACLES.filter((o) => o.kind === 'boulder');

  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = -GROUND_DATA_EXTENT + i * step;
      const z = -GROUND_DATA_EXTENT + j * step;
      const h = heightAt(x, z);
      const e = 0.6;
      const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);

      let grass = 1;
      // Footpaths are cut out on the GPU with the same edge the ground draws (pathGlsl.ts).
      grass *= smoothstep(TERRAIN.waterLevel + 0.45, TERRAIN.waterLevel + 0.9, h); // not on sand or in water
      grass *= 1 - smoothstep(0.65, 1.0, slope); // thin only on steep ground
      grass *= 1 - smoothstep(48, 60, Math.hypot(x, z)); // fades out up the mountains
      for (const b of boulders) {
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < b.r + 0.6) grass *= smoothstep(b.r * 0.7, b.r + 0.6, d); // not under rocks
      }
      // A little natural patchiness.
      grass *= 0.65 + 0.35 * smoothstep(0.25, 0.6, noise2(x * 0.12, z * 0.12, 31));

      // Flowers grow in drifts within the grass.
      const flowers = grass * smoothstep(0.5, 0.7, noise2(x * 0.07, z * 0.07, 37));

      const k = (j * SIZE + i) * 4;
      values[k] = h;
      values[k + 1] = grass;
      values[k + 2] = flowers;
      // Contact shading: darkenings combine like overlapping shadows, never past black.
      let lit = 1;
      for (const sh of shades) {
        const dx = x - sh.x;
        const dz = z - sh.z;
        if (Math.abs(dx) > sh.outer || Math.abs(dz) > sh.outer) continue;
        lit *= 1 - sh.strength * (1 - smoothstep(sh.inner, sh.outer, Math.hypot(dx, dz)));
      }
      values[k + 3] = 1 - lit;
    }
  }

  const half = new Uint16Array(values.length);
  for (let n = 0; n < values.length; n++) half[n] = THREE.DataUtils.toHalfFloat(values[n]);
  const texture = new THREE.DataTexture(half, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, extent: GROUND_DATA_EXTENT };
}

/** GLSL: sample ground data at a world xz position. */
export const GROUND_DATA_GLSL = /* glsl */ `
uniform sampler2D bqGround;
uniform float bqGroundExtent;
vec4 bqGroundAt(vec2 xz) {
  // Texel centres span [-extent, extent]; map so the first/last texel centres land on the edges.
  vec2 uv = (xz / bqGroundExtent * 0.5 + 0.5) * (255.0 / 256.0) + 0.5 / 256.0;
  return texture2D(bqGround, uv);
}
`;
