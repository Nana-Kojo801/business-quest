/**
 * Quality tiers and adaptive resolution.
 *
 * The starting tier is a guess from the device (phones start on medium). While
 * playing, render resolution is nudged down when frames are slow and back up
 * when there is headroom. If the lowest resolution for a tier is still too
 * slow, the tier drops. Tiers never rise automatically, to avoid flicker.
 *
 * URL overrides for testing: ?quality=low|medium|high  ?adaptive=0
 */

export type Tier = 'low' | 'medium' | 'high';
export const TIERS: Tier[] = ['low', 'medium', 'high'];

export interface TierSettings {
  /** Upper bound on device pixel ratio. */
  maxPixelRatio: number;
  /** Lowest fraction of maxPixelRatio adaptive scaling may go to before the tier drops. */
  minScale: number;
  /** Painterly filter radius; 0 turns it off. */
  painterlyRadius: number;
  /** Bloom mip levels (more = wider, softer glow). */
  bloomLevels: number;
  /** MSAA samples for the scene render. */
  multisampling: number;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  low: { maxPixelRatio: 1, minScale: 0.6, painterlyRadius: 0, bloomLevels: 4, multisampling: 0 },
  medium: { maxPixelRatio: 1.5, minScale: 0.6, painterlyRadius: 2, bloomLevels: 6, multisampling: 0 },
  high: { maxPixelRatio: 2, minScale: 0.6, painterlyRadius: 3, bloomLevels: 8, multisampling: 4 },
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

export class QualityManager {
  readonly state: QualityState;
  private frameTimes: number[] = [];
  private sinceEval = 0;
  /** Called when tier or scale changes. */
  onChange: (state: QualityState, tierChanged: boolean) => void = () => {};

  constructor(tier: Tier, adaptive: boolean) {
    this.state = { tier, scale: 1, adaptive, fps: 0 };
  }

  get settings(): TierSettings {
    return TIER_SETTINGS[this.state.tier];
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
