import { NPCS, Simulation, TICK_DT, heightAt, interactTarget, type PlayerId, type WorldState } from './core';
import { Input } from './input/devices';
import { LocalController } from './input/controller';
import { LocalTransport, type CommandTransport } from './net/transport';
import { WorldView } from './render/view';
import { Bubbles } from './ui/bubbles';
import { createControls, type Controls } from './ui/controls';

const MAX_STEPS_PER_FRAME = 8;

/**
 * Wires the layers together:
 *   devices -> controller -> transport -> simulation -> view (+ UI)
 * Only this file knows about all of them.
 */
export class Game {
  readonly sim = new Simulation();
  readonly view: WorldView;
  readonly transport: CommandTransport;
  readonly localPlayer: PlayerId = 'local';
  readonly input: Input;
  private controls: Controls;
  private bubbles = new Bubbles();
  private controller: LocalController;
  private prev: WorldState;
  private accumulator = 0;
  private lastTime = 0;
  frames = 0;

  constructor(container: HTMLElement) {
    this.view = new WorldView(container);
    this.transport = new LocalTransport(this.sim);
    this.controls = createControls(() => this.input.pressInteract());
    this.input = new Input(this.controls.surface);
    this.controller = new LocalController(this.input, this.transport, this.localPlayer);

    // ?spawn=x,z starts the player elsewhere (for testing and debugging).
    const spawn = new URLSearchParams(location.search).get('spawn')?.split(',').map(Number);
    const [sx, sz] = spawn && spawn.length === 2 && spawn.every(Number.isFinite) ? spawn : [0, 0];
    this.transport.send({ type: 'join', playerId: this.localPlayer, x: sx, z: sz });
    this.sim.step();
    this.prev = this.sim.snapshot();

    this.view.onInteraction = (npcId) => {
      const npc = NPCS.find((n) => n.id === npcId);
      if (!npc) return;
      const head = { x: npc.x, y: heightAt(npc.x, npc.z) + 2.05, z: npc.z };
      this.bubbles.show(npcId, '…', () => head);
    };
  }

  start() {
    this.view.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** What the local player can interact with right now, if anything. */
  get actionTarget(): string | null {
    const me = this.sim.state.players[this.localPlayer];
    return me ? interactTarget(me) : null;
  }

  private frame(timeMs: number) {
    const now = timeMs / 1000;
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.25) : 0;
    this.lastTime = now;

    const cam = this.input.takeCamera();
    this.view.rig.input(cam.dx, cam.dy, cam.zoom, this.view.renderer.domElement.clientHeight);
    this.view.cameraIdle = performance.now() / 1000 - this.input.lastCameraInput;
    this.view.rig.autoFollow = this.input.touchMode;
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
    this.controls.update(this.input, this.actionTarget ? { label: 'Talk' } : null);
    this.bubbles.update(this.view.project);
    this.frames++;
  }
}
