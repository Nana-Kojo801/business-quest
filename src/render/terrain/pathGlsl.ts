import * as THREE from 'three';
import { TERRAIN } from '../../core';

/**
 * The footpath edge, shared by the ground (which draws the path) and the grass
 * (which grows right up to it), so the two always agree to the centimetre.
 * Computed per pixel/vertex from the path segments, so the edge stays crisp up
 * close. Requires NOISE_GLSL.
 */
export const PATH_SEGMENTS: THREE.Vector4[] = TERRAIN.paths.flatMap((path) =>
  path.slice(0, -1).map((a, i) => new THREE.Vector4(a[0], a[1], path[i + 1][0], path[i + 1][1])),
);

/** Distance at which the path's (wobbled) edge lies. */
export const PATH_EDGE = 0.9;

export const PATH_GLSL = /* glsl */ `
uniform vec4 tPathSeg[${PATH_SEGMENTS.length}];
const float PATH_EDGE = ${PATH_EDGE.toFixed(2)};
/** Distance to the nearest path centreline, plus a wobble so edges look trodden, not ruled. */
float pathEdgeDistance(vec2 p) {
  float d = 1e4;
  for (int i = 0; i < ${PATH_SEGMENTS.length}; i++) {
    vec4 s = tPathSeg[i];
    vec2 ab = s.zw - s.xy;
    float t = clamp(dot(p - s.xy, ab) / dot(ab, ab), 0.0, 1.0);
    d = min(d, length(p - s.xy - ab * t));
  }
  return d + (bqNoiseB(p * 0.6 + 3.0) - 0.5) * 0.9 + (bqNoiseC(p * 4.0) - 0.5) * 0.14;
}
`;

export const pathUniforms = () => ({ tPathSeg: { value: PATH_SEGMENTS } });
