import { describe, expect, it } from 'vitest';
import { bakeNoiseData } from '../../src/render/noiseTexture';

describe('baked noise texture', () => {
  const size = 64;
  const data = bakeNoiseData(size);
  const at = (x: number, y: number, c: number) => data[(y * size + x) * 4 + c];

  it('tiles seamlessly: the jump across the wrap edge is no bigger than between inner neighbours', () => {
    for (let c = 0; c < 4; c++) {
      let edge = 0;
      let inner = 0;
      for (let i = 0; i < size; i++) {
        edge = Math.max(edge, Math.abs(at(size - 1, i, c) - at(0, i, c)), Math.abs(at(i, size - 1, c) - at(i, 0, c)));
        for (let j = 0; j < size - 1; j++) {
          inner = Math.max(inner, Math.abs(at(j, i, c) - at(j + 1, i, c)), Math.abs(at(i, j, c) - at(i, j + 1, c)));
        }
      }
      expect(edge, `channel ${c}`).toBeLessThanOrEqual(inner);
    }
  });

  it('uses the full range and differs between channels', () => {
    for (let c = 0; c < 4; c++) {
      let lo = 255, hi = 0;
      for (let i = c; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
      expect(hi - lo, `channel ${c}`).toBeGreaterThan(150);
    }
    expect(at(10, 10, 0)).not.toBe(at(10, 10, 1));
  });

  it('is deterministic', () => {
    expect(bakeNoiseData(size)).toEqual(data);
  });
});
