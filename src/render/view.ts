import * as THREE from 'three';
import type { PlayerId, WorldState } from '../core';

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

  private players = new Map<PlayerId, THREE.Object3D>();
  private playerGeo = new THREE.SphereGeometry(0.5, 32, 16);
  private playerMat = new THREE.MeshStandardMaterial({ color: '#ffc46b', emissive: '#ff8a3d', emissiveIntensity: 0.4 });

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.buildPlaceholderWorld();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPlaceholderWorld() {
    const s = this.scene;
    s.background = new THREE.Color('#f2a97c');
    s.fog = new THREE.Fog('#f2a97c', 12, 40);
    s.add(new THREE.HemisphereLight('#ffe2c4', '#5a4a7a', 1.2));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(6, 10, 4);
    s.add(sun);

    s.add(new THREE.Mesh(
      new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#7fb07a', roughness: 1 }),
    ));

    // Temporary markers so movement is visible until the real world is built.
    const markerMat = new THREE.MeshStandardMaterial({ color: '#8a7fb0', roughness: 0.8 });
    const markerGeo = new THREE.ConeGeometry(0.35, 1.2, 6);
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399963; // golden-angle spiral
      const r = 2.5 + Math.sqrt(i) * 3.6;
      const m = new THREE.Mesh(markerGeo, markerMat);
      m.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
      s.add(m);
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical field of view so the tall frame shows more ground ahead.
    this.camera.fov = this.camera.aspect < 1 ? 60 : 45;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Render one frame. `alpha` (0..1) blends between the previous and current
   * simulation states so motion stays smooth at any display refresh rate.
   */
  render(prev: WorldState, curr: WorldState, alpha: number, followId: PlayerId | null) {
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

    this.renderer.render(this.scene, this.camera);
  }
}
