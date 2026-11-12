import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Atmosphere } from '../sky/Atmosphere';
import type { Look } from './looks';

/**
 * Code-built anime-style characters.
 *
 * A small skeleton of pivots (hips, torso, head, arms, legs, cape). Each pivot
 * owns one merged, vertex-coloured mesh, drawn with a shared cel-shading
 * material (three light bands plus a rim of sunlight), and an ink outline
 * (the same geometry pushed out along its normals and drawn back-faces only).
 * Animation is procedural: walk cycle driven by distance travelled, breathing
 * when idle, a cape that lifts with speed. Units are metres; the model faces +z.
 */

type Part = { geo: THREE.BufferGeometry; color: string; outline?: boolean };

function colored(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
const sphere = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const t = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** Shared materials (one set for every character). */
interface Materials {
  body: THREE.MeshToonMaterial;
  cloth: THREE.MeshToonMaterial;
  outline: THREE.MeshBasicMaterial;
  rim: { value: THREE.Color };
}

let shared: Materials | null = null;

/** Call once per frame: the rim of light on characters follows the sun. */
export function updateCharacterLighting(atmosphere: Atmosphere) {
  if (shared) shared.rim.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.12);
}

function gradient() {
  // Three bands: shadow, mid, lit. Nearest filtering keeps the edges crisp.
  const data = new Uint8Array([100, 100, 100, 255, 170, 170, 170, 255, 225, 225, 225, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function materials(atmosphere: Atmosphere): Materials {
  if (shared) return shared;
  const rim = { value: new THREE.Color() };
  const gradientMap = gradient();
  const toon = (side: THREE.Side) => {
    const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = rim;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            float rimBand = smoothstep(0.55, 0.75, 1.0 - facing);
            totalEmissiveRadiance += uRim * rimBand * diffuseColor.rgb;
          }`,
        );
    };
    m.customProgramCacheKey = () => 'bq-toon-' + side;
    return m;
  };
  const body = toon(THREE.FrontSide);
  const cloth = toon(THREE.DoubleSide);
  const outline = new THREE.MeshBasicMaterial({ color: '#2a1c26', side: THREE.BackSide });
  outline.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = position + normal * 0.013;',
    );
  };
  outline.customProgramCacheKey = () => 'bq-outline';
  for (const m of [body, cloth, outline]) atmosphere.patchMaterial(m);
  shared = { body, cloth, outline, rim };
  return shared;
}

/** Builds the meshes for one pivot: the coloured body and, if any parts ask for it, an outline. */
function bone(pivot: THREE.Object3D, parts: Part[], m: Materials, mat: 'body' | 'cloth' = 'body') {
  if (!parts.length) return;
  const geo = mergeGeometries(parts.map((p) => colored(p.geo, p.color)))!;
  const mesh = new THREE.Mesh(geo, m[mat]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  const outlined = parts.filter((p) => p.outline !== false);
  if (outlined.length && mat === 'body') {
    // Outline geometry needs smooth (shared) normals so the shell doesn't crack at seams.
    const og = mergeGeometries(outlined.map((p) => {
      const g = p.geo.clone();
      g.deleteAttribute('uv');
      return g.index ? g : g;
    }))!;
    const o = new THREE.Mesh(og, m.outline);
    pivot.add(o);
  }
}

export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Object3D();
  private torso = new THREE.Object3D();
  private head = new THREE.Object3D();
  private arms: { upper: THREE.Object3D; fore: THREE.Object3D }[] = [];
  private legs: { thigh: THREE.Object3D; shin: THREE.Object3D }[] = [];
  private cape: THREE.Object3D | null = null;
  private phase = 0;
  private lastPos = new THREE.Vector3();
  private seed: number;
  /** Extra head turn toward something (radians), eased. */
  private lookYaw = 0;
  lookTarget = 0;

  static readonly HIP_HEIGHT = 0.74;

  constructor(look: Look, atmosphere: Atmosphere, seed = 0) {
    this.seed = seed;
    const m = materials(atmosphere);
    const w = look.build ?? 1;
    this.root.name = 'character';
    this.root.add(this.hips);
    this.hips.position.y = Character.HIP_HEIGHT;
    this.hips.add(this.torso);

    // --- Hips: belt and tunic hem (or a long robe). ---
    const hipParts: Part[] = [
      { geo: t(new THREE.CylinderGeometry(0.15 * w, 0.15 * w, 0.06, 14), 0, 0.04, 0), color: look.accent },
    ];
    if (look.robe) {
      hipParts.push({ geo: t(new THREE.CylinderGeometry(0.15 * w, 0.27, 0.7, 16, 1, true), 0, -0.32, 0), color: look.top });
      hipParts.push({ geo: t(new THREE.CylinderGeometry(0.272, 0.28, 0.07, 16, 1, true), 0, -0.64, 0), color: look.accent });
    } else {
      hipParts.push({ geo: t(new THREE.CylinderGeometry(0.15 * w, 0.2 * w, 0.24, 14, 1, true), 0, -0.1, 0), color: look.top });
    }
    bone(this.hips, hipParts, m);

    // --- Legs. ---
    for (const side of [-1, 1]) {
      const thigh = new THREE.Object3D();
      thigh.position.set(side * 0.085, -0.02, 0);
      this.hips.add(thigh);
      const shin = new THREE.Object3D();
      shin.position.y = -0.36;
      thigh.add(shin);
      bone(thigh, [{ geo: t(capsule(0.068, 0.24), 0, -0.18, 0), color: look.legs }], m);
      bone(shin, [
        { geo: t(capsule(0.06, 0.2), 0, -0.15, 0), color: look.legs },
        { geo: t(new THREE.CylinderGeometry(0.072, 0.066, 0.2, 10), 0, -0.24, 0), color: look.boots },
        { geo: t(sphere(0.07, 10, 8).scale(1, 0.62, 1.55), 0, -0.34, 0.035), color: look.boots },
      ], m);
      this.legs.push({ thigh, shin });
    }

    // --- Torso. ---
    const torsoParts: Part[] = [
      { geo: t(capsule(0.15, 0.18).scale(w, 1, 0.76), 0, 0.24, 0), color: look.top },
      { geo: t(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), 0, 0.5, 0), color: look.skin },
    ];
    // Vest/apron panel and a sash, in the accent colour.
    torsoParts.push({ geo: t(new THREE.BoxGeometry(0.2 * w, 0.26, 0.04), 0, 0.22, 0.11), color: look.accent });
    torsoParts.push({ geo: t(new THREE.TorusGeometry(0.16 * w, 0.022, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.78), 0, 0.42, 0), color: look.accent, outline: false });
    bone(this.torso, torsoParts, m);

    // --- Arms. ---
    for (const side of [-1, 1]) {
      const upper = new THREE.Object3D();
      upper.position.set(side * (0.19 * w + 0.01), 0.43, 0);
      this.torso.add(upper);
      const fore = new THREE.Object3D();
      fore.position.y = -0.24;
      upper.add(fore);
      bone(upper, [
        { geo: t(sphere(0.062, 12, 8), 0, 0, 0), color: look.top },
        { geo: t(capsule(0.05, 0.16), 0, -0.12, 0), color: look.top },
      ], m);
      bone(fore, [
        { geo: t(capsule(0.044, 0.14), 0, -0.1, 0), color: look.robe ? look.top : look.skin },
        { geo: t(new THREE.CylinderGeometry(0.052, 0.05, 0.05, 10), 0, -0.03, 0), color: look.accent, outline: false },
        { geo: t(sphere(0.05, 10, 8), 0, -0.23, 0), color: look.skin },
      ], m);
      this.arms.push({ upper, fore });
    }

    // --- Head. ---
    this.head.position.y = 0.53;
    this.torso.add(this.head);
    const R = 0.175;
    const headParts: Part[] = [{ geo: t(sphere(R, 20, 16).scale(1, 0.97, 0.95), 0, R, 0), color: look.skin }];
    // Hair: a cap over the top and back, a fringe of bangs, and a style-specific back piece.
    headParts.push({
      geo: t(new THREE.SphereGeometry(R * 1.08, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56).rotateX(-0.32), 0, R + 0.01, -0.01),
      color: look.hair,
    });
    for (let i = 0; i < 5; i++) {
      const a = -0.7 + i * 0.35;
      const bang = new THREE.ConeGeometry(0.05, 0.13, 6);
      bang.rotateX(Math.PI).rotateZ(a * 0.4);
      headParts.push({ geo: t(bang, Math.sin(a) * R * 0.85, R + 0.1, Math.cos(a) * R * 0.78), color: look.hair });
    }
    for (const side of [-1, 1]) {
      // Side locks framing the face.
      const lock = new THREE.ConeGeometry(0.045, 0.22, 6).rotateX(Math.PI).rotateZ(side * -0.12);
      headParts.push({ geo: t(lock, side * R * 0.93, R - 0.02, 0.04), color: look.hair });
    }
    if (look.hairStyle === 'bun') {
      headParts.push({ geo: t(sphere(0.085, 12, 10), 0, R * 1.85, -0.07), color: look.hair });
    } else if (look.hairStyle === 'long') {
      headParts.push({ geo: t(capsule(0.13, 0.28).scale(1.25, 1, 0.6), 0, R - 0.1, -0.1), color: look.hair });
    } else {
      // Short: a few spiky tufts at the back.
      for (let i = 0; i < 3; i++) {
        const tuft = new THREE.ConeGeometry(0.06, 0.16, 6).rotateX(-2.2 + i * 0.25).rotateZ((i - 1) * 0.5);
        headParts.push({ geo: t(tuft, (i - 1) * 0.07, R + 0.02 - i * 0.03, -R * 0.95), color: look.hair });
      }
    }
    if (look.hat) {
      headParts.push({ geo: t(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 20), 0, R * 1.62, 0), color: look.hat });
      const crown = new THREE.ConeGeometry(0.17, 0.42, 14);
      crown.translate(0, 0.21, 0).rotateX(-0.25);
      headParts.push({ geo: t(crown, 0, R * 1.62, -0.02), color: look.hat });
      headParts.push({ geo: t(new THREE.CylinderGeometry(0.175, 0.175, 0.05, 14, 1, true), 0, R * 1.68, 0), color: look.accent, outline: false });
    }
    // Face: big anime eyes with highlights, small mouth, blush. No outline on these.
    for (const side of [-1, 1]) {
      const ex = side * 0.068;
      const ey = R - 0.015;
      const ez = 0.148;
      headParts.push({ geo: t(sphere(0.034, 12, 10).scale(0.82, 1.3, 0.35), ex, ey, ez), color: '#fffaf4', outline: false });
      headParts.push({ geo: t(sphere(0.026, 12, 10).scale(0.85, 1.25, 0.35), ex, ey - 0.004, ez + 0.006), color: look.eyes, outline: false });
      headParts.push({ geo: t(sphere(0.014, 8, 6).scale(1, 1.2, 0.35), ex, ey - 0.006, ez + 0.01), color: '#1e1420', outline: false });
      headParts.push({ geo: t(sphere(0.008, 6, 6).scale(1, 1, 0.4), ex + side * -0.008 + 0.004, ey + 0.014, ez + 0.014), color: '#ffffff', outline: false });
      // Brow.
      headParts.push({ geo: t(new THREE.BoxGeometry(0.045, 0.008, 0.01).rotateZ(side * -0.15), ex, ey + 0.058, ez - 0.004), color: look.hair, outline: false });
      // Blush.
      headParts.push({ geo: t(sphere(0.022, 8, 6).scale(1.4, 0.6, 0.25), side * 0.1, R - 0.07, 0.135), color: '#ff9c9c', outline: false });
    }
    headParts.push({ geo: t(sphere(0.012, 8, 6).scale(1.5, 0.6, 0.4), 0, R - 0.085, 0.163), color: '#a8454a', outline: false });
    bone(this.head, headParts, m);

    // --- Cape: a curved sheet hanging from the shoulders. ---
    if (look.cape) {
      this.cape = new THREE.Object3D();
      this.cape.position.set(0, 0.45, -0.1);
      this.torso.add(this.cape);
      const g = new THREE.PlaneGeometry(0.38 * w, 0.62, 4, 6);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i) - 0.31;
        const flare = 1 + (-y / 0.62) * 0.35; // wider at the bottom
        pos.setXYZ(i, x * flare, y, -Math.pow(x / 0.25, 2) * 0.05 - 0.01);
      }
      bone(this.cape, [{ geo: g, color: look.cape }], m, 'cloth');
      bone(this.torso, [{ geo: t(new THREE.CylinderGeometry(0.17 * w, 0.19 * w, 0.06, 14, 1, true), 0, 0.46, -0.01), color: look.cape }], m);
    }

    // Soft contact shadow, so characters sit on the ground on every quality tier.
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), blobMaterial());
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    this.root.add(blob);
  }

  /**
   * Advance the animation. `speed` is ground speed in m/s (from the simulation).
   */
  update(dt: number, time: number, speed: number) {
    const pos = this.root.position;
    const moved = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z);
    this.lastPos.copy(pos);
    // One full stride cycle per ~1.25 m travelled.
    this.phase += Math.min(moved, 0.5) * ((Math.PI * 2) / 1.25);
    const w = THREE.MathUtils.clamp(speed / 4.5, 0, 1);
    const idle = 1 - w;
    const ph = this.phase;
    const breathe = Math.sin(time * 2.1 + this.seed) * idle;

    this.hips.position.y = Character.HIP_HEIGHT + Math.abs(Math.cos(ph)) * 0.045 * w - 0.025 * w + breathe * 0.004;
    this.hips.rotation.y = Math.sin(ph) * 0.1 * w;
    this.torso.rotation.y = -Math.sin(ph) * 0.18 * w;
    this.torso.rotation.x = 0.13 * w + breathe * 0.012;
    this.torso.rotation.z = Math.cos(ph) * 0.035 * w;

    this.legs.forEach((l, i) => {
      const p = ph + i * Math.PI;
      l.thigh.rotation.x = -Math.sin(p) * 0.62 * w;
      l.shin.rotation.x = w * (0.12 + 0.95 * Math.max(0, Math.cos(p)));
    });
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const p = ph + i * Math.PI;
      a.upper.rotation.x = Math.sin(p) * 0.55 * w + Math.sin(time * 1.3 + this.seed + i) * 0.03 * idle;
      a.upper.rotation.z = side * (0.1 + 0.04 * w + breathe * 0.02);
      a.fore.rotation.x = -0.25 - 0.45 * w - Math.max(0, Math.sin(p)) * 0.3 * w;
    });

    // Head: counter-rotates the torso twist, looks toward its target, with a little idle drift.
    this.lookYaw += (this.lookTarget - this.lookYaw) * Math.min(1, dt * 4);
    this.head.rotation.y = this.lookYaw - this.torso.rotation.y * 0.8 + Math.sin(time * 0.45 + this.seed * 3) * 0.12 * idle;
    this.head.rotation.x = -0.06 * w + Math.sin(time * 0.6 + this.seed) * 0.03 * idle;

    if (this.cape) {
      const flutter = Math.sin(time * 9 + this.seed) * 0.05 * w + Math.sin(time * 1.7 + this.seed) * 0.03;
      this.cape.rotation.x = 0.12 + 0.75 * w + flutter;
    }
  }
}

let blobMat: THREE.MeshBasicMaterial | null = null;
function blobMaterial() {
  if (blobMat) return blobMat;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = Math.max(0, 1 - d) ** 1.6;
      data.set([20, 30, 25, Math.round(a * 140)], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return blobMat;
}
