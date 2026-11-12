import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

/**
 * Colour grading for the final image, applied after tone mapping:
 * lift/gamma/gain, split toning (cool shadows, warm highlights), saturation,
 * contrast and an aspect-aware vignette.
 *
 * Split toning multiplies rather than adds, so black stays black: adding tint
 * to shadows lifts them and makes the image look milky.
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

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Grade in a perceptual (gamma) space, then return to linear.
  vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));

  c = gain * (c + lift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / gamma);

  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, l));

  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  // Contrast around a mid-grey pivot.
  c = (c - 0.45) * contrast + 0.45;

  // Vignette measured in screen-height units so portrait and landscape match.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - vignette * smoothstep(0.25, 0.95, length(d));

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
}

export const DEFAULT_GRADE: GradeSettings = {
  lift: [0, 0, 0],
  gamma: [1.0, 1.0, 1.0],
  gain: [1.02, 1.0, 0.98],
  /** Multipliers: shadows lean violet-blue, highlights lean gold. */
  shadowTint: [0.94, 0.95, 1.08],
  highlightTint: [1.05, 1.01, 0.93],
  saturation: 1.04,
  contrast: 1.12,
  vignette: 0.28,
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
      ]),
    });
  }
}
