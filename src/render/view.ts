import * as THREE from 'three';
import type { PlayerId, WorldState } from '../core';
import { Pipeline } from './pipeline';
import { QualityManager, initialTier } from './quality';

/**
 * Draws the world. Reads game state every frame and never changes it.
 * Owns all three.js objects.
 */
export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  /** Camera yaw around the vertical axis; 0 looks toward -z. */
  cameraYaw = 0;

  readonly quality: QualityManager;
  readonly pipeline: Pipeline;
  private players = new Map<PlayerId, THREE.Object3D>();
  private playerGeo = new THREE.SphereGeometry(0.5, 32, 16);
  private playerMat = new THREE.MeshStandardMaterial({ color: '#ffc46b', emissive: '#ff8a3d', emissiveIntensity: 1.6 });

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
    container.appendChild(this.renderer.domElement);

    const params = new URLSearchParams(location.search);
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.quality = new QualityManager(initialTier(params, isTouch), params.get('adaptive') !== '0');
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.quality.settings);
    this.quality.onChange = (_state, tierChanged) => {
      if (tierChanged) this.pipeline.applyTier(this.quality.settings);
      this.resize();
    };

    this.buildPlaceholderWorld();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPlaceholderWorld() {
    const s = this.scene;
    s.background = new THREE.Color('#f2a97c');
    // Fog starts well past the player so nearby things keep their contrast.
    s.fog = new THREE.Fog('#f2a97c', 22, 75);
    // Low ambient, strong sun: surfaces get a lit side and a shadow side.
    s.add(new THREE.HemisphereLight('#ffd9b8', '#3a2f5c', 0.55));
    const sun = new THREE.DirectionalLight('#fff0d4', 3.2);
    sun.position.set(6, 10, 4);
    s.add(sun);

    s.add(new THREE.Mesh(
      new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#66985c', roughness: 1 }),
    ));

    // Temporary markers so movement is visible until the real world is built.
    const markerMat = new THREE.MeshStandardMaterial({ color: '#6a5a9a', roughness: 0.8 });
    const markerGeo = new THREE.ConeGeometry(0.35, 1.2, 6);
    // Every fifth marker is a glowing crystal, to show off bloom until real props exist.
    const crystalMat = new THREE.MeshStandardMaterial({ color: '#9fe8ff', emissive: '#5cd6ff', emissiveIntensity: 4 });
    const crystalGeo = new THREE.OctahedronGeometry(0.35);
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399963; // golden-angle spiral
      const r = 2.5 + Math.sqrt(i) * 3.6;
      const crystal = i % 5 === 2;
      const m = new THREE.Mesh(crystal ? crystalGeo : markerGeo, crystal ? crystalMat : markerMat);
      m.position.set(Math.cos(a) * r, crystal ? 0.9 : 0.6, Math.sin(a) * r);
      if (crystal) m.scale.y = 1.8;
      s.add(m);
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

    // Add/remove meshes to match the players in state.
    for (const id of Object.keys(curr.players)) {
      if (!this.players.has(id)) {
        const mesh = new THREE.Mesh(this.playerGeo, this.playerMat);
        mesh.position.y = 0.5;
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
      const back = 9;
      this.camera.position.set(t.x - Math.sin(this.cameraYaw) * back, 6, t.z + Math.cos(this.cameraYaw) * back);
      this.camera.lookAt(t.x + Math.sin(this.cameraYaw) * 2, 0.5, t.z - Math.cos(this.cameraYaw) * 2);
    }

    this.pipeline.render(dt);
  }
}
