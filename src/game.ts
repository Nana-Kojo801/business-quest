import { NPCS, Simulation, TICK_DT, heightAt, interactTarget, type PlayerId, type WorldState } from './core';
import { SCRIPTS } from './content/dialogue';
import { Input } from './input/devices';
import { LocalController } from './input/controller';
import { LocalTransport, type CommandTransport } from './net/transport';
import { WorldView } from './render/view';
import { Bubbles } from './ui/bubbles';
import { createControls, type Controls } from './ui/controls';
import { createDebugOverlay } from './ui/debugOverlay';
import { DialogueBox } from './ui/dialogue';
import { Hud } from './ui/hud';
import { Menu, loadSettings, saveSettings, type QuestView, type Settings } from './ui/menu';

const MAX_STEPS_PER_FRAME = 8;

export type Mode = 'explore' | 'dialogue' | 'menu';

/**
 * Wires the layers together:
 *   devices -> controller -> transport -> simulation -> view (+ UI)
 * Only this file knows about all of them. Also runs the screen flow
 * (exploring / talking / menu) and, for now, the first small objective.
 */
export class Game {
  readonly sim = new Simulation();
  readonly view: WorldView;
  readonly transport: CommandTransport;
  readonly localPlayer: PlayerId = 'local';
  readonly input: Input;
  mode: Mode = 'explore';
  private controls: Controls;
  private bubbles = new Bubbles();
  private dialogue = new DialogueBox();
  private hud: Hud;
  private menu: Menu;
  private fps: ReturnType<typeof createDebugOverlay>;
  private settings: Settings;
  private controller: LocalController;
  private prev: WorldState;
  private accumulator = 0;
  private lastTime = 0;
  private lastInteractionTick = -1;
  /** Villagers met so far (the first objective). */
  readonly met = new Set<string>();
  frames = 0;

  constructor(container: HTMLElement) {
    this.view = new WorldView(container);
    this.transport = new LocalTransport(this.sim);
    this.controls = createControls(() => this.input.pressInteract());
    this.input = new Input(this.controls.surface);
    this.controller = new LocalController(this.input, this.transport, this.localPlayer);

    const params = new URLSearchParams(location.search);
    this.settings = loadSettings();
    this.fps = createDebugOverlay(() => ({ ...this.view.quality.state, pixelRatio: this.view.renderer.getPixelRatio() }));
    this.hud = new Hud(() => this.openMenu(), () => this.openMenu('journal'));
    this.menu = new Menu(this.settings, (s) => this.applySettings(s), () => (this.mode = 'explore'));
    // A ?quality= URL override wins over the saved setting.
    this.applySettings(this.settings, params.has('quality'));
    if (params.get('debug') === '1') this.fps.setVisible(true);

    // ?spawn=x,z starts the player elsewhere (for testing and debugging).
    const spawn = params.get('spawn')?.split(',').map(Number);
    const [sx, sz] = spawn && spawn.length === 2 && spawn.every(Number.isFinite) ? spawn : [0, 0];
    this.transport.send({ type: 'join', playerId: this.localPlayer, x: sx, z: sz });
    this.sim.step();
    this.prev = this.sim.snapshot();

    // Other players' conversations show as a speech bubble; our own open the dialogue box.
    this.view.onInteraction = (npcId, playerId) => {
      if (playerId === this.localPlayer) return;
      const npc = NPCS.find((n) => n.id === npcId);
      if (npc) this.bubbles.show(npcId, '…', () => ({ x: npc.x, y: heightAt(npc.x, npc.z) + 2.05, z: npc.z }));
    };

    this.updateObjective();
    setTimeout(() => this.hud.banner('The Valley of', 'Sunmeadow'), 600);
  }

  start() {
    this.view.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** What the local player can interact with right now, if anything. */
  get actionTarget(): string | null {
    const me = this.sim.state.players[this.localPlayer];
    return me && this.mode === 'explore' ? interactTarget(me) : null;
  }

  get objectiveText() {
    return this.objective().text;
  }

  private openMenu(tab?: 'journal' | 'codex' | 'settings') {
    if (this.mode !== 'explore') return;
    this.mode = 'menu';
    this.menu.open(tab);
  }

  private applySettings(s: Settings, keepQuality = false) {
    this.settings = s;
    saveSettings(s);
    if (!keepQuality) this.view.setQuality(s.quality === 'auto' ? null : s.quality);
    this.view.rig.sensitivity = s.sensitivity;
    this.fps.setVisible(s.showFps);
  }

  private startConversation(npcId: string) {
    const npc = NPCS.find((n) => n.id === npcId);
    if (!npc) return;
    const script = npcId === 'keeper' && this.met.has('keeper') && this.met.size >= NPCS.length ? SCRIPTS.keeperReturn : SCRIPTS[npcId];
    if (!script) return;
    this.mode = 'dialogue';
    const me = this.sim.state.players[this.localPlayer];
    const a = { x: me.position.x, y: heightAt(me.position.x, me.position.z), z: me.position.z };
    const b = { x: npc.x, y: heightAt(npc.x, npc.z), z: npc.z };
    this.view.faceTarget = { x: npc.x, z: npc.z };
    this.view.startConversation(a, b);
    this.dialogue.open(script, () => {
      this.mode = 'explore';
      this.view.faceTarget = null;
      this.view.endConversation();
      this.met.add(npcId);
      this.updateObjective();
    });
  }

  private objective() {
    const total = NPCS.length;
    if (this.met.size < total) return { title: 'First Steps', text: `Meet the people of Sunmeadow (${this.met.size}/${total})` };
    return { title: 'First Steps', text: 'Return to Keeper Aldous at the Ledger Spire' };
  }

  private updateObjective() {
    this.hud.setObjective(this.objective());
    const q: QuestView = {
      title: 'First Steps',
      description: 'You have arrived in the valley of Sunmeadow. Get to know the people who live here.',
      steps: [
        { text: 'Talk to Mira at the market stall', done: this.met.has('merchant') },
        { text: 'Talk to Keeper Aldous by the Ledger Spire', done: this.met.has('keeper') },
      ],
    };
    if (this.met.size >= NPCS.length) q.steps.push({ text: 'Return to Keeper Aldous', done: false });
    this.menu.setQuest(q);
  }

  private frame(timeMs: number) {
    const now = timeMs / 1000;
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.25) : 0;
    this.lastTime = now;

    const exploring = this.mode === 'explore';
    const cam = this.input.takeCamera();
    if (exploring) this.view.rig.input(cam.dx, cam.dy, cam.zoom, this.view.renderer.domElement.clientHeight);
    this.view.cameraIdle = performance.now() / 1000 - this.input.lastCameraInput;
    this.view.rig.autoFollow = this.input.touchMode;
    if (this.mode === 'dialogue') {
      // Space / E / Enter continue the conversation instead of starting a new one.
      if (this.input.takeInteract()) this.dialogue.advance();
    }
    this.controller.update(this.view.cameraYaw, exploring);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
      this.prev = this.sim.snapshot();
      this.sim.step();
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // fell too far behind; drop time

    // Our own new interaction opens a conversation.
    const it = this.sim.state.players[this.localPlayer]?.interaction;
    if (it && it.tick !== this.lastInteractionTick) {
      this.lastInteractionTick = it.tick;
      if (this.mode === 'explore') this.startConversation(it.targetId);
    }

    this.view.setConversationCover(this.dialogue.coverFraction);
    this.view.render(this.prev, this.sim.state, this.accumulator / TICK_DT, this.localPlayer, dt);
    this.dialogue.update(dt);
    this.hud.setVisible(exploring);
    this.controls.update(this.input, this.actionTarget ? { label: 'Talk' } : null, exploring);
    this.bubbles.update(this.view.project);
    this.frames++;
  }
}
