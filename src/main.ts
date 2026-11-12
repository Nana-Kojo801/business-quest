import * as THREE from 'three';
import { Input } from './input';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f2a97c');
scene.fog = new THREE.Fog('#f2a97c', 12, 40);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight('#ffe2c4', '#5a4a7a', 1.2));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(6, 10, 4);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#7fb07a', roughness: 1 }),
);
scene.add(ground);

// Temporary markers so movement is visible until the real world is built.
const markerMat = new THREE.MeshStandardMaterial({ color: '#8a7fb0', roughness: 0.8 });
const markerGeo = new THREE.ConeGeometry(0.35, 1.2, 6);
for (let i = 0; i < 40; i++) {
  const a = i * 2.399963; // golden angle spiral
  const r = 2.5 + Math.sqrt(i) * 3.6;
  const m = new THREE.Mesh(markerGeo, markerMat);
  m.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
  scene.add(m);
}

const player = new THREE.Mesh(
  new THREE.SphereGeometry(0.5, 32, 16),
  new THREE.MeshStandardMaterial({ color: '#ffc46b', emissive: '#ff8a3d', emissiveIntensity: 0.4 }),
);
player.position.y = 0.5;
scene.add(player);

const input = new Input(renderer.domElement);

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Portrait screens get a wider vertical field of view so the tall frame shows more ground ahead.
  camera.fov = camera.aspect < 1 ? 60 : 45;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Debug/test hook. Read by the automated tests; not used by gameplay. */
const debug = { frames: 0, player: { x: 0, z: 0 } };
(window as unknown as { __bq: typeof debug }).__bq = debug;

const SPEED = 4;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const move = input.read();
  player.position.x += move.x * SPEED * dt;
  player.position.z -= move.y * SPEED * dt;

  camera.position.set(player.position.x, 6, player.position.z + 9);
  camera.lookAt(player.position.x, 0.5, player.position.z - 2);

  renderer.render(scene, camera);
  debug.frames++;
  debug.player.x = player.position.x;
  debug.player.z = player.position.z;
});
