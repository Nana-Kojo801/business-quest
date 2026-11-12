import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Painterly filter: a soft generalized Kuwahara filter.
 *
 * Each pixel looks at four overlapping square regions around it, and blends their
 * average colours, favouring the flattest (lowest-variance) region. Flat areas
 * become smooth brush-like patches while edges stay crisp, which reads as paint.
 *
 * Cost is 4 * (RADIUS + 1)^2 texture reads per pixel, so the quality tier picks
 * RADIUS (0 disables the effect entirely by removing it from the pipeline).
 */
const fragment = /* glsl */ `
uniform float strength;
uniform float sharpness;

vec3 compress(vec3 c) { return c / (1.0 + c); } // tame HDR values for the variance test

void sector(const in vec2 uv, const in vec2 dir, inout vec3 avg, inout float sigma) {
  vec3 sum = vec3(0.0);
  vec3 sumSq = vec3(0.0);
  for (int y = 0; y <= RADIUS; y++) {
    for (int x = 0; x <= RADIUS; x++) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(x), float(y)) * dir * texelSize).rgb;
      vec3 k = compress(c);
      sum += c;
      sumSq += k * k;
    }
  }
  const float n = float((RADIUS + 1) * (RADIUS + 1));
  avg = sum / n;
  vec3 m = compress(avg);
  vec3 v = abs(sumSq / n - m * m);
  sigma = v.r + v.g + v.b;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 a0 = vec3(0.0), a1 = vec3(0.0), a2 = vec3(0.0), a3 = vec3(0.0);
  float s0 = 0.0, s1 = 0.0, s2 = 0.0, s3 = 0.0;
  sector(uv, vec2(-1.0, -1.0), a0, s0);
  sector(uv, vec2( 1.0, -1.0), a1, s1);
  sector(uv, vec2(-1.0,  1.0), a2, s2);
  sector(uv, vec2( 1.0,  1.0), a3, s3);

  // Soft selection: low variance sectors dominate, but nothing snaps.
  float w0 = 1.0 / (1e-4 + pow(s0 * sharpness, 4.0));
  float w1 = 1.0 / (1e-4 + pow(s1 * sharpness, 4.0));
  float w2 = 1.0 / (1e-4 + pow(s2 * sharpness, 4.0));
  float w3 = 1.0 / (1e-4 + pow(s3 * sharpness, 4.0));
  vec3 painted = (a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3) / (w0 + w1 + w2 + w3);

  outputColor = vec4(mix(inputColor.rgb, painted, strength), inputColor.a);
}
`;

export class PainterlyEffect extends Effect {
  constructor({ radius = 2, strength = 1, sharpness = 40 } = {}) {
    super('PainterlyEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      defines: new Map([['RADIUS', String(Math.max(1, Math.round(radius)))]]),
      uniforms: new Map<string, Uniform>([
        ['strength', new Uniform(strength)],
        ['sharpness', new Uniform(sharpness)],
      ]),
    });
  }

  set radius(r: number) {
    this.defines.set('RADIUS', String(Math.max(1, Math.round(r))));
    this.setChanged();
  }
}
