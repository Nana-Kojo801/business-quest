import { Simulation, TICK_DT, type PlayerId, type WorldState } from './core';
import { Input } from './input/devices';
import { LocalController } from './input/controller';
import { LocalTransport, type CommandTransport } from './net/transport';
import { WorldView } from './render/view';

const MAX_STEPS_PER_FRAME = 8;

/**
 * Wires the layers together:
 *   devices -> controller -> transport -> simulation -> view
 * Only this file knows about all of them.
 */
export class Game {
  readonly sim = new Simulation();
  readonly view: WorldView;
  readonly transport: CommandTransport;
  readonly localPlayer: PlayerId = 'local';
  private controller: LocalController;
  private prev: WorldState;
  private accumulator = 0;
  private lastTime = 0;
  frames = 0;

  constructor(container: HTMLElement) {
    this.view = new WorldView(container);
    this.transport = new LocalTransport(this.sim);
    this.controller = new LocalController(new Input(this.view.renderer.domElement), this.transport, this.localPlayer);
    this.transport.send({ type: 'join', playerId: this.localPlayer, x: 0, z: 0 });
    this.sim.step();
    this.prev = this.sim.snapshot();
  }

  start() {
    this.view.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private frame(timeMs: number) {
    const now = timeMs / 1000;
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.25) : 0;
    this.lastTime = now;

    this.controller.update(this.view.cameraYaw);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
      this.prev = this.sim.snapshot();
      this.sim.step();
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell too far behind; drop time

    this.view.render(this.prev, this.sim.state, this.accumulator / TICK_DT, this.localPlayer, dt);
    this.frames++;
  }
}
