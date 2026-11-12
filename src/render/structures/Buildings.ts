import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STRUCTURES, heightAt, type Structure } from '../../core';
import { OCCLUSION_FADE, OCCLUSION_FADE_PARS } from '../flora/Trees';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * The landmark tower and the props along the path, built from simple shapes.
 * Each structure is merged into one mesh for its painted body and one for its
 * glowing parts (windows, lanterns, crystal), so the whole set is a handful of
 * draw calls. Front faces +z before rotation.
 */
const C = {
  stone: '#ecd9b8',
  stoneDark: '#c9b292',
  plaster: '#f2e7d2',
  timber: '#7d5438',
  timberDark: '#5a3b28',
  roof: '#3f9aa0',
  roofLight: '#86cfc2',
  gold: '#e3b55e',
  door: '#5b3a26',
  stripeA: '#d9604c',
  stripeB: '#f4ead6',
  crate: '#b48a5e',
  sack: '#d8c39a',
  fruitA: '#e8553e',
  fruitB: '#f2a531',
  fruitC: '#8cbf4a',
  banner: '#3f9aa0',
};
const GLOW = {
  window: new THREE.Color('#ffce7a').multiplyScalar(2.6),
  lantern: new THREE.Color('#ffc066').multiplyScalar(4),
  crystal: new THREE.Color('#8ff0ff').multiplyScalar(5),
};

type Parts = { body: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] };

/** Bake a solid colour (or a vertical gradient) into a geometry, normalised for merging. */
function paint(geo: THREE.BufferGeometry, color: string | THREE.Color, top?: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Color(color);
  const b = top ? new THREE.Color(top) : a;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = max.y > min.y ? (pos.getY(i) - min.y) / (max.y - min.y) : 0;
    c.copy(a).lerp(b, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
};

/** Octagonal pieces are turned so a flat face (not a corner) faces the front. */
const oct = (rTop: number, rBottom: number, h: number) => new THREE.CylinderGeometry(rTop, rBottom, h, 8).rotateY(Math.PI / 8);

/** A sweeping eight-sided roof with upturned corners, plus its underside. */
function roof(radius: number, height: number, color: string, top: string): THREE.BufferGeometry[] {
  const pts = [
    [1.0, 0],
    [0.9, 0.1],
    [0.68, 0.32],
    [0.42, 0.62],
    [0.18, 0.88],
    [0.02, 1],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y * height));
  const g = new THREE.LatheGeometry(pts, 8);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(x, z);
    const corner = Math.pow(Math.max(Math.cos(4 * phi), 0), 6);
    const low = Math.pow(1 - y / height, 3);
    const push = 1 + 0.1 * corner * low;
    pos.setXYZ(i, x * push, y + corner * low * height * 0.22, z * push);
  }
  g.rotateY(Math.PI / 8);
  const under = new THREE.CircleGeometry(radius, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8);
  return [paint(g, color, top), paint(under, C.timberDark)];
}

function tower(): Parts {
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const corners = () => Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2);

  body.push(paint(at(oct(3.3, 3.55, 1.6), 0, -0.1, 0), C.stoneDark, C.stone)); // plinth, sunk into the slope
  body.push(paint(at(oct(2.55, 2.85, 4.2), 0, 2.8, 0), C.stoneDark, C.stone)); // base
  for (const a of corners()) {
    // Buttresses at the corners of the base.
    body.push(paint(at(new THREE.BoxGeometry(0.38, 4.2, 0.55), Math.sin(a) * 2.78, 2.8, Math.cos(a) * 2.78, a), C.stoneDark, C.stone));
  }
  body.push(paint(at(oct(2.8, 2.8, 0.3), 0, 5.05, 0), C.timber)); // band
  body.push(paint(at(oct(2.35, 2.45, 2.4), 0, 6.4, 0), C.plaster)); // upper floor
  for (const a of corners()) {
    body.push(paint(at(new THREE.BoxGeometry(0.2, 2.4, 0.2), Math.sin(a) * 2.42, 6.4, Math.cos(a) * 2.42, a), C.timber));
  }
  // Windows on alternate faces of the upper floor, small ones on the base.
  for (let k = 0; k < 8; k += 2) {
    const face = (k / 8) * Math.PI * 2;
    glow.push(paint(at(new THREE.PlaneGeometry(0.75, 1.0), Math.sin(face) * 2.27, 6.45, Math.cos(face) * 2.27, face), GLOW.window));
    body.push(paint(at(new THREE.BoxGeometry(0.95, 0.12, 0.12), Math.sin(face) * 2.3, 5.9, Math.cos(face) * 2.3, face), C.timber));
    if (k !== 0) glow.push(paint(at(new THREE.PlaneGeometry(0.45, 0.8), Math.sin(face) * 2.68, 3.3, Math.cos(face) * 2.68, face), GLOW.window));
  }
  body.push(...roof(3.5, 2.3, C.roof, C.roofLight).map((g) => g.translate(0, 7.6, 0)));
  body.push(paint(at(oct(0.95, 1.05, 1.3), 0, 10.0, 0), C.plaster)); // cupola
  for (let k = 0; k < 8; k += 2) {
    const face = (k / 8) * Math.PI * 2;
    glow.push(paint(at(new THREE.PlaneGeometry(0.4, 0.6), Math.sin(face) * 0.93, 10.05, Math.cos(face) * 0.93, face), GLOW.window));
  }
  body.push(...roof(1.65, 1.7, C.roof, C.roofLight).map((g) => g.translate(0, 10.65, 0)));
  body.push(paint(at(new THREE.ConeGeometry(0.1, 1.2, 6), 0, 12.9, 0), C.gold)); // spire

  // Door with a stone frame, and steps down to the path.
  body.push(paint(at(new THREE.BoxGeometry(1.35, 2.3, 0.2), 0, 1.85, 2.72), C.door));
  body.push(paint(at(new THREE.BoxGeometry(1.75, 0.3, 0.35), 0, 3.1, 2.75), C.stone));
  body.push(paint(at(new THREE.BoxGeometry(0.25, 2.5, 0.35), -0.8, 1.95, 2.75), C.stone));
  body.push(paint(at(new THREE.BoxGeometry(0.25, 2.5, 0.35), 0.8, 1.95, 2.75), C.stone));
  glow.push(paint(at(new THREE.PlaneGeometry(0.5, 0.5), 0, 2.55, 2.83), GLOW.window)); // fanlight
  for (let s = 0; s < 3; s++) body.push(paint(at(new THREE.BoxGeometry(2.0, 0.25, 0.55), 0, 0.55 - s * 0.25, 3.55 + s * 0.5), C.stone));

  // Banners hanging from the band either side of the door.
  for (const side of [-1, 1]) {
    body.push(paint(at(new THREE.BoxGeometry(0.7, 1.9, 0.05), side * 1.35, 4.0, 2.62), C.banner, C.roofLight));
    body.push(paint(at(new THREE.BoxGeometry(0.8, 0.08, 0.08), side * 1.35, 4.98, 2.64), C.gold));
  }
  return { body, glow };
}

function stall(): Parts {
  const body: THREE.BufferGeometry[] = [];
  for (const [x, z, h] of [[-1.3, 0.6, 2.2], [1.3, 0.6, 2.2], [-1.3, -0.7, 2.6], [1.3, -0.7, 2.6]]) {
    body.push(paint(at(new THREE.BoxGeometry(0.14, h, 0.14), x, h / 2 - 0.1, z), C.timberDark, C.timber));
  }
  body.push(paint(at(new THREE.BoxGeometry(2.7, 0.9, 0.8), 0, 0.4, 0.45), C.timberDark, C.timber)); // counter
  body.push(paint(at(new THREE.BoxGeometry(2.8, 0.08, 0.9), 0, 0.88, 0.45), C.timber));
  // Striped awning, sloping down toward the front.
  const stripes = 7;
  for (let i = 0; i < stripes; i++) {
    const w = 3.0 / stripes;
    const g = new THREE.BoxGeometry(w, 0.06, 1.8);
    g.rotateX(0.22);
    body.push(paint(at(g, -1.5 + w * (i + 0.5), 2.45, 0.0), i % 2 ? C.stripeB : C.stripeA));
  }
  // Scalloped valance along the front edge.
  for (let i = 0; i < stripes; i++) {
    const w = 3.0 / stripes;
    body.push(paint(at(new THREE.BoxGeometry(w * 0.95, 0.3, 0.04), -1.5 + w * (i + 0.5), 2.08, 0.92), i % 2 ? C.stripeA : C.stripeB));
  }
  // Goods on the counter.
  const fruit = [C.fruitA, C.fruitB, C.fruitC];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(0.12, 1);
    body.push(paint(at(g, -1.0 + (i % 3) * 0.25 + Math.floor(i / 3) * 0.75, 1.02, 0.35 + (i % 2) * 0.15), fruit[i % 3]));
  }
  // Crates, a barrel and sacks around the stall.
  body.push(paint(at(new THREE.BoxGeometry(0.6, 0.6, 0.6), 1.85, 0.25, 0.3, 0.3), C.crate));
  body.push(paint(at(new THREE.BoxGeometry(0.5, 0.5, 0.5), 1.8, 0.8, 0.25, 0.8), C.crate));
  body.push(paint(at(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 10), -1.9, 0.35, 0.2), C.timber, C.crate));
  body.push(paint(at(new THREE.SphereGeometry(0.3, 8, 6).scale(1, 1.2, 1), -1.75, 0.3, 0.85), C.sack));
  body.push(paint(at(new THREE.SphereGeometry(0.26, 8, 6).scale(1, 1.2, 1), -1.35, 0.27, 1.05), C.sack));
  return { body, glow: [] };
}

function lantern(): Parts {
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  body.push(paint(at(new THREE.CylinderGeometry(0.06, 0.09, 2.2, 6), 0, 1.0, 0), C.timberDark, C.timber));
  body.push(paint(at(new THREE.BoxGeometry(0.06, 0.06, 0.55), 0, 2.0, 0.25), C.timberDark)); // arm toward the path
  body.push(paint(at(new THREE.BoxGeometry(0.26, 0.05, 0.26), 0, 1.78, 0.5), C.timberDark)); // lamp cap
  body.push(paint(at(new THREE.ConeGeometry(0.2, 0.16, 4).rotateY(Math.PI / 4), 0, 1.86, 0.5), C.timberDark));
  glow.push(paint(at(new THREE.BoxGeometry(0.18, 0.26, 0.18), 0, 1.6, 0.5), GLOW.lantern));
  body.push(paint(at(new THREE.BoxGeometry(0.24, 0.04, 0.24), 0, 1.45, 0.5), C.timberDark));
  return { body, glow };
}

function signpost(): Parts {
  const body: THREE.BufferGeometry[] = [];
  body.push(paint(at(new THREE.BoxGeometry(0.12, 1.9, 0.12), 0, 0.85, 0), C.timberDark, C.timber));
  // Two arrow boards at different angles.
  for (const [y, ang] of [[1.55, 0.9], [1.2, -1.3]]) {
    const g = new THREE.BoxGeometry(0.9, 0.2, 0.05);
    g.translate(0.4, 0, 0);
    body.push(paint(at(g, 0, y, 0, ang), C.crate));
  }
  return { body, glow: [] };
}

const BUILDERS: Record<Structure['kind'], () => Parts> = { tower, stall, lantern, signpost };

export function createBuildings(atmosphere: Atmosphere) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const uniforms = { uPlayerPos: { value: new THREE.Vector3() } };
  const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  bodyMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayerPos = uniforms.uPlayerPos;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OCCLUSION_FADE_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OCCLUSION_FADE}`);
  };
  bodyMaterial.customProgramCacheKey = () => 'bq-building';
  // Glowing parts: unlit colours above 1.0, so the bloom picks them up.
  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  const geos: THREE.BufferGeometry[] = [];
  let crystal: THREE.Mesh | null = null;
  for (const s of STRUCTURES) {
    const { body, glow } = BUILDERS[s.kind]();
    const y = heightAt(s.x, s.z) - (s.kind === 'tower' ? 0.25 : 0.05);
    const place = (g: THREE.BufferGeometry) => g.rotateY(s.rot).translate(s.x, y, s.z);
    const b = place(mergeGeometries(body)!);
    group.add(new THREE.Mesh(b, bodyMaterial));
    geos.push(b);
    if (glow.length) {
      const gl = place(mergeGeometries(glow)!);
      const m = new THREE.Mesh(gl, glowMaterial);
      m.name = 'glow';
      group.add(m);
      geos.push(gl);
    }
    if (s.kind === 'tower') {
      const cg = paint(new THREE.OctahedronGeometry(0.42), GLOW.crystal);
      cg.scale(1, 1.6, 1);
      crystal = new THREE.Mesh(cg, glowMaterial);
      crystal.position.set(s.x, y + 13.75, s.z);
      crystal.name = 'crystal';
      group.add(crystal);
      geos.push(cg);
    }
  }

  atmosphere.adopt(group, { cast: true, receive: true });
  group.children.forEach((m) => {
    if (m.name === 'glow' || m.name === 'crystal') m.castShadow = false;
  });

  const baseY = crystal?.position.y ?? 0;
  return {
    group,
    update(time: number, player: THREE.Vector3) {
      uniforms.uPlayerPos.value.copy(player);
      if (crystal) {
        crystal.rotation.y = time * 0.6;
        crystal.position.y = baseY + Math.sin(time * 1.1) * 0.18;
      }
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      bodyMaterial.dispose();
      glowMaterial.dispose();
    },
  };
}
