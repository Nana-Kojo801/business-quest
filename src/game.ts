import { NPCS, Simulation, TERRAIN, TICK_DT, heightAt, interactTarget, pathMask, type PlayerId, type WorldState } from './core';
import { frameCap } from './render/quality';
import { AudioEngine } from './audio/AudioEngine';
import { Input } from './input/devices';
import { LocalController } from './input/controller';
import { LocalTransport, type CommandTransport } from './net/transport';
import { WorldView } from './render/view';
import { MarketScene } from './render/scenes/MarketScene';
import { FirstQuests, type Stage } from './quests/firstQuests';
import { PricingPanel } from './ui/pricing';
import { Bubbles } from './ui/bubbles';
import { createControls, type Controls } from './ui/controls';
import { createDebugOverlay } from './ui/debugOverlay';
import { DialogueBox } from './ui/dialogue';
import { Hud } from './ui/hud';
import { SCRIPTS as SCRIPTS_REF, SPEAKERS } from './content/dialogue';
import { Menu, loadSettings, saveSettings, type Settings } from './ui/menu';

const MAX_STEPS_PER_FRAME = 8;

export type Mode = 'explore' | 'dialogue' | 'menu' | 'scene';

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
  readonly quests = new FirstQuests();
  readonly audio = new AudioEngine();
  private stepDist = 0;
  private lastStepPos: { x: number; z: number } | null = null;
  private pricing = new PricingPanel();
  private market: MarketScene | null = null;
  /** True while the market crowd is acting out a morning (for tests). */
  marketPlaying = false;
  frames = 0;

  constructor(container: HTMLElement) {
    this.view = new WorldView(container);
    this.transport = new LocalTransport(this.sim);
    this.controls = createControls(() => {
      this.audio.tap();
      this.input.pressInteract();
    });
    this.input = new Input(this.controls.surface);
    this.controller = new LocalController(this.input, this.transport, this.localPlayer);

    const params = new URLSearchParams(location.search);
    this.settings = loadSettings();
    this.fps = createDebugOverlay(() => ({ ...this.view.quality.state, pixelRatio: this.view.renderer.getPixelRatio() }));
    this.hud = new Hud(() => this.openMenu(), () => this.openMenu('journal'));
    // Sound may only start after a user gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    const pitch: Record<string, number> = { Mira: 1.18, 'Keeper Aldous': 0.82 };
    this.dialogue.onType = (speaker) => this.audio.blip(pitch[speaker] ?? 1);
    this.dialogue.onAdvance = () => this.audio.tap();
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

    // ?quest=<stage> jumps ahead (testing and debugging).
    const stage = params.get('quest') as Stage | null;
    if (stage && ['meet', 'return', 'market', 'debrief', 'done'].includes(stage)) this.quests.skipTo(stage);
    this.updateObjective();

  }

  start() {
    this.view.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** Prepare every shader up front so the first seconds don't stutter. */
  async warmUp() {
    try {
      await this.view.renderer.compileAsync(this.view.scene, this.view.camera);
    } catch {
      // Older browsers: shaders compile on first use instead.
    }
  }

  /** The arrival moment, once the loading screen has gone. */
  arrive() {
    setTimeout(() => this.hud.banner('The Valley of', 'Sunmeadow'), 400);
  }

  /** What the local player can interact with right now, if anything. */
  get actionTarget(): string | null {
    const me = this.sim.state.players[this.localPlayer];
    return me && this.mode === 'explore' ? interactTarget(me) : null;
  }

  get objectiveText() {
    return this.quests.objective().text;
  }

  private openMenu(tab?: 'journal' | 'codex' | 'settings') {
    if (this.mode !== 'explore') return;
    this.mode = 'menu';
    this.audio.open();
    this.menu.open(tab);
  }

  private applySettings(s: Settings, keepQuality = false) {
    this.settings = s;
    saveSettings(s);
    if (!keepQuality) this.view.setQuality(s.quality === 'auto' ? null : s.quality);
    this.view.rig.sensitivity = s.sensitivity;
    this.audio.setVolumes({ music: s.music, sfx: s.sfx });
    this.fps.setVisible(s.showFps);
  }

  get met() {
    return this.quests.met;
  }

  private startConversation(npcId: string, then?: () => void) {
    const npc = NPCS.find((n) => n.id === npcId);
    if (!npc) return;
    const { script, after } = this.quests.conversation(npcId);
    const inScene = this.mode === 'scene';
    this.mode = inScene ? 'scene' : 'dialogue';
    const me = this.sim.state.players[this.localPlayer];
    if (!inScene) {
      const a = { x: me.position.x, y: heightAt(me.position.x, me.position.z), z: me.position.z };
      const b = { x: npc.x, y: heightAt(npc.x, npc.z), z: npc.z };
      this.view.faceTarget = { x: npc.x, z: npc.z };
      this.view.startConversation(a, b);
    }
    this.dialogue.open(script, () => {
      if (!inScene) {
        this.mode = 'explore';
        this.view.faceTarget = null;
        this.view.endConversation();
      }
      const banner = this.quests.talked(npcId, after);
      this.updateObjective();
      if (banner) {
        this.hud.banner(banner.sub, banner.title);
        this.audio.chime();
      }
      if (after === 'startMarket') this.startMarket();
      then?.();
    });
  }

  /** Mira's market mornings: crowd, price panel, results. */
  private startMarket() {
    this.mode = 'scene';
    const scene = new MarketScene(this.view.atmosphere, this.quests.limits, this.quests.seeds, {
      bubble: (i, text) => {
        this.bubbles.show(`shopper-${i}`, text, () => scene.head(i), 1.4);
        if (text === '♥') this.audio.coin();
        else this.audio.grumble();
      },
    });
    this.market = scene;
    this.view.scene.add(scene.group);
    // Stand the player beside the counter, watching the crowd.
    const spot = { x: scene.stall.x + scene.front.x * 1.9 + scene.side.x * 2.1, z: scene.stall.z + scene.front.z * 1.9 + scene.side.z * 2.1 };
    const c = scene.centre;
    this.transport.send({ type: 'place', playerId: this.localPlayer, x: spot.x, z: spot.z, heading: Math.atan2(c.x - spot.x, -(c.z - spot.z)) });
    this.view.faceTarget = { x: c.x, z: c.z };
    const shot = scene.cameraShot(this.view.portrait);
    this.view.startShot(shot.pos, shot.look);
    this.marketRound();
  }

  private marketRound() {
    const scene = this.market!;
    scene.reset();
    this.pricing.open(
      this.quests.round,
      (p) => scene.setPrice(p),
      (p) => {
        const res = this.quests.play(p);
        this.pricing.close();
        this.marketPlaying = true;
        scene.play(res, () => {
          this.marketPlaying = false;
          this.audio.result(res.cleared);
          this.pricing.open(this.quests.round, () => {}, () => {});
          if (res.cleared) {
            this.pricing.showResult(res, this.quests.reaction(res), { label: 'Continue', action: () => this.marketCleared() });
          } else {
            this.pricing.showResult(res, this.quests.reaction(res), {
              label: 'Try another price',
              action: () => this.marketRound(),
            });
          }
        });
      },
    );
  }

  private marketCleared() {
    this.pricing.close();
    const next = this.quests.advanceMarket();
    this.updateObjective();
    const script = next === 'storm' ? 'merchantStorm' : 'merchantDone';
    this.dialogue.open(SCRIPTS_REF[script], () => {
      if (next === 'storm') {
        this.marketRound();
      } else {
        this.endMarket();
      }
    });
  }

  private endMarket() {
    this.market?.dispose();
    this.market = null;
    this.mode = 'explore';
    this.view.faceTarget = null;
    this.view.endConversation();
    this.updateObjective();
  }

  /** Footsteps from distance walked; lapping water louder near the lake. */
  private updateSound() {
    const me = this.sim.state.players[this.localPlayer];
    if (!me || !this.audio.unlocked) return;
    const p = me.position;
    if (this.lastStepPos) {
      this.stepDist += Math.hypot(p.x - this.lastStepPos.x, p.z - this.lastStepPos.z);
      const w = Math.min(1, me.speed / 4.5);
      const stride = 0.9 + 0.8 * w; // matches the walk cycle
      if (me.speed > 0.4 && this.stepDist >= stride / 2) {
        this.stepDist = 0;
        this.audio.step(pathMask(p.x, p.z) > 0.5, 0.6 + 0.4 * w);
      }
    }
    this.lastStepPos = { x: p.x, z: p.z };
    const d = Math.hypot(p.x - TERRAIN.lake.x, p.z - TERRAIN.lake.z) - TERRAIN.lake.radius;
    this.audio.setNearWater(Math.max(0, Math.min(1, 1 - d / 14)));
  }

  private updateObjective() {
    this.hud.setObjective(this.quests.objective());
    this.menu.setQuest(this.quests.journal());
    this.menu.setCodex(this.quests.codex());
  }

  get stage() {
    return this.quests.stage;
  }

  get pricingOpen() {
    return this.pricing.isOpen;
  }

  /** ?fps=30: draw every other display refresh, for an even cadence on slow machines. */
  private readonly cap = frameCap(new URLSearchParams(location.search));
  private lastDrawMs = 0;

  private frame(timeMs: number) {
    if (this.cap && this.lastDrawMs && timeMs - this.lastDrawMs < 1000 / this.cap - 4) return;
    this.lastDrawMs = timeMs;
    const now = timeMs / 1000;
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.25) : 0;
    this.lastTime = now;

    const exploring = this.mode === 'explore';
    const cam = this.input.takeCamera();
    if (exploring) this.view.rig.input(cam.dx, cam.dy, cam.zoom, this.view.renderer.domElement.clientHeight);
    this.view.cameraIdle = performance.now() / 1000 - this.input.lastCameraInput;
    this.view.rig.autoFollow = this.input.touchMode;
    if (this.mode === 'dialogue' || (this.mode === 'scene' && this.dialogue.isOpen)) {
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

    this.view.setConversationCover(Math.max(this.dialogue.coverFraction, this.pricing.coverFraction));
    this.view.render(this.prev, this.sim.state, this.accumulator / TICK_DT, this.localPlayer, dt);
    this.dialogue.update(dt);
    // The speaking villager shows the line's mood and moves their mouth while the words appear.
    const line = this.dialogue.current;
    const speakerId = line ? (Object.keys(SPEAKERS) as (keyof typeof SPEAKERS)[]).find((k) => SPEAKERS[k] === line.speaker) ?? null : null;
    this.view.setSpeaking(speakerId, line?.mood ?? 'neutral', line?.typing ?? false);
    this.updateSound();
    if (this.market) {
      this.market.update(dt, performance.now() / 1000);
      this.pricing.updateTags(this.view.project, (i) => this.market!.head(i));
    }
    this.hud.setVisible(exploring);
    this.controls.update(this.input, this.actionTarget ? { label: 'Talk' } : null, exploring);
    this.bubbles.update(this.view.project);
    this.frames++;
  }
}
