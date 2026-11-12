import { Game } from './game';

const game = new Game(document.getElementById('app')!);
game.start();

/** Debug/test hook. Read by the automated tests; not used by gameplay. */
Object.defineProperty(window, '__bq', {
  get: () => {
    const p = game.sim.state.players[game.localPlayer];
    return { frames: game.frames, tick: game.sim.state.tick, player: { x: p.position.x, z: p.position.z } };
  },
});
