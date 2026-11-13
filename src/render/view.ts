import * as THREE from 'three';
import { NPCS, heightAt, type Npc, type PlayerId, type WorldState } from '../core';
import { Character, updateCharacterLighting } from './characters/Character';
import { CameraRig } from './CameraRig';
import { LOOKS } from './characters/looks';
import { createTerrain } from './terrain/Terrain';
import { createWater } from './water/Water';
import { createField } from './flora/Field';
import { createRocks } from './flora/Rocks';
import { createTrees } from './flora/Trees';
import { createBuildings } from './structures/Buildings';
import { createParticles } from './ambient/Particles';
import { createLightShafts } from './ambient/LightShafts';
import { createBirds } from './ambient/Birds';
import { bakeGroundData, type GroundData } from './terrain/groundData';
import { Pipeline } from './pipeline';
import { QualityManager, frameCap, initialTier, tierOverrides, type DeviceHints } from './quality';
import { Atmosphere } from './sky/Atmosphere';
import { presetFromParams } from './sky/presets';

const FAR_AWAY = new THREE.Vector3(0, -1000, 0);

/** GPU name and memory, where the browser shares them, for picking a starting tier. */
function deviceHints(renderer: THREE.WebGLRenderer): DeviceHints {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { gpu, memoryGB };
}

/**
 * Draws the world. Reads game state every frame and never changes it.
 * Owns all three.js objects.
 */
export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  readonly rig: CameraRig;
  /** Seconds since the player last moved the camera by hand (set by the game each frame). */
  cameraIdle = Infinity;
  /** While set, the local player turns to face this point (e.g. during a conversation). */
  faceTarget: { x: number; z: number } | null = null;
  private faceYaw: number | null = null;
  /** Called when a villager is talked to (for the speech bubble). */
  onInteraction: (npcId: string, playerId: string) => void = () => {};
  private seenInteraction = new Map<string, number>();
  private projV = new THREE.Vector3();
  /** World point to screen pixels (for DOM overlays such as speech bubbles). */
  project = (p: { x: number; y: number; z: number }) => {
    this.projV.set(p.x, p.y, p.z).project(this.camera);
    const el = this.renderer.domElement;
    return {
      x: (this.projV.x * 0.5 + 0.5) * el.clientWidth,
      y: (-this.projV.y * 0.5 + 0.5) * el.clientHeight,
      visible: this.projV.z < 1,
    };
  };
  /** Camera yaw around the vertical axis; 0 looks toward -z. */
  get cameraYaw() {
    return this.rig.yaw;
  }
  readonly quality: QualityManager;
  readonly pipeline: Pipeline;
  readonly atmosphere: Atmosphere;

  private players = new Map<PlayerId, Character>();
  private npcs: { npc: Npc; character: Character; yaw: number }[] = [];
  private focus = new THREE.Vector3();

  private water: ReturnType<typeof createWater>;
  private buildings: ReturnType<typeof createBuildings>;
  private ground: GroundData;
  private fields: ReturnType<typeof createField>[] = [];
  private trees: ReturnType<typeof createTrees> | null = null;
  private rocks: ReturnType<typeof createRocks> | null = null;
  private particles: ReturnType<typeof createParticles> | null = null;
  private shafts: ReturnType<typeof createLightShafts> | null = null;
  private birds: ReturnType<typeof createBirds>;

  constructor(private container: HTMLElement) {
    // Antialiasing, tone mapping and colour output are handled by the post-processing pipeline.
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    const params = new URLSearchParams(location.search);
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.quality = new QualityManager(
      initialTier(params, isTouch, deviceHints(this.renderer)),
      params.get('adaptive') !== '0',
      tierOverrides(params),
      frameCap(params),
    );

    this.rig = new CameraRig(this.camera, params.get('cam') === 'close');
    this.atmosphere = new Atmosphere(this.scene);
    this.atmosphere.setPreset(presetFromParams(params));
    this.atmosphere.setShadowMapSize(this.quality.settings.shadowMapSize);

    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.quality.settings);
    this.quality.onChange = (_state, tierChanged) => {
      if (tierChanged) {
        this.pipeline.applyTier(this.quality.settings);
        this.atmosphere.setShadowMapSize(this.quality.settings.shadowMapSize);
        this.buildFields();
      }
      this.resize();
    };

    this.ground = bakeGroundData();
    this.water = createWater(this.atmosphere);
    this.scene.add(this.water.mesh);
    this.buildings = createBuildings(this.atmosphere);
    this.scene.add(this.buildings.group);
    this.birds = createBirds(this.atmosphere);
    this.scene.add(this.birds.mesh);
    this.buildPlaceholderWorld();
    this.buildFields();
    this.buildVillagers();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPlaceholderWorld() {
    const world = new THREE.Group();

    // The terrain extends far past the valley so its edge is always lost in the fog.
    const terrain = createTerrain(this.ground);
    world.add(terrain);


    this.scene.add(world);
    this.atmosphere.adopt(world);
    // Rolling ground casting onto itself at a low sun causes speckled artefacts; it only receives.
    terrain.castShadow = false;
  }

  private buildVillagers() {
    NPCS.forEach((npc, i) => {
      const character = new Character(LOOKS[npc.look], this.atmosphere, 3.1 + i * 5.7);
      character.root.position.set(npc.x, heightAt(npc.x, npc.z), npc.z);
      character.root.rotation.y = npc.rot;
      this.scene.add(character.root);
      this.npcs.push({ npc, character, yaw: npc.rot });
    });
  }

  /** (Re)build vegetation and rocks for the current quality tier. */
  private buildFields() {
    for (const f of this.fields) {
      this.scene.remove(f.mesh);
      f.dispose();
    }
    if (this.trees) {
      this.scene.remove(this.trees.group);
      this.trees.dispose();
    }
    if (this.rocks) {
      this.scene.remove(this.rocks.group);
      this.rocks.dispose();
    }
    if (this.particles) {
      this.scene.remove(this.particles.group);
      this.particles.dispose();
    }
    if (this.shafts) {
      this.scene.remove(this.shafts.mesh);
      this.shafts.dispose();
    }
    const tier = this.quality.settings;
    this.fields = [
      createField('grass', tier.grass, this.atmosphere, this.ground),
      createField('grass', { ...tier.grassFar, inner: tier.grass.radius * 0.85 }, this.atmosphere, this.ground),
      createField('flowers', tier.flowers, this.atmosphere, this.ground),
    ];
    for (const f of this.fields) this.scene.add(f.mesh);
    this.trees = createTrees(this.atmosphere, { farCount: tier.farTrees, leaves: tier.leaves, alphaToCoverage: tier.multisampling > 0 });
    this.rocks = createRocks(this.atmosphere, tier.pebbles);
    this.scene.add(this.trees.group, this.rocks.group);
    this.particles = createParticles(this.atmosphere, this.ground, tier.particles, () => this.renderer.getPixelRatio());
    this.shafts = createLightShafts(this.atmosphere, tier.lightShafts);
    this.scene.add(this.particles.group, this.shafts.mesh);
  }

  /** The villager who is speaking (expression and moving mouth); everyone else looks neutral. */
  setSpeaking(npcId: string | null, mood: string, talking: boolean) {
    for (const v of this.npcs) {
      const me = v.npc.id === npcId;
      v.character.talking = me && talking;
      v.character.setExpression(me ? mood : 'neutral');
    }
  }

  private convCover = 0;
  /** Frame a conversation between two ground points (feet positions). */
  startConversation(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    this.rig.conversation = { a: new THREE.Vector3(a.x, a.y, a.z), b: new THREE.Vector3(b.x, b.y, b.z), cover: this.convCover };
  }
  endConversation() {
    this.rig.conversation = null;
    this.rig.shot = null;
  }
  /** Hold the camera at a scripted pose. */
  startShot(pos: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }) {
    this.rig.shot = { pos: new THREE.Vector3(pos.x, pos.y, pos.z), look: new THREE.Vector3(look.x, look.y, look.z), cover: this.convCover };
  }
  get portrait() {
    return this.camera.aspect < 1;
  }
  /** Fraction of the screen covered by the dialogue box (keeps faces above it). */
  setConversationCover(f: number) {
    this.convCover = f;
    if (this.rig.conversation) this.rig.conversation.cover = f;
    if (this.rig.shot) this.rig.shot.cover = f;
  }

  triangleBreakdown() {
    const out: Record<string, number> = {};
    for (const child of this.scene.children) {
      let n = 0;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        const g = m.geometry;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : (g as THREE.InstancedBufferGeometry).instanceCount ?? 1;
        n += tris * (Number.isFinite(inst) ? inst : 1);
      });
      const key = child.name || child.type;
      out[key] = (out[key] ?? 0) + Math.round(n);
    }
    return out;
  }

  /** Draw calls and triangles for the last frame (all passes). */
  renderStats = { calls: 0, triangles: 0 };

  /** Switch quality from settings: a fixed tier, or null for automatic. */
  setQuality(tier: 'low' | 'medium' | 'high' | null) {
    const q = this.quality.state;
    q.adaptive = tier === null;
    if (tier && tier !== q.tier) {
      q.tier = tier;
      q.scale = 1;
      this.quality.onChange(q, true);
    } else if (tier) {
      q.scale = 1;
      this.resize();
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio(window.devicePixelRatio));
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical field of view so the tall frame shows more ground ahead.
    this.camera.fov = this.camera.aspect < 1 ? 60 : 45;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Render one frame. `alpha` (0..1) blends between the previous and current
   * simulation states so motion stays smooth at any display refresh rate.
   */
  render(prev: WorldState, curr: WorldState, alpha: number, followId: PlayerId | null, dt: number) {
    this.quality.sample(dt * 1000);

    // Add/remove characters to match the players in state.
    for (const id of Object.keys(curr.players)) {
      if (!this.players.has(id)) {
        const character = new Character(LOOKS.player, this.atmosphere, this.players.size * 7.3);
        this.scene.add(character.root);
        this.players.set(id, character);
      }
    }
    for (const [id, ch] of this.players) {
      if (!curr.players[id]) {
        this.scene.remove(ch.root);
        this.players.delete(id);
      }
    }

    for (const [id, ch] of this.players) {
      const c = curr.players[id];
      const p = prev.players[id] ?? c;
      const obj = ch.root;
      obj.position.x = p.position.x + (c.position.x - p.position.x) * alpha;
      obj.position.z = p.position.z + (c.position.z - p.position.z) * alpha;
      obj.position.y = heightAt(obj.position.x, obj.position.z);
      // Heading 0 faces -z; the model faces +z, hence pi - heading. Interpolate the short way round.
      let dh = c.heading - p.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const simYaw = Math.PI - (p.heading + dh * alpha);
      if (id === followId && this.faceTarget) {
        const want = Math.atan2(this.faceTarget.x - obj.position.x, this.faceTarget.z - obj.position.z);
        this.faceYaw ??= obj.rotation.y;
        let d = want - this.faceYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.faceYaw += d * Math.min(1, dt * 6);
        obj.rotation.y = this.faceYaw;
      } else {
        if (id === followId) this.faceYaw = null;
        obj.rotation.y = simYaw;
      }
      ch.update(dt, performance.now() / 1000, p.speed + (c.speed - p.speed) * alpha);
    }

    // Villagers idle in place, turning to face a nearby player.
    const me = followId ? this.players.get(followId) : undefined;
    for (const v of this.npcs) {
      let target = v.npc.rot;
      let near = false;
      if (me) {
        const dx = me.root.position.x - v.npc.x;
        const dz = me.root.position.z - v.npc.z;
        if (dx * dx + dz * dz < 5.5 * 5.5) {
          target = Math.atan2(dx, dz);
          near = true;
        }
      }
      let d = target - v.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // The head turns first, the body follows more slowly.
      v.yaw += d * Math.min(1, dt * 1.6);
      v.character.root.rotation.y = v.yaw;
      const headTurn = target - v.yaw;
      // Near the player: look at them. Otherwise glance around on their own.
      v.character.lookTarget = near ? THREE.MathUtils.clamp(Math.atan2(Math.sin(headTurn), Math.cos(headTurn)), -1, 1) : null;
      v.character.update(dt, performance.now() / 1000, 0);
    }

    const target = followId ? this.players.get(followId) : undefined;
    const me2 = followId ? curr.players[followId] : undefined;
    if (target && me2) {
      this.rig.update(dt, target.root.position, me2.heading, THREE.MathUtils.clamp(me2.speed / 4.5, 0, 1), this.cameraIdle);
      this.focus.copy(target.root.position);
    }

    // Villagers react when someone talks to them.
    for (const pl of Object.values(curr.players)) {
      const it = pl.interaction;
      if (!it || this.seenInteraction.get(pl.id) === it.tick) continue;
      this.seenInteraction.set(pl.id, it.tick);
      const v = this.npcs.find((n) => n.npc.id === it.targetId);
      if (v) {
        v.character.wave();
        this.onInteraction(it.targetId, pl.id);
      }
    }

    const time = performance.now() / 1000;
    this.atmosphere.update(time, this.camera, this.focus);
    this.water.update(time);
    updateCharacterLighting(this.atmosphere, this.camera, this.renderer.domElement.height);
    for (const f of this.fields) f.update(this.focus, time);
    // Scripted shots frame things on purpose, so nothing needs dissolving out of the way.
    const fadeFocus = this.rig.shot ? FAR_AWAY : this.focus;
    this.trees?.update(time, this.camera, fadeFocus);
    this.buildings.update(time, fadeFocus);
    this.rocks?.update(fadeFocus);
    this.particles?.update(time, this.focus);
    this.shafts?.update(time, this.camera);
    this.birds.update(time);
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.pipeline.render(dt);
    this.renderStats = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}
