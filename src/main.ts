import { Game } from './game';
import { createDebugOverlay } from './ui/debugOverlay';

const game = new Game(document.getElementById('app')!);
game.start();

const quality = () => ({ ...game.view.quality.state, pixelRatio: game.view.renderer.getPixelRatio() });

if (new URLSearchParams(location.search).get('debug') === '1') createDebugOverlay(quality);

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
    };
  },
});
