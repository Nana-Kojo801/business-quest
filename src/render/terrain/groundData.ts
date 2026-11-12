import * as THREE from 'three';
import { OBSTACLES, TERRAIN, heightAt, noise2, pathMask, smoothstep } from '../../core';

/**
 * A texture baked once at startup that lets GPU shaders know about the ground:
 *   R = height, G = grass density (0..1), B = flower density (0..1).
 * Grass and flowers read it in their vertex shaders, so they follow the land
 * with no per-frame work on the CPU.
 */
export const GROUND_DATA_EXTENT = 64; // covers [-64, 64] on x and z
const SIZE = 256;

export interface GroundData {
  texture: THREE.DataTexture;
  extent: number;
}

export function bakeGroundData(): GroundData {
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
      grass *= 1 - smoothstep(0.25, 0.75, pathMask(x, z)); // not on footpaths
      grass *= smoothstep(TERRAIN.waterLevel + 0.45, TERRAIN.waterLevel + 0.9, h); // not on sand or in water
      grass *= 1 - smoothstep(0.45, 0.8, slope); // thin on steep ground
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
      values[k + 3] = 1;
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
