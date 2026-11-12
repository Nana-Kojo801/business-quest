import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Light, edge-aware sharpening (in the spirit of contrast-adaptive sharpening).
 * Boosts the difference between a pixel and its four neighbours, then clamps
 * to the neighbours' range so edges get crisper without bright or dark halos.
 * Five texture reads per pixel.
 */
const fragment = /* glsl */ `
uniform float amount;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  vec3 sharp = c + amount * (4.0 * c - n - s - e - w);
  outputColor = vec4(clamp(sharp, lo, hi), inputColor.a);
}
`;

export class SharpenEffect extends Effect {
  constructor(amount = 0.4) {
    super('SharpenEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['amount', new Uniform(amount)]]),
    });
  }
}
