import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Painterly filter: a soft generalized Kuwahara filter.
 *
 * Each pixel looks at four overlapping square regions around it, and blends their
 * average colours, favouring the flattest (lowest-variance) region. Flat areas
 * become smooth brush-like patches while edges stay crisp, which reads as paint.
 *
 * The four squares overlap along the centre row and column, so each texel in the
 * (2R+1)^2 neighbourhood is read once and added to every square containing it:
 * (2R+1)^2 reads per pixel (25 at radius 2) rather than 4(R+1)^2 (36). The quality
 * tier picks RADIUS (0 disables the effect by removing it from the pipeline).
 */
const fragment = /* glsl */ `
uniform float strength;
uniform float sharpness;

vec3 compress(vec3 c) { return c / (1.0 + c); } // tame HDR values for the variance test

void finish(const in vec3 sum, const in vec3 sumSq, out vec3 avg, out float sigma) {
  const float n = float((RADIUS + 1) * (RADIUS + 1));
  avg = sum / n;
  vec3 m = compress(avg);
  vec3 v = abs(sumSq / n - m * m);
  sigma = v.r + v.g + v.b;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Sector order: 0 = left/down, 1 = right/down, 2 = left/up, 3 = right/up.
  vec3 sum0 = vec3(0.0), sum1 = vec3(0.0), sum2 = vec3(0.0), sum3 = vec3(0.0);
  vec3 sq0 = vec3(0.0), sq1 = vec3(0.0), sq2 = vec3(0.0), sq3 = vec3(0.0);
  for (int y = -RADIUS; y <= RADIUS; y++) {
    for (int x = -RADIUS; x <= RADIUS; x++) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(x), float(y)) * texelSize).rgb;
      vec3 k = compress(c);
      k *= k;
      // Loop bounds are constants, so these weights fold away when the loop unrolls.
      float l = step(float(x), 0.0), r = step(0.0, float(x));
      float d = step(float(y), 0.0), u = step(0.0, float(y));
      sum0 += c * (l * d); sq0 += k * (l * d);
      sum1 += c * (r * d); sq1 += k * (r * d);
      sum2 += c * (l * u); sq2 += k * (l * u);
      sum3 += c * (r * u); sq3 += k * (r * u);
    }
  }
  vec3 a0, a1, a2, a3;
  float s0, s1, s2, s3;
  finish(sum0, sq0, a0, s0);
  finish(sum1, sq1, a1, s1);
  finish(sum2, sq2, a2, s2);
  finish(sum3, sq3, a3, s3);

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
