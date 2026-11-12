import { Game } from './game';

const game = new Game(document.getElementById('app')!);
game.start();

// Fade the loading screen once shaders are ready and a few frames have drawn.
const loading = document.getElementById('loading');
void game.warmUp().then(() => {
  const wait = () => {
    if (game.frames < 3) return requestAnimationFrame(wait);
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 1000);
    game.arrive();
  };
  wait();
});

const quality = () => ({ ...game.view.quality.state, pixelRatio: game.view.renderer.getPixelRatio() });

/** Debug: triangles per top-level scene object (instances counted), for performance work. */
(window as unknown as { triBreakdown: () => Record<string, number> }).triBreakdown = () => game.view.triangleBreakdown();

/** Debug/test hook. Read by the automated tests; not used by gameplay. */
Object.defineProperty(window, '__bq', {
  get: () => {
    const p = game.sim.state.players[game.localPlayer];
    return {
      frames: game.frames,
      tick: game.sim.state.tick,
      player: { x: p.position.x, z: p.position.z },
      quality: quality(),
      passes: game.view.pipeline.activePasses,
      camera: { yaw: game.view.rig.yaw, pitch: game.view.rig.pitch, distance: game.view.rig.distance },
      actionTarget: game.actionTarget,
      interaction: p.interaction,
      mode: game.mode,
      objective: game.objectiveText,
      met: [...game.met],
      stage: game.stage,
      pricingOpen: game.pricingOpen,
      marketPlaying: game.marketPlaying,
      renderInfo: game.view.renderStats,
      audio: game.audio.state,
      audioLevel: game.audio.level(),
    };
  },
});
