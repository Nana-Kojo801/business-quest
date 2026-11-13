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
  /** Resolution of the glow's passes relative to the frame (glow is a blur, so half looks the same). */
  bloomScale: number;
  /** Leaf cards on tree crowns: density multiplier, and the distance at which they shrink away. */
  leaves: { density: number; far: number };
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
  low: { maxPixelRatio: 1, minScale: 0.6, painterlyRadius: 0, bloomLevels: 4, bloomScale: 0.5, leaves: { density: 0.65, far: 26 }, multisampling: 0, shadowMapSize: 0, grass: { count: 1800, radius: 8 }, grassFar: { count: 1600, radius: 13 }, flowers: { count: 260, radius: 11 }, farTrees: 200, pebbles: 30, particles: { motes: 120, fireflies: 30, petalsPerTree: 4 }, lightShafts: 4 },
  medium: { maxPixelRatio: 1.75, minScale: 0.6, painterlyRadius: 0, bloomLevels: 6, bloomScale: 0.5, leaves: { density: 1, far: 36 }, multisampling: 0, shadowMapSize: 1024, grass: { count: 3400, radius: 9 }, grassFar: { count: 3000, radius: 18 }, flowers: { count: 600, radius: 16 }, farTrees: 450, pebbles: 70, particles: { motes: 350, fireflies: 60, petalsPerTree: 6 }, lightShafts: 8 },
  high: { maxPixelRatio: 2, minScale: 0.9, painterlyRadius: 1, bloomLevels: 8, bloomScale: 1, leaves: { density: 1, far: 70 }, multisampling: 4, shadowMapSize: 2048, grass: { count: 6500, radius: 10 }, grassFar: { count: 6500, radius: 22 }, flowers: { count: 1200, radius: 20 }, farTrees: 800, pebbles: 110, particles: { motes: 600, fireflies: 90, petalsPerTree: 9 }, lightShafts: 10 },
};

const TARGET_FRAME_MS = 1000 / 55; // aim for ~55+ fps
const HEADROOM_FRAME_MS = 1000 / 70;
const EVAL_INTERVAL_MS = 1500;

export interface QualityState {
  tier: Tier;
  /** Fraction of the tier's max pixel ratio currently used (minScale..1). */
  scale: number;
  adaptive: boolean;
  /** Typical (median) frame rate over the last measuring window. */
  fps: number;
  /** Slowest single frame in the last window, in ms: hitches the median hides show up here. */
  worstMs: number;
}

/** What the browser tells us about the machine (all optional; browsers differ). */
export interface DeviceHints {
  /** Unmasked GPU name, e.g. "ANGLE (Intel Inc., Intel(R) UHD Graphics 617, ...)". */
  gpu?: string;
  /** navigator.deviceMemory in GB (Chrome only; capped at 8). */
  memoryGB?: number;
}

/**
 * Starting tier. Phones start on medium; computers on high, unless they look weak: an Intel
 * integrated GPU or 4 GB of memory or less. Starting too high costs a visible freeze each time
 * the adaptive system steps down (the world is rebuilt for the new tier).
 */
export function initialTier(params: URLSearchParams, isTouch: boolean, hints: DeviceHints = {}): Tier {
  const q = params.get('quality');
  if (q && (TIERS as string[]).includes(q)) return q as Tier;
  if (isTouch) return 'medium';
  const intel = /intel/i.test(hints.gpu ?? '');
  const lowMemory = hints.memoryGB !== undefined && hints.memoryGB <= 4;
  if (intel && lowMemory) return 'low';
  if (intel || lowMemory) return 'medium';
  return 'high';
}

/** ?fps=30 holds an even 30 fps (for testing whether steady pacing feels smoother); 0 = uncapped. */
export function frameCap(params: URLSearchParams): number {
  const n = Number(params.get('fps'));
  return Number.isFinite(n) && n >= 20 && n < 60 ? n : 0;
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
  private worst = 0;
  /** Consecutive slow windows: a step down needs two, so one hiccup never costs quality. */
  private slowStreak = 0;
  private targetMs: number;
  private headroomMs: number;
  /** Called when tier or scale changes. */
  onChange: (state: QualityState, tierChanged: boolean) => void = () => {};

  constructor(tier: Tier, adaptive: boolean, private overrides: Partial<TierSettings> = {}, cap = 0) {
    this.state = { tier, scale: 1, adaptive, fps: 0, worstMs: 0 };
    // With a frame cap, "fast enough" means holding the cap, and there is no headroom to climb into.
    this.targetMs = cap ? 1000 / (cap * 0.92) : TARGET_FRAME_MS;
    this.headroomMs = cap ? 0 : HEADROOM_FRAME_MS;
  }

  get settings(): TierSettings {
    return { ...TIER_SETTINGS[this.state.tier], ...this.overrides };
  }

  pixelRatio(devicePixelRatio: number): number {
    return Math.min(devicePixelRatio, this.settings.maxPixelRatio) * this.state.scale;
  }

  /** Feed the duration of each frame in milliseconds. */
  sample(frameMs: number) {
    if (frameMs <= 0 || frameMs > 1000) return; // tab was hidden or paused
    this.worst = Math.max(this.worst, frameMs);
    if (frameMs > 250) return; // a long stall counts as a hitch, not as the typical frame
    this.frameTimes.push(frameMs);
    this.sinceEval += frameMs;
    if (this.sinceEval < EVAL_INTERVAL_MS) return;
    this.sinceEval = 0;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    this.frameTimes = [];
    // Use the median so single hitches do not trigger changes.
    const median = sorted[Math.floor(sorted.length / 2)];
    this.state.fps = Math.round(1000 / median);
    this.state.worstMs = Math.round(this.worst);
    this.worst = 0;
    if (!this.state.adaptive) return;

    const s = this.settings;
    this.slowStreak = median > this.targetMs ? this.slowStreak + 1 : 0;
    if (this.slowStreak >= 2) {
      this.slowStreak = 0; // give the change time to take effect before judging again
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
    } else if (median < this.headroomMs && this.state.scale < 1) {
      this.state.scale = Math.min(1, this.state.scale + 0.05);
      this.onChange(this.state, false);
    }
  }
}
