/**
 * Quality tiers and adaptive resolution.
 *
 * The starting tier is a guess from the device (phones start on medium). While
 * playing, render resolution is nudged down when frames are slow and back up
 * when there is headroom. If the lowest resolution for a tier is still too
 * slow, the tier drops. Tiers never rise automatically, to avoid flicker.
 *
 * URL overrides for testing: ?quality=low|medium|high  ?adaptive=0
 * and, to measure costs on a real device: ?dpr=1.5 (max pixel ratio)  ?msaa=0|4
 *
 * Phones: MSAA is not cheap in WebGL. A browser can't resolve samples on-chip the
 * way native apps can, so 4x MSAA at phone resolution writes four full-precision
 * samples per pixel every frame; it halved the frame rate on the owner's phone (#41).
 */

export type Tier = 'low' | 'medium' | 'high';
export const TIERS: Tier[] = ['low', 'medium', 'high'];

export interface TierSettings {
  /** Upper bound on device pixel ratio. */
  maxPixelRatio: number;
  /**
   * Lowest fraction of maxPixelRatio adaptive scaling may go to before the tier
   * drops. Chosen so a tier never ends up blurrier than the tier below it.
   */
  minScale: number;
  /** Painterly filter radius; 0 turns it off. */
  painterlyRadius: number;
  /** Bloom mip levels (more = wider, softer glow). */
  bloomLevels: number;
  /** MSAA samples for the scene render. */
  multisampling: number;
  /** Sun shadow map resolution; 0 turns shadows off. */
  shadowMapSize: number;
  /** Grass clumps drawn around the player, and how far out they reach: a dense near field and a
   * sparser ring beyond it, so the grass never ends at a visible line. */
  grass: { count: number; radius: number };
  grassFar: { count: number; radius: number };
  /** Flowers drawn around the player. */
  flowers: { count: number; radius: number };
  /** Simple trees on the distant mountain slopes, and decorative small stones. */
  farTrees: number;
  pebbles: number;
  /** Drifting motes, fireflies, petals per blossom tree, and light shafts. */
  particles: { motes: number; fireflies: number; petalsPerTree: number };
  lightShafts: number;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  low: { maxPixelRatio: 1, minScale: 0.6, painterlyRadius: 0, bloomLevels: 4, multisampling: 0, shadowMapSize: 0, grass: { count: 1800, radius: 8 }, grassFar: { count: 1600, radius: 13 }, flowers: { count: 260, radius: 11 }, farTrees: 200, pebbles: 30, particles: { motes: 120, fireflies: 30, petalsPerTree: 4 }, lightShafts: 4 },
  medium: { maxPixelRatio: 1.75, minScale: 0.6, painterlyRadius: 0, bloomLevels: 6, multisampling: 0, shadowMapSize: 1024, grass: { count: 3400, radius: 9 }, grassFar: { count: 3000, radius: 18 }, flowers: { count: 600, radius: 16 }, farTrees: 450, pebbles: 70, particles: { motes: 350, fireflies: 60, petalsPerTree: 6 }, lightShafts: 8 },
  high: { maxPixelRatio: 2, minScale: 0.9, painterlyRadius: 1, bloomLevels: 8, multisampling: 4, shadowMapSize: 2048, grass: { count: 6500, radius: 10 }, grassFar: { count: 6500, radius: 22 }, flowers: { count: 1200, radius: 20 }, farTrees: 800, pebbles: 110, particles: { motes: 600, fireflies: 90, petalsPerTree: 9 }, lightShafts: 10 },
};

const TARGET_FRAME_MS = 1000 / 55; // aim for ~55+ fps
const HEADROOM_FRAME_MS = 1000 / 70;
const EVAL_INTERVAL_MS = 1500;

export interface QualityState {
  tier: Tier;
  /** Fraction of the tier's max pixel ratio currently used (minScale..1). */
  scale: number;
  adaptive: boolean;
  fps: number;
}

export function initialTier(params: URLSearchParams, isTouch: boolean): Tier {
  const q = params.get('quality');
  if (q && (TIERS as string[]).includes(q)) return q as Tier;
  return isTouch ? 'medium' : 'high';
}

/** Per-device test overrides from the URL (?dpr=, ?msaa=), applied on top of every tier. */
export function tierOverrides(params: URLSearchParams): Partial<TierSettings> {
  const out: Partial<TierSettings> = {};
  const dpr = Number(params.get('dpr'));
  if (params.has('dpr') && dpr >= 0.5 && dpr <= 4) out.maxPixelRatio = dpr;
  const msaa = Number(params.get('msaa'));
  if (params.has('msaa') && [0, 2, 4, 8].includes(msaa)) out.multisampling = msaa;
  return out;
}

export class QualityManager {
  readonly state: QualityState;
  private frameTimes: number[] = [];
  private sinceEval = 0;
  /** Called when tier or scale changes. */
  onChange: (state: QualityState, tierChanged: boolean) => void = () => {};

  constructor(tier: Tier, adaptive: boolean, private overrides: Partial<TierSettings> = {}) {
    this.state = { tier, scale: 1, adaptive, fps: 0 };
  }

  get settings(): TierSettings {
    return { ...TIER_SETTINGS[this.state.tier], ...this.overrides };
  }

  pixelRatio(devicePixelRatio: number): number {
    return Math.min(devicePixelRatio, this.settings.maxPixelRatio) * this.state.scale;
  }

  /** Feed the duration of each frame in milliseconds. */
  sample(frameMs: number) {
    if (frameMs <= 0 || frameMs > 250) return; // tab was hidden or paused
    this.frameTimes.push(frameMs);
    this.sinceEval += frameMs;
    if (this.sinceEval < EVAL_INTERVAL_MS) return;
    this.sinceEval = 0;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    this.frameTimes = [];
    // Use the median so single hitches do not trigger changes.
    const median = sorted[Math.floor(sorted.length / 2)];
    this.state.fps = Math.round(1000 / median);
    if (!this.state.adaptive) return;

    const s = this.settings;
    if (median > TARGET_FRAME_MS) {
      if (this.state.scale > s.minScale + 1e-6) {
        this.state.scale = Math.max(s.minScale, this.state.scale - 0.1);
        this.onChange(this.state, false);
      } else {
        const i = TIERS.indexOf(this.state.tier);
        if (i > 0) {
          this.state.tier = TIERS[i - 1];
          this.state.scale = 1;
          this.onChange(this.state, true);
        }
      }
    } else if (median < HEADROOM_FRAME_MS && this.state.scale < 1) {
      this.state.scale = Math.min(1, this.state.scale + 0.05);
      this.onChange(this.state, false);
    }
  }
}
