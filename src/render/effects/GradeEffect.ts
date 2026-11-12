import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

/**
 * Colour grading for the final image, applied after tone mapping:
 * lift/gamma/gain, split toning (cool shadows, warm highlights), saturation,
 * contrast, an aspect-aware vignette, and a faint canvas texture.
 */
const fragment = /* glsl */ `
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float canvas;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Grade in a perceptual (gamma) space, then return to linear.
  vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));

  c = gain * (c + lift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / gamma);

  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += shadowTint * (1.0 - smoothstep(0.0, 0.55, l));
  c += highlightTint * smoothstep(0.45, 1.0, l);

  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;

  // Vignette measured in screen-height units so portrait and landscape match.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - vignette * smoothstep(0.25, 0.95, length(d));

  // Canvas: two octaves of soft noise, tied to screen pixels.
  vec2 px = uv * resolution;
  float n = noise(px * 0.35) * 0.6 + noise(px * 0.9) * 0.4;
  c *= 1.0 + (n - 0.5) * canvas;

  outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

export interface GradeSettings {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  canvas: number;
}

export const DEFAULT_GRADE: GradeSettings = {
  lift: [0.02, 0.0, 0.05],
  gamma: [1.0, 1.0, 1.02],
  gain: [1.04, 1.0, 0.97],
  shadowTint: [0.01, -0.005, 0.04],
  highlightTint: [0.03, 0.015, -0.02],
  saturation: 1.12,
  contrast: 1.06,
  vignette: 0.32,
  canvas: 0.05,
};

export class GradeEffect extends Effect {
  constructor(s: GradeSettings = DEFAULT_GRADE) {
    const v = (a: [number, number, number]) => new Uniform(new Vector3(...a));
    super('GradeEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ['lift', v(s.lift)],
        ['gamma', v(s.gamma)],
        ['gain', v(s.gain)],
        ['shadowTint', v(s.shadowTint)],
        ['highlightTint', v(s.highlightTint)],
        ['saturation', new Uniform(s.saturation)],
        ['contrast', new Uniform(s.contrast)],
        ['vignette', new Uniform(s.vignette)],
        ['canvas', new Uniform(s.canvas)],
      ]),
    });
  }
}
