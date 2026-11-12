import { Game } from './game';

const game = new Game(document.getElementById('app')!);
game.start();

const quality = () => ({ ...game.view.quality.state, pixelRatio: game.view.renderer.getPixelRatio() });

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
    };
  },
});
