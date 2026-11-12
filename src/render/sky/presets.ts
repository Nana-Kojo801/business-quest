/**
 * Sky and lighting moods. A region (or a moment in the story) picks one.
 * Colours are sRGB hex; `*` values are HDR multipliers so glows can exceed 1
 * and catch the bloom.
 */
export interface SkyPreset {
  sun: { azimuthDeg: number; elevationDeg: number; color: string; intensity: number };
  zenith: string;
  skyMid: string;
  horizon: string;
  horizonBoost: number;
  sunGlow: string;
  sunGlowBoost: number;
  /** Higher = tighter glow around the sun. */
  glowPower: number;
  sunDisc: string;
  sunDiscBoost: number;
  /** Angular radius of the sun disc in degrees. */
  sunSizeDeg: number;
  ambientSky: string;
  ambientGround: string;
  /** Note: three.js divides hemisphere light by pi, so values around 2 are normal here. */
  ambientIntensity: number;
  cloudLit: string;
  cloudLitBoost: number;
  cloudShade: string;
  /** 0..1, higher = fewer clouds. */
  cloudCover: number;
  fog: { start: number; density: number; heightFalloff: number };
}

export const SKY_PRESETS = {
  goldenHour: {
    sun: { azimuthDeg: 20, elevationDeg: 15, color: '#ffd29e', intensity: 3.6 },
    zenith: '#3a5ea8',
    skyMid: '#86aee0',
    horizon: '#ffcfa6',
    horizonBoost: 1.1,
    sunGlow: '#ff9a4d',
    sunGlowBoost: 1.2,
    glowPower: 14,
    sunDisc: '#fff2d2',
    sunDiscBoost: 6,
    sunSizeDeg: 1.8,
    ambientSky: '#b4c4ec',
    ambientGround: '#a07a5c',
    ambientIntensity: 2.2,
    cloudLit: '#fff0dc',
    cloudLitBoost: 1.2,
    cloudShade: '#a08bbd',
    cloudCover: 0.42,
    fog: { start: 18, density: 0.018, heightFalloff: 0.12 },
  },
  day: {
    sun: { azimuthDeg: 35, elevationDeg: 48, color: '#fff5e6', intensity: 3.2 },
    zenith: '#2a6ad2',
    skyMid: '#67a6ef',
    horizon: '#cfe5ff',
    horizonBoost: 1.1,
    sunGlow: '#fff0cc',
    sunGlowBoost: 0.7,
    glowPower: 24,
    sunDisc: '#ffffff',
    sunDiscBoost: 6,
    sunSizeDeg: 1.8,
    ambientSky: '#a9ccff',
    ambientGround: '#4f5a3c',
    ambientIntensity: 1.6,
    cloudLit: '#ffffff',
    cloudLitBoost: 1.15,
    cloudShade: '#a6b7d8',
    cloudCover: 0.42,
    fog: { start: 25, density: 0.012, heightFalloff: 0.1 },
  },
  dusk: {
    sun: { azimuthDeg: 8, elevationDeg: 2.5, color: '#ff8a5c', intensity: 2.4 },
    zenith: '#1c1948',
    skyMid: '#59488b',
    horizon: '#ff8d68',
    horizonBoost: 1.1,
    sunGlow: '#ff5a36',
    sunGlowBoost: 2.2,
    glowPower: 7,
    sunDisc: '#ffd9a8',
    sunDiscBoost: 5,
    sunSizeDeg: 2.6,
    ambientSky: '#9a8ad8',
    ambientGround: '#8a4a50',
    ambientIntensity: 3.2,
    cloudLit: '#ffb39a',
    cloudLitBoost: 1.2,
    cloudShade: '#5c4985',
    cloudCover: 0.42,
    fog: { start: 15, density: 0.02, heightFalloff: 0.12 },
  },
} satisfies Record<string, SkyPreset>;

export type SkyPresetName = keyof typeof SKY_PRESETS;

export function presetFromParams(params: URLSearchParams): SkyPresetName {
  const name = params.get('sky');
  return name && name in SKY_PRESETS ? (name as SkyPresetName) : 'goldenHour';
}

/** Unit vector pointing toward the sun. Azimuth 0 is straight ahead (-z), positive toward +x. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
