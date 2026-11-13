import * as THREE from 'three';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * Character materials, shared by every character.
 *
 * One toon material draws skin, cloth, leather, metal and hair: each vertex carries a
 * surface type (aMat) and the shader treats them differently:
 *  - shadows are coloured, not grey (warm on skin, cool on cloth, deep on hair);
 *  - cloth gets a fine weave and soft fold streaks, leather a grain and a small sheen,
 *    metal a bright glint, hair an anime "halo" highlight;
 *  - a rim of sunlight catches the edges.
 * Outlines are inverted hulls tinted from the part's own colour, kept at a constant
 * on-screen width so they never get heavy up close or vanish far away.
 */
export const enum Mat {
  Skin = 0,
  Cloth = 1,
  Leather = 2,
  Metal = 3,
  Hair = 4,
  /** Flat painted details (buttons, embroidery) that should not get texture. */
  Plain = 5,
}

export interface CharacterMaterials {
  body: THREE.MeshToonMaterial;
  cloth: THREE.MeshToonMaterial;
  outline: THREE.MeshBasicMaterial;
  gradientMap: THREE.DataTexture;
  uniforms: {
    uRim: { value: THREE.Color };
    uSunDirView: { value: THREE.Vector3 };
    uSunCol: { value: THREE.Color };
    uOutlineScale: { value: number };
  };
}

let shared: CharacterMaterials | null = null;

/** Soft two-tone ramp: shadow to lit across a narrow blended edge. */
function rampTexture() {
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const v = Math.round(255 * THREE.MathUtils.smoothstep(x, 0.42, 0.52));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERTEX_PARS = /* glsl */ `
attribute float aMat;
varying float vMat;
varying vec3 vObjPos;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uSunDirView;
uniform vec3 uSunCol;
varying float vMat;
varying vec3 vObjPos;
float chHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float chNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(chHash(i), chHash(i + vec2(1, 0)), f.x), mix(chHash(i + vec2(0, 1)), chHash(i + vec2(1, 1)), f.x), f.y);
}
`;

/** Surface detail on the base colour, before lighting. */
const COLOR_DETAIL = /* glsl */ `
#include <color_fragment>
{
  int m = int(vMat + 0.5);
  vec3 op = vObjPos;
  if (m == 1) {
    // Cloth: soft vertical fold streaks and a fine weave that fades before it can shimmer.
    float fold = chNoise(vec2(atan(op.x, op.z) * 5.0, op.y * 2.2));
    diffuseColor.rgb *= 0.9 + 0.14 * fold;
    vec2 wv = vec2(op.x + op.z, op.y) * 420.0;
    float weave = abs(sin(wv.x)) * abs(sin(wv.y));
    float fw = length(fwidth(wv));
    // Only visible in close-ups; gone long before the weave gets near pixel size.
    diffuseColor.rgb *= 1.0 - 0.05 * weave * (1.0 - smoothstep(0.15, 0.4, fw));
  } else if (m == 2) {
    // Leather: a mottled grain.
    diffuseColor.rgb *= 0.86 + 0.2 * chNoise(op.xy * 90.0 + op.z * 40.0);
  } else if (m == 4) {
    // Hair: subtle strand streaks running down the locks.
    diffuseColor.rgb *= 0.9 + 0.16 * chNoise(vec2(atan(op.x, op.z) * 22.0, op.y * 3.0));
  }
}
`;

/** Coloured shadows, glints, hair halo and rim light, after the toon lighting. */
const SHADING = /* glsl */ `
{
  int m = int(vMat + 0.5);
  // How lit this point is by the sun (0 shadow .. 1 lit), including cast shadows.
  const vec3 LUM = vec3(0.299, 0.587, 0.114);
  float lit = clamp(dot(reflectedLight.directDiffuse, LUM) / max(dot(uSunCol * diffuseColor.rgb, LUM), 1e-4), 0.0, 1.0);
  // Shadow tint per surface: warm, glowing skin; cool cloth; deep, rich hair.
  vec3 tint = vec3(1.0, 1.0, 1.1);
  if (m == 0) tint = vec3(1.22, 0.98, 1.0);
  else if (m == 2) tint = vec3(0.95, 0.88, 0.92);
  else if (m == 3) tint = vec3(0.9, 0.85, 1.0);
  else if (m == 4) tint = vec3(0.98, 0.92, 1.12);
  outgoingLight += reflectedLight.indirectDiffuse * (tint - 1.0) * (1.0 - lit);
  // Skin: soft, gradual light instead of a hard two-tone step, so faces keep their shape.
  if (m == 0) {
    float ndl = dot(normal, uSunDirView);
    vec3 softDirect = diffuseColor.rgb * uSunCol * smoothstep(-0.3, 0.8, ndl) * 0.9;
    outgoingLight += (softDirect - reflectedLight.directDiffuse) * 0.75;
    lit = mix(lit, smoothstep(-0.3, 0.8, ndl), 0.75);
  }
  // A warm band where light turns to shadow on skin (light scattering in skin).
  if (m == 0) outgoingLight += diffuseColor.rgb * vec3(0.16, 0.04, 0.02) * (1.0 - abs(lit * 2.0 - 1.0)) * length(uSunCol) * 0.25;

  vec3 V = normalize(vViewPosition);
  vec3 H = normalize(uSunDirView + V);
  float nh = max(dot(normal, H), 0.0);
  if (m == 3) {
    // Metal: a crisp toon glint and a bright top edge.
    float glint = smoothstep(0.8, 0.86, pow(nh, 2.0));
    outgoingLight += uSunCol * diffuseColor.rgb * (glint * 0.9 * lit + 0.25 * max(normal.y, 0.0));
  } else if (m == 2) {
    outgoingLight += uSunCol * 0.06 * smoothstep(0.86, 0.92, nh) * lit;
  } else if (m == 4) {
    // Hair halo: a crisp, narrow, broken band of shine across the upper head, facing the viewer.
    float wob = (chNoise(vec2(atan(vObjPos.x, vObjPos.z) * 9.0, 3.0)) - 0.5) * 0.12;
    float band = smoothstep(0.055, 0.02, abs(normal.y - 0.52 + wob)) * smoothstep(0.1, 0.45, normal.z);
    float broken = step(0.42, chNoise(vec2(atan(vObjPos.x, vObjPos.z) * 16.0, 0.0)));
    outgoingLight += mix(diffuseColor.rgb * 1.6, vec3(1.0), 0.3) * band * broken * (0.45 + 0.55 * lit) * length(uSunCol) * 0.15;
  }

  // Rim light from the sun on the silhouette.
  float facing = clamp(dot(normal, V), 0.0, 1.0);
  // (Skin gets only a little: on a sculpted face it would streak across the nose and lips.)
  outgoingLight += uRim * smoothstep(0.55, 0.78, 1.0 - facing) * diffuseColor.rgb * (m == 3 ? 1.6 : m == 0 ? 0.25 : 1.0);
}
`;

function patchToon(m: THREE.MeshToonMaterial, u: CharacterMaterials['uniforms'], key: string) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', COLOR_DETAIL)
      .replace('#include <opaque_fragment>', `${SHADING}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => key;
}

export function characterMaterials(atmosphere: Atmosphere): CharacterMaterials {
  if (shared) return shared;
  const uniforms = {
    uRim: { value: new THREE.Color() },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uOutlineScale: { value: 0.001 },
  };
  const gradientMap = rampTexture();
  const body = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const cloth = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide });
  patchToon(body, uniforms, 'bq-char-body');
  patchToon(cloth, uniforms, 'bq-char-cloth');

  // Outline: pushed out along the normal by a constant number of pixels, tinted from the part colour.
  const outline = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  outline.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineScale = uniforms.uOutlineScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineScale;')
      .replace(
        '#include <begin_vertex>',
        `vec4 bqView = modelViewMatrix * vec4(position, 1.0);
        vec3 transformed = position + normal * uOutlineScale * clamp(-bqView.z, 0.6, 30.0);`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      // Darker, slightly richer version of the part's own colour.
      '#include <color_fragment>\ndiffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.25)) * 0.32;',
    );
  };
  outline.customProgramCacheKey = () => 'bq-char-outline';

  for (const m of [body, cloth, outline]) atmosphere.patchMaterial(m);
  shared = { body, cloth, outline, gradientMap, uniforms };
  return shared;
}

const sunView = new THREE.Vector3();

/** Brightness (and a touch of the sun's colour) for drawn faces, which are not lit directly. */
export const faceLight = new THREE.Color(1, 1, 1);
const white = new THREE.Color(1, 1, 1);

/**
 * Once per frame: lighting follows the sun, and outlines keep a constant on-screen width
 * for this camera and viewport.
 */
export function updateCharacterLighting(atmosphere: Atmosphere, camera?: THREE.PerspectiveCamera, viewportHeightPx?: number) {
  if (!shared) return;
  const u = shared.uniforms;
  u.uRim.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.13);
  u.uSunCol.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity);
  const k = THREE.MathUtils.clamp(0.62 + 0.07 * atmosphere.sun.intensity + 0.05 * atmosphere.ambient.intensity, 0.6, 1.08);
  faceLight.copy(white).lerp(atmosphere.sun.color, 0.22).multiplyScalar(k);
  if (camera) {
    sunView.copy(atmosphere.uniforms.bqSunDir.value).transformDirection(camera.matrixWorldInverse);
    u.uSunDirView.value.copy(sunView);
    if (viewportHeightPx) {
      // Metres per pixel at 1 m depth, times the outline width in pixels.
      const px = 1.4;
      u.uOutlineScale.value = (px * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportHeightPx;
    }
  }
}
