/**
 * GLSL shared by the sky dome and by every world material's fog, so distant
 * objects fade into exactly the colour of the sky behind them.
 */
export const ATMOSPHERE_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 bqSunDir;
uniform vec3 bqZenith;
uniform vec3 bqSkyMid;
uniform vec3 bqHorizon;
uniform vec3 bqSunGlow;
uniform float bqGlowPower;
`;

export const SKY_COLOR_GLSL = /* glsl */ `
vec3 bqSkyColor(vec3 dir) {
  float up = clamp(dir.y, 0.0, 1.0);
  // Blue arrives quickly above the horizon so even a low camera sees it.
  vec3 col = mix(bqHorizon, bqSkyMid, smoothstep(0.0, 0.16, up));
  col = mix(col, bqZenith, smoothstep(0.12, 0.7, up));
  float s = max(dot(dir, bqSunDir), 0.0);
  // A tight glow around the sun plus a broad warm wash along the horizon.
  float band = 1.0 - smoothstep(0.0, 0.45, abs(dir.y));
  col += bqSunGlow * (pow(s, bqGlowPower) + pow(s, 2.5) * 0.2 * band);
  return col;
}
`;

export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform float bqFogStart;
uniform float bqFogDensity;
uniform float bqFogHeightFalloff;
varying vec3 vBqWorldPos;
`;

/**
 * Distance fog that is clear near the player, thickens with distance and is
 * denser close to the ground. Fog colour is the horizon colour in that direction.
 */
export const FOG_FRAGMENT_GLSL = /* glsl */ `
{
  vec3 bqToFrag = vBqWorldPos - cameraPosition;
  float bqDist = length(bqToFrag);
  vec3 bqDir = bqToFrag / max(bqDist, 1e-4);
  float bqD = max(bqDist - bqFogStart, 0.0) * bqFogDensity;
  float bqLow = exp(-max(vBqWorldPos.y, 0.0) * bqFogHeightFalloff);
  float bqFog = 1.0 - exp(-bqD * bqD * (0.55 + 0.45 * bqLow));
  vec3 bqFogCol = bqSkyColor(normalize(vec3(bqDir.x, 0.015, bqDir.z)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, bqFogCol, clamp(bqFog, 0.0, 1.0));
}
`;

export const WORLD_POS_VERTEX_GLSL = /* glsl */ `
{
  vec4 bqWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    bqWorld = instanceMatrix * bqWorld;
  #endif
  vBqWorldPos = (modelMatrix * bqWorld).xyz;
}
`;
