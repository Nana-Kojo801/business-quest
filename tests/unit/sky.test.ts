import { describe, expect, it } from 'vitest';
import { SKY_PRESETS, presetFromParams, sunDirection } from '../../src/render/sky/presets';

describe('sky presets', () => {
  it('sun direction is a unit vector with azimuth 0 ahead (-z) and +x to the right', () => {
    const [x, y, z] = sunDirection(0, 0);
    expect([x, y, z].map((v) => +v.toFixed(6))).toEqual([0, 0, -1]);
    const right = sunDirection(90, 0);
    expect(right[0]).toBeCloseTo(1);
    const up = sunDirection(0, 90);
    expect(up[1]).toBeCloseTo(1);
    for (const p of Object.values(SKY_PRESETS)) {
      const d = sunDirection(p.sun.azimuthDeg, p.sun.elevationDeg);
      expect(Math.hypot(...d)).toBeCloseTo(1);
    }
  });

  it('every preset has the sun above the horizon and valid colours', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const [name, p] of Object.entries(SKY_PRESETS)) {
      expect(p.sun.elevationDeg, name).toBeGreaterThan(0);
      for (const c of [p.zenith, p.skyMid, p.horizon, p.sunGlow, p.sunDisc, p.ambientSky, p.ambientGround, p.cloudLit, p.cloudShade, p.sun.color]) {
        expect(c, name).toMatch(hex);
      }
      expect(p.cloudCover).toBeGreaterThan(0);
      expect(p.cloudCover).toBeLessThan(1);
    }
  });

  it('chooses the preset from the URL, defaulting to golden hour', () => {
    expect(presetFromParams(new URLSearchParams(''))).toBe('goldenHour');
    expect(presetFromParams(new URLSearchParams('sky=dusk'))).toBe('dusk');
    expect(presetFromParams(new URLSearchParams('sky=nope'))).toBe('goldenHour');
  });
});
