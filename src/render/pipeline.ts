import { HalfFloatType, type Camera, type Scene, type WebGLRenderer } from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { GradeEffect } from './effects/GradeEffect';
import { PainterlyEffect } from './effects/PainterlyEffect';
import { SharpenEffect } from './effects/SharpenEffect';
import type { TierSettings } from './quality';

/**
 * The frame pipeline:
 *   scene (HDR, half float) -> painterly filter -> sharpen -> bloom -> tone mapping (Khronos Neutral, keeps hues) -> colour grade -> screen
 *
 * Effects are merged into as few full-screen passes as possible. The painterly
 * filter needs its own pass because it samples neighbouring pixels.
 */
export class Pipeline {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly grade = new GradeEffect();
  private painterly: PainterlyEffect | null = null;
  private painterlyPass: EffectPass | null = null;
  private finalPass: EffectPass;
  private tier: TierSettings;

  constructor(
    renderer: WebGLRenderer,
    private scene: Scene,
    private camera: Camera,
    tier: TierSettings,
  ) {
    this.tier = tier;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: tier.multisampling,
    });
    this.bloom = new BloomEffect({
      intensity: 1.4,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
      radius: 0.75,
      levels: tier.bloomLevels,
    });
    this.finalPass = new EffectPass(
      camera,
      new SharpenEffect(0.4),
      this.bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
      this.grade,
    );
    this.build();
  }

  private build() {
    this.composer.removeAllPasses();
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier.painterlyRadius > 0) {
      this.painterly ??= new PainterlyEffect({ radius: this.tier.painterlyRadius });
      this.painterly.radius = this.tier.painterlyRadius;
      this.painterlyPass ??= new EffectPass(this.camera, this.painterly);
      this.composer.addPass(this.painterlyPass);
    }
    this.composer.addPass(this.finalPass);
  }

  /** Rebuild for a new quality tier. */
  applyTier(tier: TierSettings) {
    const msChanged = tier.multisampling !== this.tier.multisampling;
    this.tier = tier;
    if (msChanged) this.composer.multisampling = tier.multisampling;
    // Bloom levels are fixed at construction in this library version; the
    // difference between tiers is small, so keep the existing bloom.
    this.build();
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height, false);
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  get activePasses(): string[] {
    return this.composer.passes.map((p) => p.name);
  }
}
