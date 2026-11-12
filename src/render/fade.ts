import * as THREE from 'three';

/**
 * Dissolve for world objects that get in the way of the view, shared by trees,
 * rocks, buildings and props:
 *  - anything between the camera and the player fades out completely, so the
 *    player is never hidden;
 *  - anything right in front of the lens fades out, so a post or trunk never
 *    fills the screen as a big smear.
 *
 * Uses ordered-dither discard (screen-door transparency): no sorting, almost
 * free. The fade reaches 100%, so a fully dissolved object leaves no dot
 * pattern behind; only the short transition band is dithered.
 *
 * Requires the vBqWorldPos varying that `atmosphere.adopt()` adds.
 */
export const FADE_PARS = /* glsl */ `
uniform vec3 uPlayerPos;
float bqBayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[int(i)] + 0.5) / 16.0;
}
`;

export const FADE = /* glsl */ `
{
  float fade = 0.0;
  vec3 rel = vBqWorldPos - cameraPosition;
#ifndef BQ_NO_OCCLUSION_FADE
  vec3 seg = uPlayerPos + vec3(0.0, 0.8, 0.0) - cameraPosition;
  float segLen = length(seg);
  vec3 segDir = seg / max(segLen, 1e-4);
  float along = dot(rel, segDir);
  float off = length(rel - segDir * along);
  // Only in front of the player, close to the camera-player line.
  float block = step(0.0, along) * (1.0 - smoothstep(segLen - 1.5, segLen - 0.5, along));
  fade = block * (1.0 - smoothstep(1.55, 1.85, off));
#endif
  // Right in front of the lens.
  fade = max(fade, 1.0 - smoothstep(0.9, 1.25, length(rel)));
  if (fade > bqBayer4(gl_FragCoord.xy) - 0.001) discard;
}
`;

/**
 * Add the dissolve to a material (chains onto any existing shader changes).
 * Call before `atmosphere.adopt()`, which supplies vBqWorldPos.
 */
export function addFade(
  material: THREE.Material,
  uniforms: { uPlayerPos: THREE.IUniform<THREE.Vector3> },
  { occlusion = true } = {},
) {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uPlayerPos = uniforms.uPlayerPos;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${occlusion ? '' : '#define BQ_NO_OCCLUSION_FADE'}\n${FADE_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FADE}`);
  };
  material.customProgramCacheKey = () => previousKey() + (occlusion ? '|bq-fade' : '|bq-fade-near');
}
