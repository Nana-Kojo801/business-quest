import * as THREE from 'three';
import { heightAt, type PlayerId, type WorldState } from '../core';
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
import { QualityManager, initialTier } from './quality';
import { Atmosphere } from './sky/Atmosphere';
import { presetFromParams } from './sky/presets';

/**
 * Draws the world. Reads game state every frame and never changes it.
 * Owns all three.js objects.
 */
export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  /** Camera yaw around the vertical axis; 0 looks toward -z. */
  cameraYaw = 0;
  readonly quality: QualityManager;
  readonly pipeline: Pipeline;
  readonly atmosphere: Atmosphere;

  private players = new Map<PlayerId, THREE.Object3D>();
  private playerGeo = new THREE.SphereGeometry(0.5, 32, 16);
  private playerMat = new THREE.MeshStandardMaterial({ color: '#ffc46b', emissive: '#ff8a3d', emissiveIntensity: 1.6 });
  private focus = new THREE.Vector3();
  private cameraGround = 0;
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
    this.quality = new QualityManager(initialTier(params, isTouch), params.get('adaptive') !== '0');

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
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPlaceholderWorld() {
    const world = new THREE.Group();

    // The terrain extends far past the valley so its edge is always lost in the fog.
    const terrain = createTerrain();
    world.add(terrain);


    this.scene.add(world);
    this.atmosphere.adopt(world);
    // Rolling ground casting onto itself at a low sun causes speckled artefacts; it only receives.
    terrain.castShadow = false;
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
      createField('flowers', tier.flowers, this.atmosphere, this.ground),
    ];
    for (const f of this.fields) this.scene.add(f.mesh);
    this.trees = createTrees(this.atmosphere, { farCount: tier.farTrees });
    this.rocks = createRocks(this.atmosphere, tier.pebbles);
    this.scene.add(this.trees.group, this.rocks.group);
    this.particles = createParticles(this.atmosphere, this.ground, tier.particles, () => this.renderer.getPixelRatio());
    this.shafts = createLightShafts(this.atmosphere, tier.lightShafts);
    this.scene.add(this.particles.group, this.shafts.mesh);
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

    // Add/remove meshes to match the players in state.
    for (const id of Object.keys(curr.players)) {
      if (!this.players.has(id)) {
        const mesh = new THREE.Mesh(this.playerGeo, this.playerMat);
        this.atmosphere.adopt(mesh, { cast: true, receive: false });
        this.scene.add(mesh);
        this.players.set(id, mesh);
      }
    }
    for (const [id, obj] of this.players) {
      if (!curr.players[id]) {
        this.scene.remove(obj);
        this.players.delete(id);
      }
    }

    for (const [id, obj] of this.players) {
      const c = curr.players[id];
      const p = prev.players[id] ?? c;
      obj.position.x = p.position.x + (c.position.x - p.position.x) * alpha;
      obj.position.z = p.position.z + (c.position.z - p.position.z) * alpha;
      obj.position.y = heightAt(obj.position.x, obj.position.z) + 0.5;
      obj.rotation.y = -c.heading;
    }

    const target = followId ? this.players.get(followId) : undefined;
    if (target) {
      const t = target.position;
      const fx = Math.sin(this.cameraYaw);
      const fz = -Math.cos(this.cameraYaw);
      // Placeholder framing (refined with the camera work later): low enough to show the sky.
      const back = 9;
      const ahead = 4;
      // Follow the ground height smoothly so small bumps don't jolt the camera.
      const ground = t.y - 0.5;
      this.cameraGround += (ground - this.cameraGround) * Math.min(1, dt * 4);
      this.camera.position.set(t.x - fx * back, this.cameraGround + 4.5, t.z - fz * back);
      this.camera.lookAt(t.x + fx * ahead, this.cameraGround + 1.2, t.z + fz * ahead);
      this.focus.copy(t);
    }

    const time = performance.now() / 1000;
    this.atmosphere.update(time, this.camera, this.focus);
    this.water.update(time);
    for (const f of this.fields) f.update(this.focus, time);
    this.trees?.update(time, this.camera, this.focus);
    this.buildings.update(time, this.focus);
    this.particles?.update(time, this.focus);
    this.shafts?.update(time, this.camera);
    this.birds.update(time);
    this.pipeline.render(dt);
  }
}
