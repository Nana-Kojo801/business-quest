import * as THREE from 'three';
import type { PlayerId, WorldState } from '../core';
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
      }
      this.resize();
    };

    this.buildPlaceholderWorld();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPlaceholderWorld() {
    const world = new THREE.Group();

    // Large enough that its edge is always lost in the fog, so the ground meets the sky cleanly.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(300, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#66985c', roughness: 1 }),
    );
    world.add(ground);

    // Temporary markers so movement is visible until the real world is built.
    const markerMat = new THREE.MeshStandardMaterial({ color: '#6a5a9a', roughness: 0.8 });
    const markerGeo = new THREE.ConeGeometry(0.35, 1.2, 6);
    // Every fifth marker is a glowing crystal, to show off bloom until real props exist.
    const crystalMat = new THREE.MeshStandardMaterial({ color: '#9fe8ff', emissive: '#5cd6ff', emissiveIntensity: 4 });
    const crystalGeo = new THREE.OctahedronGeometry(0.35);
    for (let i = 0; i < 60; i++) {
      const a = i * 2.399963; // golden-angle spiral
      const r = 2.5 + Math.sqrt(i) * 4.2;
      const crystal = i % 5 === 2;
      const m = new THREE.Mesh(crystal ? crystalGeo : markerGeo, crystal ? crystalMat : markerMat);
      m.position.set(Math.cos(a) * r, crystal ? 0.9 : 0.6, Math.sin(a) * r);
      if (crystal) m.scale.y = 1.8;
      world.add(m);
    }

    this.scene.add(world);
    this.atmosphere.adopt(world);
    ground.castShadow = false;
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
        mesh.position.y = 0.5;
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
      this.camera.position.set(t.x - fx * back, 4.5, t.z - fz * back);
      this.camera.lookAt(t.x + fx * ahead, 1.2, t.z + fz * ahead);
      this.focus.copy(t);
    }

    this.atmosphere.update(performance.now() / 1000, this.camera, this.focus);
    this.pipeline.render(dt);
  }
}
