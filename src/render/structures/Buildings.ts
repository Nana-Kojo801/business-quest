import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STRUCTURES, heightAt, type Structure } from '../../core';
import { addFade } from '../fade';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * The landmark tower and the props along the path, built from simple shapes.
 *
 * Every vertex carries a surface type (aMat). The shader draws detail from it:
 * stone block courses with mortar, scalloped roof tiles, wood grain and planks,
 * mottled plaster. That gives close-up detail without extra geometry.
 *
 * Each structure is merged into one painted mesh plus one glowing mesh, so the
 * whole set is a handful of draw calls. Front faces +z before rotation.
 */
const enum Mat {
  Plain = 0,
  Stone = 1,
  Plaster = 2,
  Wood = 3,
  Tile = 4,
  Metal = 5,
}

const C = {
  stone: '#ecd9b8',
  stoneDark: '#c4ad8e',
  paving: '#d8c8ad',
  plaster: '#f4ead6',
  timber: '#8a5d3c',
  timberDark: '#5e3e2a',
  roof: '#3f9aa0',
  roofLight: '#86cfc2',
  gold: '#e8bb5e',
  iron: '#3c3a42',
  door: '#6a4329',
  shutter: '#3f9aa0',
  stripeA: '#d9604c',
  stripeB: '#f6eddb',
  crate: '#b98d5f',
  sack: '#dcc79e',
  basket: '#a8794a',
  fruit: ['#e8553e', '#f2a531', '#8cbf4a', '#c94a7c'],
  flowers: ['#ff8fb8', '#ffd65a', '#ffffff', '#b9a2ff'],
};
const GLOW = {
  window: new THREE.Color('#ffce7a').multiplyScalar(2.6),
  lantern: new THREE.Color('#ffc066').multiplyScalar(4),
  crystal: new THREE.Color('#8ff0ff').multiplyScalar(5),
};

type Parts = { body: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] };

/** Bake colour (optionally a vertical gradient) and surface type into a geometry, normalised for merging. */
function paint(geo: THREE.BufferGeometry, color: string | THREE.Color, mat: Mat = Mat.Plain, top?: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Color(color);
  const b = top ? new THREE.Color(top) : a;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const col = new Float32Array(pos.count * 3);
  const mats = new Float32Array(pos.count).fill(mat);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = max.y > min.y ? (pos.getY(i) - min.y) / (max.y - min.y) : 0;
    c.copy(a).lerp(b, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mats, 1));
  return g;
}

/** A copy facing the other way, so thin cloth is visible from both sides. */
function twoSided(g: THREE.BufferGeometry) {
  const back = g.clone();
  const pos = back.attributes.position as THREE.BufferAttribute;
  const nor = back.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    // Swap two vertices of each triangle to flip its winding.
    for (const attr of Object.values(back.attributes) as THREE.BufferAttribute[]) {
      const s = attr.itemSize;
      for (let k = 0; k < s; k++) {
        const t = attr.array[(i + 1) * s + k];
        (attr.array as Float32Array)[(i + 1) * s + k] = attr.array[(i + 2) * s + k];
        (attr.array as Float32Array)[(i + 2) * s + k] = t;
      }
    }
  }
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return mergeGeometries([g, back])!;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
};
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Octagonal pieces are turned so a flat face (not a corner) faces the front. */
const oct = (rTop: number, rBottom: number, h: number) => new THREE.CylinderGeometry(rTop, rBottom, h, 8).rotateY(Math.PI / 8);
/** Face k of an octagon points at angle k * 45 degrees; its centre is at the apothem. */
const faceAngle = (k: number) => (k / 8) * Math.PI * 2;
const apothem = (r: number) => r * Math.cos(Math.PI / 8);
const onFace = (g: THREE.BufferGeometry, k: number, dist: number, y: number) => {
  const a = faceAngle(k);
  return g.rotateY(a).translate(Math.sin(a) * dist, y, Math.cos(a) * dist);
};
/** Corner k sits between faces k and k+1. */
const cornerAngle = (k: number) => faceAngle(k) + Math.PI / 8;

/** A sweeping eight-sided roof with upturned corners, its underside, and gold corner ornaments. */
function roof(radius: number, height: number, y: number): THREE.BufferGeometry[] {
  const lift = 0.22;
  const pts = [
    [1.0, 0],
    [0.9, 0.1],
    [0.68, 0.32],
    [0.42, 0.62],
    [0.18, 0.88],
    [0.02, 1],
  ].map(([r, yy]) => new THREE.Vector2(r * radius, yy * height));
  const g = new THREE.LatheGeometry(pts, 8);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const yy = pos.getY(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(x, z);
    const corner = Math.pow(Math.max(Math.cos(4 * phi), 0), 6);
    const low = Math.pow(1 - yy / height, 3);
    const push = 1 + 0.1 * corner * low;
    pos.setXYZ(i, x * push, yy + corner * low * height * lift, z * push);
  }
  g.rotateY(Math.PI / 8);
  const parts = [paint(g, C.roof, Mat.Tile, C.roofLight).translate(0, y, 0)];
  parts.push(paint(new THREE.CircleGeometry(radius, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8), C.timberDark, Mat.Wood).translate(0, y, 0));
  for (let k = 0; k < 8; k++) {
    // Gold curl at each upturned corner tip.
    const a = cornerAngle(k);
    const tipR = radius * 1.1;
    const tipY = y + height * lift;
    // Small and nearly upright, so it reads as a finial on the tip rather than a horn.
    const curl = new THREE.ConeGeometry(0.035 * radius, 0.16 * radius, 6);
    curl.translate(0, 0.08 * radius, 0).rotateX(-0.3).rotateY(a);
    parts.push(paint(at(curl, Math.sin(a) * tipR * 0.99, tipY + 0.02, Math.cos(a) * tipR * 0.99), C.gold, Mat.Metal));
    parts.push(paint(at(new THREE.IcosahedronGeometry(0.03 * radius + 0.02, 1), Math.sin(a) * tipR * 0.99, tipY, Math.cos(a) * tipR * 0.99), C.gold, Mat.Metal));
  }
  // Eave brackets under each corner.
  for (let k = 0; k < 8; k++) {
    const a = cornerAngle(k);
    const b = box(0.12, 0.12, radius * 0.35);
    b.rotateX(-0.6);
    parts.push(paint(at(b, Math.sin(a) * radius * 0.78, y - 0.12, Math.cos(a) * radius * 0.78, a), C.timberDark, Mat.Wood));
  }
  return parts;
}

/** A small hanging lamp: iron cage, cap and glowing glass. Returns body and glow parts at the origin (hook at top). */
function hangingLamp(scale = 1): Parts {
  const s = scale;
  const body = [
    paint(at(new THREE.ConeGeometry(0.16 * s, 0.14 * s, 4).rotateY(Math.PI / 4), 0, -0.07 * s, 0), C.iron, Mat.Metal),
    paint(at(box(0.24 * s, 0.03 * s, 0.24 * s), 0, -0.4 * s, 0), C.iron, Mat.Metal),
    paint(at(new THREE.IcosahedronGeometry(0.035 * s, 0), 0, 0.02 * s, 0), C.gold, Mat.Metal),
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    body.push(paint(at(box(0.025 * s, 0.26 * s, 0.025 * s), x * 0.1 * s, -0.27 * s, z * 0.1 * s), C.iron, Mat.Metal));
  }
  const glow = [paint(at(box(0.17 * s, 0.24 * s, 0.17 * s), 0, -0.27 * s, 0), GLOW.lantern)];
  return { body, glow };
}

function tower(): Parts {
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const add = (p: Parts, x: number, y: number, z: number, ry = 0) => {
    p.body.forEach((g) => body.push(at(g, x, y, z, ry)));
    p.glow.forEach((g) => glow.push(at(g, x, y, z, ry)));
  };

  // Ground: paving around the foot of the tower, plinth sunk into the slope.
  body.push(paint(at(new THREE.CylinderGeometry(5.2, 5.4, 0.5, 24), 0, -0.05, 0), C.paving, Mat.Stone));
  body.push(paint(at(oct(3.3, 3.55, 1.6), 0, 0.1, 0), C.stoneDark, Mat.Stone, C.stone));

  // Stone base with buttresses at the corners.
  body.push(paint(at(oct(2.55, 2.85, 4.2), 0, 3.0, 0), C.stoneDark, Mat.Stone, C.stone));
  for (let k = 0; k < 8; k++) {
    const a = cornerAngle(k);
    const b = new THREE.CylinderGeometry(0.22, 0.34, 4.4, 4).rotateY(Math.PI / 4);
    body.push(paint(at(b, Math.sin(a) * 2.75, 3.0, Math.cos(a) * 2.75, a), C.stoneDark, Mat.Stone, C.stone));
  }

  // Arched door with a stone surround, studs and lamps either side.
  const doorZ = apothem(2.75);
  body.push(paint(at(box(1.3, 1.9, 0.18), 0, 1.75, doorZ), C.door, Mat.Wood));
  body.push(paint(at(new THREE.CylinderGeometry(0.65, 0.65, 0.18, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 0, 2.7, doorZ), C.door, Mat.Wood));
  body.push(paint(at(new THREE.TorusGeometry(0.78, 0.13, 6, 16, Math.PI), 0, 2.7, doorZ + 0.06), C.stone, Mat.Stone));
  for (const side of [-1, 1]) {
    body.push(paint(at(box(0.26, 1.95, 0.3), side * 0.78, 1.72, doorZ + 0.06), C.stone, Mat.Stone));
    for (let s = 0; s < 3; s++) body.push(paint(at(new THREE.IcosahedronGeometry(0.035, 0), side * 0.35, 1.2 + s * 0.6, doorZ + 0.1), C.iron, Mat.Metal));
    body.push(paint(at(box(0.05, 0.05, 0.4), side * 1.25, 3.05, doorZ + 0.15), C.iron, Mat.Metal)); // lamp bracket
    add(hangingLamp(1.1), side * 1.25, 3.05, doorZ + 0.38);
  }
  // Steps down to the path.
  for (let s = 0; s < 4; s++) body.push(paint(at(box(2.3 - s * 0.05, 0.22, 0.5), 0, 0.72 - s * 0.22, doorZ + 0.45 + s * 0.48), C.stone, Mat.Stone));

  // Slit windows in the base.
  for (const k of [2, 3, 5, 6]) {
    glow.push(onFace(paint(new THREE.PlaneGeometry(0.4, 0.85), GLOW.window), k, apothem(2.62) + 0.02, 3.6));
    body.push(onFace(paint(new THREE.TorusGeometry(0.26, 0.07, 4, 10, Math.PI), C.stone, Mat.Stone), k, apothem(2.62) + 0.04, 4.02));
    body.push(onFace(paint(box(0.6, 0.1, 0.18), C.stone, Mat.Stone), k, apothem(2.62) + 0.05, 3.15));
  }

  // Cornice and a balcony ring with railing, carried on brackets.
  body.push(paint(at(oct(2.95, 2.75, 0.35), 0, 5.2, 0), C.stone, Mat.Stone));
  body.push(paint(at(oct(3.15, 3.15, 0.14), 0, 5.42, 0), C.timber, Mat.Wood));
  for (let k = 0; k < 8; k++) {
    const a = faceAngle(k);
    const br = box(0.12, 0.12, 0.6);
    br.rotateX(0.7);
    body.push(paint(at(br, Math.sin(a) * 2.75, 5.05, Math.cos(a) * 2.75, a), C.timberDark, Mat.Wood));
    // Railing: a top rail and three balusters per face.
    const side = 2 * 3.05 * Math.tan(Math.PI / 8);
    body.push(onFace(paint(box(side, 0.07, 0.07), C.timber, Mat.Wood), k, apothem(3.05), 6.0));
    for (const t of [-0.33, 0, 0.33]) {
      const bal = box(0.06, 0.55, 0.06).translate(t * side, 0, 0);
      body.push(onFace(paint(bal, C.timberDark, Mat.Wood), k, apothem(3.05), 5.72));
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = cornerAngle(k);
    body.push(paint(at(box(0.09, 0.62, 0.09), Math.sin(a) * 3.1, 5.72, Math.cos(a) * 3.1), C.timberDark, Mat.Wood));
  }

  // Half-timbered upper floor.
  const upR = 2.4;
  body.push(paint(at(oct(upR, upR + 0.05, 2.6), 0, 6.75, 0), C.plaster, Mat.Plaster));
  const upAp = apothem(upR) + 0.03;
  const faceW = 2 * upR * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = cornerAngle(k);
    body.push(paint(at(box(0.2, 2.6, 0.2), Math.sin(a) * (upR - 0.02), 6.75, Math.cos(a) * (upR - 0.02), a), C.timber, Mat.Wood));
    body.push(onFace(paint(box(faceW, 0.14, 0.08), C.timber, Mat.Wood), k, upAp, 5.55));
    body.push(onFace(paint(box(faceW, 0.14, 0.08), C.timber, Mat.Wood), k, upAp, 8.0));
    if (k % 2 === 1) {
      // X-bracing on the faces between windows.
      for (const dir of [-1, 1]) {
        const brace = box(0.12, Math.hypot(faceW, 2.3) * 0.95, 0.06);
        brace.rotateZ(dir * Math.atan2(faceW, 2.3));
        body.push(onFace(paint(brace, C.timber, Mat.Wood), k, upAp, 6.78));
      }
    }
  }
  // Arched windows with frames, open shutters and flower boxes.
  for (const k of [0, 2, 4, 6]) {
    glow.push(onFace(paint(new THREE.PlaneGeometry(0.7, 0.85), GLOW.window), k, upAp + 0.01, 6.6));
    glow.push(onFace(paint(new THREE.CircleGeometry(0.35, 12, 0, Math.PI), GLOW.window), k, upAp + 0.01, 7.02));
    body.push(onFace(paint(new THREE.TorusGeometry(0.4, 0.06, 4, 12, Math.PI), C.timber, Mat.Wood), k, upAp + 0.04, 7.02));
    for (const side of [-1, 1]) {
      body.push(onFace(paint(box(0.08, 0.95, 0.08).translate(side * 0.4, 0, 0), C.timber, Mat.Wood), k, upAp + 0.04, 6.55));
      const shutter = box(0.38, 0.95, 0.05).translate(side * 0.19, 0, 0);
      shutter.rotateY(side * -0.9).translate(side * 0.45, 0, 0.02);
      body.push(onFace(paint(shutter, C.shutter, Mat.Wood), k, upAp + 0.04, 6.55));
    }
    body.push(onFace(paint(box(0.85, 0.18, 0.25), C.timberDark, Mat.Wood), k, upAp + 0.14, 6.05));
    for (let f = 0; f < 6; f++) {
      const bloom = new THREE.IcosahedronGeometry(0.075, 0).translate(-0.33 + f * 0.13, 0, (f % 2) * 0.06);
      body.push(onFace(paint(bloom, C.flowers[f % 4]), k, upAp + 0.14, 6.2));
    }
  }

  body.push(...roof(3.5, 2.3, 8.1));

  // Lantern room on top, with its own roof, spire and crystal.
  body.push(paint(at(oct(0.95, 1.05, 1.3), 0, 10.5, 0), C.plaster, Mat.Plaster));
  for (let k = 0; k < 8; k++) {
    const a = cornerAngle(k);
    body.push(paint(at(box(0.1, 1.3, 0.1), Math.sin(a) * 0.98, 10.5, Math.cos(a) * 0.98, a), C.timber, Mat.Wood));
  }
  for (const k of [0, 2, 4, 6]) glow.push(onFace(paint(new THREE.PlaneGeometry(0.42, 0.65), GLOW.window), k, apothem(1.0) + 0.02, 10.55));
  body.push(...roof(1.65, 1.7, 11.15));
  body.push(paint(at(new THREE.CylinderGeometry(0.02, 0.1, 1.3, 6), 0, 13.4, 0), C.gold, Mat.Metal));
  return { body, glow };
}

function stall(): Parts {
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  // Round posts on stone footings; the back pair is taller so the awning slopes forward.
  for (const [x, z, h] of [[-1.35, 0.7, 2.25], [1.35, 0.7, 2.25], [-1.35, -0.75, 2.65], [1.35, -0.75, 2.65]]) {
    body.push(paint(at(new THREE.CylinderGeometry(0.07, 0.08, h, 8), x, h / 2, z), C.timberDark, Mat.Wood, C.timber));
    body.push(paint(at(box(0.24, 0.16, 0.24), x, 0.06, z), C.stone, Mat.Stone));
  }
  // Counter: planked front, top board.
  for (let i = 0; i < 9; i++) {
    body.push(paint(at(box(0.3, 0.85, 0.06), -1.2 + i * 0.3, 0.42, 0.85), i % 2 ? C.timber : C.crate, Mat.Wood));
  }
  body.push(paint(at(box(2.75, 0.85, 0.7), 0, 0.42, 0.48), C.timberDark, Mat.Wood));
  body.push(paint(at(box(2.95, 0.08, 0.95), 0, 0.88, 0.48), C.timber, Mat.Wood));

  // Striped cloth awning that sags between the posts, with a scalloped front edge.
  const stripes = 8;
  const width = 3.1;
  for (let i = 0; i < stripes; i++) {
    const w = width / stripes;
    const g = new THREE.PlaneGeometry(w, 1.85, 2, 6);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v) + (-width / 2 + w * (i + 0.5));
      const z = pos.getZ(v);
      const sag = Math.sin(((x + width / 2) / width) * Math.PI) * 0.12 + Math.sin(((z + 0.92) / 1.85) * Math.PI) * 0.06;
      pos.setXYZ(v, x, 2.45 - z * 0.22 - sag, z);
    }
    g.computeVertexNormals();
    body.push(twoSided(paint(g, i % 2 ? C.stripeB : C.stripeA)));
  }
  for (let i = 0; i < stripes; i++) {
    const w = width / stripes;
    const flap = new THREE.CircleGeometry(w / 2, 10, Math.PI, Math.PI);
    flap.translate(-width / 2 + w * (i + 0.5), 0, 0);
    body.push(twoSided(paint(flap, i % 2 ? C.stripeA : C.stripeB)).translate(0, 2.27, 0.93));
  }

  // Goods: fruit baskets, a balance scale, jars.
  for (let b = 0; b < 3; b++) {
    const bx = -1.0 + b * 0.75;
    body.push(paint(at(new THREE.CylinderGeometry(0.24, 0.18, 0.16, 12, 1, true), bx, 1.0, 0.5), C.basket, Mat.Wood));
    body.push(paint(at(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 12), bx, 0.93, 0.5), C.basket, Mat.Wood));
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2;
      body.push(paint(at(new THREE.IcosahedronGeometry(0.09, 1), bx + Math.cos(a) * 0.1, 1.08 + (f % 2) * 0.05, 0.5 + Math.sin(a) * 0.1), C.fruit[(b + f) % 4]));
    }
  }
  // Balance scale.
  const sx = 1.15;
  body.push(paint(at(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), sx, 1.17, 0.45), C.gold, Mat.Metal));
  body.push(paint(at(box(0.5, 0.025, 0.025), sx, 1.4, 0.45), C.gold, Mat.Metal));
  for (const side of [-1, 1]) {
    body.push(paint(at(new THREE.CylinderGeometry(0.1, 0.07, 0.03, 10), sx + side * 0.24, 1.22 + side * 0.02, 0.45), C.gold, Mat.Metal));
    body.push(paint(at(box(0.008, 0.17, 0.008), sx + side * 0.24, 1.31 + side * 0.01, 0.45), C.iron, Mat.Metal));
  }
  // Hanging sign with a gold coin emblem, and a lamp under the awning.
  body.push(paint(at(box(0.04, 0.35, 0.04), -0.3, 2.05, 0.95), C.iron, Mat.Metal));
  body.push(paint(at(box(0.04, 0.35, 0.04), 0.3, 2.05, 0.95), C.iron, Mat.Metal));
  body.push(paint(at(box(0.85, 0.45, 0.06), 0, 1.72, 0.97), C.timber, Mat.Wood));
  body.push(paint(at(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16).rotateX(Math.PI / 2), 0, 1.72, 1.01), C.gold, Mat.Metal));
  const lamp = hangingLamp(0.9);
  lamp.body.forEach((g) => body.push(at(g, 1.05, 2.18, 0.55)));
  lamp.glow.forEach((g) => glow.push(at(g, 1.05, 2.18, 0.55)));

  // Crates, a banded barrel and sacks.
  body.push(paint(at(box(0.6, 0.6, 0.6), 1.9, 0.3, 0.35, 0.3), C.crate, Mat.Wood));
  body.push(paint(at(box(0.48, 0.48, 0.48), 1.85, 0.84, 0.3, 0.8), C.crate, Mat.Wood));
  body.push(paint(at(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), -1.95, 0.4, 0.25), C.timber, Mat.Wood));
  body.push(paint(at(new THREE.SphereGeometry(0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.15, 1), -1.95, 0.8, 0.25), C.timber, Mat.Wood));
  for (const y of [0.15, 0.65]) body.push(paint(at(new THREE.TorusGeometry(0.32, 0.025, 4, 16).rotateX(Math.PI / 2), -1.95, y, 0.25), C.iron, Mat.Metal));
  body.push(paint(at(new THREE.SphereGeometry(0.3, 8, 6).scale(1, 1.2, 1), -1.75, 0.33, 0.95), C.sack));
  body.push(paint(at(new THREE.SphereGeometry(0.26, 8, 6).scale(1, 1.2, 1), -1.35, 0.29, 1.12), C.sack));
  return { body, glow };
}

/** A stepped stone footing with a bevelled top: used under posts so they sit into the ground. */
function footing(size: number): THREE.BufferGeometry[] {
  return [
    paint(at(oct(size * 0.62, size * 0.7, 0.12), 0, 0.02, 0), C.stoneDark, Mat.Stone, C.stoneDark),
    paint(at(oct(size * 0.46, size * 0.56, 0.2), 0, 0.18, 0), C.stoneDark, Mat.Stone, C.stone),
    paint(at(oct(size * 0.3, size * 0.46, 0.07), 0, 0.315, 0), C.stone, Mat.Stone),
  ];
}

function lantern(): Parts {
  const body: THREE.BufferGeometry[] = [...footing(0.5)];
  const glow: THREE.BufferGeometry[] = [];
  body.push(paint(at(oct(0.06, 0.08, 1.95), 0, 1.3, 0), C.timberDark, Mat.Wood, C.timber));
  // Iron collar near the base, a carved knuckle mid-way, and a capital under the finial.
  body.push(paint(at(oct(0.1, 0.1, 0.09), 0, 0.42, 0), C.iron, Mat.Metal));
  body.push(paint(at(oct(0.095, 0.095, 0.03), 0, 0.48, 0), C.gold, Mat.Metal));
  body.push(paint(at(new THREE.SphereGeometry(0.085, 8, 6).scale(1, 0.7, 1), 0, 1.25, 0), C.timberDark, Mat.Wood));
  body.push(paint(at(oct(0.11, 0.075, 0.1), 0, 2.28, 0), C.iron, Mat.Metal));
  body.push(paint(at(oct(0.06, 0.1, 0.06), 0, 2.36, 0), C.iron, Mat.Metal));
  body.push(paint(at(new THREE.ConeGeometry(0.05, 0.16, 8), 0, 2.47, 0), C.gold, Mat.Metal)); // finial
  // Curved iron arm reaching toward the path, with a scroll brace beneath it.
  const arm = new THREE.TorusGeometry(0.3, 0.024, 6, 12, Math.PI / 2);
  arm.rotateY(-Math.PI / 2);
  body.push(paint(at(arm, 0, 1.85, 0.3), C.iron, Mat.Metal));
  const brace = new THREE.TorusGeometry(0.14, 0.016, 5, 12, Math.PI * 1.3);
  brace.rotateZ(-0.4).rotateY(-Math.PI / 2);
  body.push(paint(at(brace, 0, 1.92, 0.16), C.iron, Mat.Metal));
  body.push(paint(at(new THREE.IcosahedronGeometry(0.03, 1), 0, 2.15, 0.6), C.gold, Mat.Metal));
  body.push(paint(at(box(0.02, 0.06, 0.02), 0, 2.1, 0.6), C.iron, Mat.Metal));
  const lamp = hangingLamp(1);
  lamp.body.forEach((g) => body.push(at(g, 0, 2.06, 0.6)));
  lamp.glow.forEach((g) => glow.push(at(g, 0, 2.06, 0.6)));
  return { body, glow };
}

function arrowBoard(len: number) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.11);
  s.lineTo(len - 0.18, -0.11);
  s.lineTo(len, 0);
  s.lineTo(len - 0.18, 0.11);
  s.lineTo(0, 0.11);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.025);
}

function signpost(): Parts {
  const body: THREE.BufferGeometry[] = [...footing(0.55)];
  body.push(paint(at(oct(0.065, 0.085, 1.85), 0, 1.25, 0), C.timberDark, Mat.Wood, C.timber));
  body.push(paint(at(oct(0.1, 0.1, 0.08), 0, 0.42, 0), C.iron, Mat.Metal));
  // A little pitched cap keeps the rain off the post.
  body.push(paint(at(new THREE.ConeGeometry(0.15, 0.2, 4).rotateY(Math.PI / 4), 0, 2.27, 0), C.roof, Mat.Tile, C.roofLight));
  body.push(paint(at(new THREE.IcosahedronGeometry(0.035, 1), 0, 2.39, 0), C.gold, Mat.Metal));
  for (const [y, ang, len] of [[1.9, 0.9, 1.0], [1.6, -1.4, 0.9], [1.3, 2.4, 0.75]]) {
    body.push(paint(at(arrowBoard(len).translate(0.06, 0, 0), 0, y, 0, ang), C.crate, Mat.Wood));
  }
  // A few stones at the foot.
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    body.push(paint(at(new THREE.IcosahedronGeometry(0.1 + (i % 2) * 0.05, 0).scale(1, 0.6, 1), Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22), C.stoneDark, Mat.Stone));
  }
  return { body, glow: [] };
}

const BUILDERS: Record<Structure['kind'], () => Parts> = { tower, stall, lantern, signpost };

const SURFACE_VERTEX_PARS = /* glsl */ `
attribute float aMat;
varying float vMat;
varying vec3 vSurfPos;
varying vec3 vSurfNormal;
varying vec3 vSurfOrigin;
`;
const SURFACE_VERTEX = /* glsl */ `
vMat = aMat;
vSurfOrigin = modelMatrix[3].xyz;
vSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSurfNormal = normalize(mat3(modelMatrix) * objectNormal);
`;
const SURFACE_FRAGMENT_PARS = /* glsl */ `
varying float vMat;
varying vec3 vSurfPos;
varying vec3 vSurfNormal;
varying vec3 vSurfOrigin;
float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;
/** Surface detail by type. Horizontal coordinate follows whichever axis the face runs along. */
const SURFACE_FRAGMENT = /* glsl */ `
{
  vec3 sp = vSurfPos;
  vec3 sn = normalize(vSurfNormal);
  float u = abs(sn.x) > abs(sn.z) ? sp.z : sp.x;
  float m = vMat;
  float k = 1.0;
  if (m > 0.5 && m < 1.5) {
    // Stone blocks: staggered courses with soft mortar joints.
    float hgt = 0.42;
    float row = floor(sp.y / hgt);
    float bu = u / 0.75 + 0.5 * mod(row, 2.0);
    if (sn.y > 0.7) { row = floor(sp.z / 0.6); bu = sp.x / 0.6 + 0.5 * mod(row, 2.0); }
    vec2 f = vec2(fract(bu), sn.y > 0.7 ? fract(sp.z / 0.6) : fract(sp.y / hgt));
    float joint = smoothstep(0.0, 0.07, f.x) * smoothstep(1.0, 0.93, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
    k = mix(0.7, 1.0, joint) * (0.88 + 0.2 * bHash(vec2(floor(bu), row)));
  } else if (m > 1.5 && m < 2.5) {
    // Plaster: gentle mottling.
    k = 0.94 + 0.08 * bHash(floor(vec2(u, sp.y) * 3.0));
  } else if (m > 2.5 && m < 3.5) {
    // Wood: planks and grain.
    float along = abs(sn.y) > 0.7 ? sp.x : u;
    float grain = sin(along * 31.0 + sin(sp.y * 7.0 + along * 3.0) * 2.0);
    float plank = fract(sp.y / 0.16);
    k = (0.9 + 0.07 * grain) * mix(0.82, 1.0, smoothstep(0.0, 0.12, plank));
  } else if (m > 3.5 && m < 4.5) {
    // Roof tiles: rows of scallops, each tile slightly different.
    float rowH = 0.24;
    float row = floor(sp.y / rowH);
    float ang = atan(sp.x - vSurfOrigin.x, sp.z - vSurfOrigin.z);
    float r = length(sp.xz - vSurfOrigin.xz);
    float tu = ang * r / 0.3 + 0.5 * mod(row, 2.0);
    float fy = fract(sp.y / rowH);
    float curve = abs(fract(tu) - 0.5) * 2.0;
    float edge = smoothstep(0.0, 0.18, fy - curve * curve * 0.45);
    k = mix(0.68, 1.06, edge) * (0.92 + 0.14 * bHash(vec2(floor(tu), row)));
  } else if (m > 4.5) {
    // Metal: a little sheen on upward faces.
    k = 1.0 + 0.25 * smoothstep(0.3, 1.0, sn.y);
  }
  diffuseColor.rgb *= k;
}
`;

export function createBuildings(atmosphere: Atmosphere) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const uniforms = { uPlayerPos: { value: new THREE.Vector3() } };
  const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  bodyMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SURFACE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE_FRAGMENT}`);
  };
  bodyMaterial.customProgramCacheKey = () => 'bq-building';
  // Glowing parts: unlit colours above 1.0, so the bloom picks them up.
  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  addFade(bodyMaterial, uniforms);
  addFade(glowMaterial, uniforms);

  const geos: THREE.BufferGeometry[] = [];
  const spinners: { mesh: THREE.Object3D; baseY: number; speed: number; tilt: number }[] = [];
  for (const s of STRUCTURES) {
    const { body, glow } = BUILDERS[s.kind]();
    const y = heightAt(s.x, s.z) - (s.kind === 'tower' ? 0.25 : 0.05);
    // Each structure's mesh sits at its own origin so the roof-tile pattern can find its centre.
    const b = mergeGeometries(body)!.rotateY(s.rot);
    const bodyMesh = new THREE.Mesh(b, bodyMaterial);
    bodyMesh.position.set(s.x, y, s.z);
    group.add(bodyMesh);
    geos.push(b);
    if (glow.length) {
      const gl = mergeGeometries(glow)!.rotateY(s.rot);
      const m = new THREE.Mesh(gl, glowMaterial);
      m.position.set(s.x, y, s.z);
      m.name = 'glow';
      group.add(m);
      geos.push(gl);
    }
    if (s.kind === 'tower') {
      const cg = paint(new THREE.OctahedronGeometry(0.42), GLOW.crystal).scale(1, 1.6, 1);
      const crystal = new THREE.Mesh(cg, glowMaterial);
      crystal.position.set(s.x, y + 14.55, s.z);
      crystal.name = 'glow';
      group.add(crystal);
      spinners.push({ mesh: crystal, baseY: crystal.position.y, speed: 0.6, tilt: 0 });
      // A gold ring circling the crystal on a tilted axis.
      const rg = paint(new THREE.TorusGeometry(0.75, 0.035, 6, 32), C.gold, Mat.Metal);
      const ring = new THREE.Mesh(rg, bodyMaterial);
      ring.position.copy(crystal.position);
      group.add(ring);
      spinners.push({ mesh: ring, baseY: ring.position.y, speed: -0.9, tilt: 1.15 });
      geos.push(cg, rg);
    }
  }

  atmosphere.adopt(group, { cast: true, receive: true });
  group.children.forEach((m) => {
    if (m.name === 'glow') m.castShadow = false;
  });

  return {
    group,
    update(time: number, player: THREE.Vector3) {
      uniforms.uPlayerPos.value.copy(player);
      for (const s of spinners) {
        s.mesh.position.y = s.baseY + Math.sin(time * 1.1) * 0.18;
        if (s.tilt) s.mesh.rotation.set(s.tilt, time * s.speed, 0.3 * Math.sin(time * 0.7));
        else s.mesh.rotation.y = time * s.speed;
      }
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      bodyMaterial.dispose();
      glowMaterial.dispose();
    },
  };
}
