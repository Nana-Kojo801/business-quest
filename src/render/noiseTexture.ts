import * as THREE from 'three';

/**
 * A tiling noise texture baked once at startup. Phone GPUs read textures far
 * more cheaply than they compute noise, so shaders sample this instead of
 * hashing per pixel.
 *
 * Each channel holds smooth value noise at a different scale across the same
 * texture: R = 8 cells, G = 16, B = 32, A = 64. Because each is twice as fine
 * as the last, one lookup gives a ready-made four-octave stack.
 */
const SIZE = 256;
const PERIODS = [8, 16, 32, 64];

function hash(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable value noise: lattice coordinates wrap at `period`. */
function tileNoise(u: number, v: number, period: number, seed: number) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(ix), w(iy), seed);
  const b = hash(w(ix + 1), w(iy), seed);
  const c = hash(w(ix), w(iy + 1), seed);
  const d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function bakeNoiseData(size = SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        data[i + c] = Math.round(tileNoise(x / size, y / size, PERIODS[c], c + 1) * 255);
      }
    }
  }
  return data;
}

let shared: THREE.DataTexture | null = null;

export function getNoiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  const tex = new THREE.DataTexture(bakeNoiseData(), SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}

/**
 * GLSL helpers. Each `bqNoiseN(p)` is smooth noise with roughly one feature per
 * unit of p (like a classic value-noise call), drawn from a different channel
 * so separate calls don't look alike. `bqFbm(p)` is a four-octave stack in one lookup.
 */
export const NOISE_GLSL = /* glsl */ `
uniform sampler2D bqNoise;
float bqNoiseA(vec2 p) { return texture2D(bqNoise, p / 8.0).r; }
float bqNoiseB(vec2 p) { return texture2D(bqNoise, p / 16.0).g; }
float bqNoiseC(vec2 p) { return texture2D(bqNoise, p / 32.0).b; }
float bqNoiseD(vec2 p) { return texture2D(bqNoise, p / 64.0).a; }
float bqFbm(vec2 p) { return dot(texture2D(bqNoise, p / 8.0), vec4(0.5333, 0.2667, 0.1333, 0.0667)); }
`;
