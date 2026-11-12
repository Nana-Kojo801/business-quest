import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Atmosphere } from '../sky/Atmosphere';
import { FACE_PHI_LEN, FACE_THETA_LEN, FACE_THETA_TOP, createFaceTexture } from './face';
import type { Look } from './looks';

/**
 * Code-built anime-style characters.
 *
 * Shape: smooth lathe profiles for the body and limbs, clothing with folds,
 * hair built from tapered curving strands with a glossy highlight band, and a
 * hand-drawn face painted onto the head (with blinking).
 *
 * Skeleton: hips > torso > head / arms / cape; hips > legs > shins > feet; plus
 * spring-driven secondary pivots (back hair, cowlick, two-part cape).
 *
 * Shading: soft cel ramp, sunlit rim, thin ink outlines (inverted hull).
 * Motion: procedural, with eased speed, weight shift, counter-rotation, arm lag,
 * leaning into turns and acceleration, and springs that overshoot and settle.
 * Units are metres; the model faces +z.
 */

type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => number;
type Part = { geo: THREE.BufferGeometry; color: string; outline?: boolean; shade?: ColorFn };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const v2 = (r: number, y: number) => new THREE.Vector2(r, y);
const tr = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** Copy a geometry with a baked vertex colour (optionally shaded per vertex). Keeps smooth normals. */
function colored(geo: THREE.BufferGeometry, color: string, shade?: ColorFn): THREE.BufferGeometry {
  const g = geo.clone();
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const base = new THREE.Color(color);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const k = shade ? shade(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i)) : 1;
    col.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A smooth body part from a side profile (radius, y) rotated around the vertical axis. */
function lathe(profile: [number, number][], segs = 14, zScale = 1, phiStart = 0, phiLen = Math.PI * 2) {
  // Lathe faces point outward only when the profile runs bottom to top.
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), segs, phiStart, phiLen);
  if (zScale !== 1) g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}

/** Ripple a garment's lower edge outward in folds. */
function folds(g: THREE.BufferGeometry, count: number, depth: number, top: number, bottom: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((top - y) / (top - bottom), 0, 1);
    const a = Math.atan2(x, z);
    const k = 1 + depth * t * t * Math.sin(a * count);
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A tapered, curving strand (hair lock, bang, cowlick). Radius goes from r0 at
 * the root to r1 at the tip; `flat` squashes it into a ribbon.
 */
function strand(points: THREE.Vector3[], r0: number, r1: number, flat = 0.6, seg = 8, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = tube.attributes.position as THREE.BufferAttribute;
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.9));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nrm = frames.normals[i];
      const bin = frames.binormals[i];
      const px = c.x + r * (Math.cos(a) * nrm.x + Math.sin(a) * bin.x * flat);
      const py = c.y + r * (Math.cos(a) * nrm.y + Math.sin(a) * bin.y * flat);
      const pz = c.z + r * (Math.cos(a) * nrm.z + Math.sin(a) * bin.z * flat);
      pos.setXYZ(i * (radial + 1) + j, px, py, pz);
    }
  }
  tube.computeVertexNormals();
  return tube;
}

/** Shapes a sphere into an anime head: full cheeks, a narrower, slightly forward chin. */
function headShape(g: THREE.BufferGeometry, R: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const down = Math.max(0, -y / R); // 0 at the equator, 1 at the bottom
    const front = Math.max(0, z / R);
    x *= 1 - 0.28 * down * down;
    z *= 1 - 0.12 * down * (1 - front);
    z += 0.035 * R * down * front;
    y *= 1 + 0.08 * down;
    pos.setXYZ(i, x * 1.0, y * 0.98, z * 0.95);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Materials (shared by all characters, except faces).

interface Materials {
  body: THREE.MeshToonMaterial;
  cloth: THREE.MeshToonMaterial;
  outline: THREE.MeshBasicMaterial;
  rim: { value: THREE.Color };
  gradientMap: THREE.DataTexture;
}
let shared: Materials | null = null;

/** Call once per frame: the rim of light on characters follows the sun. */
export function updateCharacterLighting(atmosphere: Atmosphere) {
  if (shared) shared.rim.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.13);
}

function rampTexture() {
  // A soft two-tone ramp: shadow to lit with a narrow blended edge, then a gentle top band.
  const n = 32;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const lit = THREE.MathUtils.smoothstep(x, 0.36, 0.46);
    const top = THREE.MathUtils.smoothstep(x, 0.8, 0.9);
    const v = Math.round(255 * (0.45 + 0.4 * lit + 0.05 * top));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function addRim(m: THREE.MeshToonMaterial, rim: { value: THREE.Color }, key: string) {
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.uniforms.uRim = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim * smoothstep(0.5, 0.72, 1.0 - facing) * diffuseColor.rgb;
        }`,
      );
  };
  m.customProgramCacheKey = () => key;
}

function materials(atmosphere: Atmosphere): Materials {
  if (shared) return shared;
  const rim = { value: new THREE.Color() };
  const gradientMap = rampTexture();
  const body = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const cloth = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide });
  addRim(body, rim, 'bq-toon');
  addRim(cloth, rim, 'bq-toon-cloth');
  const outline = new THREE.MeshBasicMaterial({ color: '#33212c', side: THREE.BackSide });
  outline.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.0075;');
  };
  outline.customProgramCacheKey = () => 'bq-outline';
  for (const m of [body, cloth, outline]) atmosphere.patchMaterial(m);
  shared = { body, cloth, outline, rim, gradientMap };
  return shared;
}

/**
 * Parts are collected per bone while a character is built, then merged into a few
 * skinned meshes (body, cloth, outline) sharing one skeleton: about 5 draw calls
 * per character instead of one per part.
 */
type Collected = { pivot: THREE.Object3D; parts: Part[]; mat: 'body' | 'cloth' };
let collecting: Collected[] | null = null;

function bone(pivot: THREE.Object3D, parts: Part[], _m: Materials, mat: 'body' | 'cloth' = 'body') {
  if (parts.length) collecting?.push({ pivot, parts, mat });
}

function skin(g: THREE.BufferGeometry, boneIndex: number) {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const wgt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    wgt[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
  return g;
}

function finalize(root: THREE.Object3D, items: Collected[], m: Materials) {
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const lists: Record<'body' | 'cloth' | 'outline', THREE.BufferGeometry[]> = { body: [], cloth: [], outline: [] };
  for (const it of items) {
    const bi = bones.indexOf(it.pivot as THREE.Bone);
    const mw = it.pivot.matrixWorld;
    for (const p of it.parts) {
      lists[it.mat].push(skin(colored(p.geo, p.color, p.shade).applyMatrix4(mw), bi));
      if (p.outline !== false && it.mat === 'body') {
        const o = p.geo.clone();
        o.deleteAttribute('uv');
        o.deleteAttribute('color');
        lists.outline.push(skin(o.applyMatrix4(mw), bi));
      }
    }
  }
  const skeleton = new THREE.Skeleton(bones);
  const make = (list: THREE.BufferGeometry[], material: THREE.Material, shadows: boolean) => {
    if (!list.length) return;
    const mesh = new THREE.SkinnedMesh(mergeGeometries(list)!, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    root.add(mesh);
    mesh.bind(skeleton);
  };
  make(lists.body, m.body, true);
  make(lists.cloth, m.cloth, true);
  make(lists.outline, m.outline, false);
}

/** A damped spring for secondary motion. */
class Spring {
  x = 0;
  v = 0;
  constructor(private k: number, private c: number) {}
  step(target: number, dt: number) {
    // Two substeps keep stiff springs stable at low frame rates.
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// ---------------------------------------------------------------------------

export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Bone();
  private torso = new THREE.Bone();
  private head = new THREE.Bone();
  private hairBack = new THREE.Bone();
  private cowlick = new THREE.Bone();
  private arms: { upper: THREE.Object3D; fore: THREE.Object3D }[] = [];
  private legs: { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D }[] = [];
  private capeUpper: THREE.Object3D | null = null;
  private capeLower: THREE.Object3D | null = null;
  private face: THREE.CanvasTexture;

  private phase = 0;
  private lastPos = new THREE.Vector3();
  private lastYaw = 0;
  private speedS = 0;
  private accel = 0;
  private yawRate = 0;
  private lastBob = 0;
  private nextBlink = 2;
  private blinkUntil = 0;
  private lookYaw = 0;
  private springs = {
    capeX: new Spring(55, 7),
    capeBend: new Spring(70, 6),
    capeZ: new Spring(40, 6),
    hairX: new Spring(90, 9),
    hairZ: new Spring(70, 8),
    cowlick: new Spring(160, 6),
  };
  private waveStart = -Infinity;
  /** Hold one hand up (e.g. a shopper who wants to buy). Eased in and out. */
  raised = false;
  private raiseAmt = 0;
  /** A friendly wave (with a little nod), e.g. when someone talks to this character. */
  wave() {
    this.waveStart = performance.now() / 1000;
  }
  /** Head turn toward something (radians); null lets the character glance around on its own. */
  lookTarget: number | null = null;

  static readonly HIP_HEIGHT = 0.76;

  constructor(look: Look, atmosphere: Atmosphere, private seed = 0) {
    const m = materials(atmosphere);
    const w = look.build ?? 1;
    collecting = [];
    this.root.name = 'character';
    this.root.add(this.hips);
    this.hips.position.y = Character.HIP_HEIGHT;
    this.hips.add(this.torso);
    const shadeDown: ColorFn = (p) => 0.86 + 0.14 * THREE.MathUtils.smoothstep(p.y, -0.3, 0.1);

    // --- Hips: pelvis, belt, tunic hem or robe. ---
    const hip: Part[] = [
      { geo: lathe([[0.001, -0.12], [0.1, -0.11], [0.145, -0.05], [0.15, 0.02], [0.142, 0.07]], 18, 0.78), color: look.legs },
      { geo: tr(new THREE.TorusGeometry(0.152 * w, 0.02, 6, 24).rotateX(Math.PI / 2).scale(1, 1, 0.8), 0, 0.045, 0), color: look.trim },
      { geo: tr(new THREE.BoxGeometry(0.05, 0.04, 0.02), 0, 0.045, 0.125), color: '#f3d488', outline: false },
    ];
    if (look.robe) {
      hip.push({ geo: folds(lathe([[0.15 * w, 0.06], [0.17 * w, -0.08], [0.23, -0.4], [0.27, -0.66], [0.275, -0.68]], 18, 0.85), 9, 0.06, -0.05, -0.68), color: look.top, shade: shadeDown });
      hip.push({ geo: folds(lathe([[0.27, -0.6], [0.278, -0.69]], 18, 0.85), 9, 0.06, 0.2, -0.68), color: look.trim, outline: false });
    } else {
      hip.push({ geo: folds(lathe([[0.152 * w, 0.06], [0.165 * w, -0.04], [0.2 * w, -0.17], [0.215 * w, -0.22]], 17, 0.82), 7, 0.07, 0.0, -0.22), color: look.top, shade: shadeDown });
    }
    bone(this.hips, hip, m);

    // --- Legs, with a foot pivot so soles stay flat and toes push off. ---
    for (const side of [-1, 1]) {
      const thigh = new THREE.Bone();
      thigh.position.set(side * 0.082, -0.05, 0);
      this.hips.add(thigh);
      const shin = new THREE.Bone();
      shin.position.y = -0.36;
      thigh.add(shin);
      const foot = new THREE.Bone();
      foot.position.y = -0.33;
      shin.add(foot);
      bone(thigh, [{ geo: lathe([[0.072, 0.04], [0.074, -0.06], [0.064, -0.24], [0.052, -0.37]], 12), color: look.legs }], m);
      bone(shin, [
        { geo: lathe([[0.052, 0.02], [0.056, -0.07], [0.044, -0.18]], 12), color: look.legs },
        { geo: lathe([[0.058, -0.14], [0.064, -0.17], [0.06, -0.26], [0.054, -0.34]], 12), color: look.boots },
        { geo: tr(new THREE.TorusGeometry(0.063, 0.012, 5, 14).rotateX(Math.PI / 2), 0, -0.15, 0), color: look.trim, outline: false },
      ], m);
      bone(foot, [{ geo: tr(new THREE.SphereGeometry(0.062, 14, 10).scale(0.95, 0.6, 1.75), 0, -0.02, 0.04), color: look.boots }], m);
      this.legs.push({ thigh, shin, foot });
    }

    // --- Torso: chest/waist profile, collar, open vest, sash. ---
    const torso: Part[] = [
      { geo: lathe([[0.135 * w, 0.0], [0.14 * w, 0.08], [0.152 * w, 0.2], [0.158 * w, 0.29], [0.148 * w, 0.38], [0.118 * w, 0.45], [0.06, 0.5], [0.042, 0.52]], 15, 0.74), color: look.top, shade: shadeDown },
      { geo: lathe([[0.038, 0.47], [0.036, 0.6]], 12), color: look.skin },
      { geo: tr(new THREE.TorusGeometry(0.062, 0.018, 6, 18).rotateX(Math.PI / 2), 0, 0.5, 0.0), color: look.top },
    ];
    if (!look.robe) {
      // Vest: open at the front.
      torso.push({ geo: lathe([[0.143 * w, 0.03], [0.148 * w, 0.1], [0.16 * w, 0.21], [0.166 * w, 0.29], [0.156 * w, 0.37], [0.13 * w, 0.43]], 15, 0.78, 0.42, Math.PI * 2 - 0.84), color: look.accent });
      if (look.build && look.build > 1) {
        // Apron front panel for the merchant.
        torso.push({ geo: tr(new THREE.BoxGeometry(0.2, 0.3, 0.02), 0, 0.17, 0.112), color: look.accent });
      }
    } else {
      // Robe: a trim band down the front and a capelet.
      torso.push({ geo: tr(new THREE.BoxGeometry(0.05, 0.48, 0.02), 0, 0.22, 0.115), color: look.trim, outline: false });
      torso.push({ geo: folds(lathe([[0.07, 0.5], [0.17, 0.44], [0.21, 0.34], [0.215, 0.31]], 17, 0.8), 8, 0.05, 0.45, 0.31), color: look.accent });
    }
    // Diagonal sash across the chest.
    torso.push({ geo: tr(new THREE.TorusGeometry(0.17 * w, 0.016, 5, 24).scale(1, 1, 0.8).rotateZ(0.5).rotateX(0.0), 0, 0.27, 0).rotateY(Math.PI / 2).scale(0.78, 1, 1).rotateY(-Math.PI / 2), color: look.trim, outline: false });
    bone(this.torso, torso, m);

    // --- Arms: shoulder puff, tapered upper arm, cuffed forearm, mitten hand. ---
    for (const side of [-1, 1]) {
      const upper = new THREE.Bone();
      upper.position.set(side * (0.165 * w + 0.02), 0.43, 0);
      this.torso.add(upper);
      const fore = new THREE.Bone();
      fore.position.y = -0.24;
      upper.add(fore);
      bone(upper, [
        { geo: tr(new THREE.SphereGeometry(0.056, 14, 10), 0, -0.01, 0), color: look.top },
        { geo: lathe([[0.054, 0.0], [0.052, -0.06], [0.043, -0.25]], 12), color: look.top, shade: shadeDown },
      ], m);
      const handCol = look.skin;
      bone(fore, [
        { geo: lathe(look.robe ? [[0.046, 0.02], [0.06, -0.12], [0.068, -0.17]] : [[0.042, 0.02], [0.043, -0.05], [0.034, -0.17]], 12), color: look.robe ? look.top : look.skin },
        { geo: lathe([[0.047, -0.11], [0.048, -0.16]], 12), color: look.robe ? look.trim : look.accent, outline: false },
        { geo: tr(new THREE.SphereGeometry(0.042, 12, 10).scale(0.8, 1.15, 0.6), 0, -0.21, 0.004), color: handCol },
        { geo: tr(new THREE.CapsuleGeometry(0.013, 0.03, 3, 6).rotateZ(side * 0.6).rotateX(-0.3), side * -0.026, -0.2, 0.018), color: handCol, outline: false },
      ], m);
      this.arms.push({ upper, fore });
    }

    // --- Head: shaped skull, ears, painted face, strand hair. ---
    this.head.position.y = 0.56;
    this.torso.add(this.head);
    const R = 0.168;
    const C = V(0, R * 0.95, 0); // head centre in head space
    const skull = headShape(new THREE.SphereGeometry(R, 22, 16), R);
    skull.translate(C.x, C.y, C.z);
    const headParts: Part[] = [{ geo: skull, color: look.skin }];
    for (const side of [-1, 1]) {
      headParts.push({ geo: tr(new THREE.SphereGeometry(0.03, 8, 8).scale(0.45, 1, 0.8), side * R * 0.98, C.y - 0.01, -0.01), color: look.skin });
    }

    // Hair shading: darker underneath and toward the tips, with a glossy band near the crown.
    const hairCol = new THREE.Color(look.hair);
    const bright = hairCol.r + hairCol.g + hairCol.b > 2.2;
    const hairShade: ColorFn = (p, n) => {
      const h = (p.y - C.y) / R;
      const band = Math.exp(-Math.pow((h - 0.55) / 0.1, 2)) * Math.max(0, n.y * 0.5 + 0.5);
      return (0.78 + 0.22 * THREE.MathUtils.smoothstep(h, -1.2, 0.6)) + (bright ? 0.05 : 0.32) * band;
    };
    const hairPart = (g: THREE.BufferGeometry, outline = true): Part => ({ geo: g, color: look.hair, shade: hairShade, outline });

    // Cap: covers the crown and back, leaving the forehead open.
    // Tilted back so the front hairline sits high on the forehead (~50 deg from the top) and the
    // back reaches the nape (~125 deg); the bangs then lie over the forehead as separate locks.
    const cap = new THREE.SphereGeometry(R * 1.045, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.49);
    cap.rotateX(-0.65);
    cap.translate(C.x, C.y + 0.004, C.z - 0.006);
    headParts.push(hairPart(cap));

    /** A point on a sphere around the head centre: polar angle from the top, azimuth from the front (+z). */
    const sp = (polar: number, az: number, k = 1.07) =>
      V(C.x + Math.sin(polar) * Math.sin(az) * R * k, C.y + Math.cos(polar) * R * k, C.z + Math.sin(polar) * Math.cos(az) * R * k);

    // Bangs: separate pointed locks from the hairline, hugging the head, ending above the eyes.
    const bangs = 7;
    for (let i = 0; i < bangs; i++) {
      const u = i / (bangs - 1) - 0.5; // -0.5..0.5
      const az = u * 1.7 + Math.sin(i * 2.3) * 0.04;
      const len = 1.22 + Math.abs(u) * 0.42 + ((i * 37) % 5) * 0.015;
      const sweep = -Math.sign(u) * 0.12 + 0.06;
      headParts.push(hairPart(strand([sp(0.5, az * 0.7, 1.03), sp(0.88, az * 0.9, 1.075), sp(1.08, az + sweep * 0.5, 1.07), sp(len, az + sweep, 1.03)], 0.05, 0.003, 0.32)));
    }
    // Side locks framing the face.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const az = side * (1.25 + k * 0.28);
        headParts.push(hairPart(strand([sp(0.5, az, 1.02), sp(1.2, az, 1.1), sp(1.75, az * 0.97, 1.06), sp(2.15 + k * 0.1, az * 0.92, 1.0)], 0.04, 0.005, 0.5)));
      }
    }
    // Back layer: short locks over the back of the head, ending at the nape.
    for (let i = 0; i < 9; i++) {
      const az = Math.PI + (i / 8 - 0.5) * 2.6;
      const end = look.hairStyle === 'short' ? 2.25 + (i % 2) * 0.12 : 1.9;
      headParts.push(hairPart(strand([sp(0.35, az, 1.02), sp(1.2, az, 1.14), sp(end, az, 1.06)], 0.06, 0.008, 0.5)));
    }
    if (look.hairStyle === 'short') {
      // A few flicked-out tufts at the nape.
      for (const side of [-1, 0, 1]) {
        const az = Math.PI + side * 0.5;
        const base = sp(2.1, az, 1.03);
        headParts.push(hairPart(strand([base, base.clone().add(V(side * 0.03, -0.05, -0.04)), base.clone().add(V(side * 0.07, -0.06, -0.09))], 0.03, 0.004, 0.55)));
      }
    } else if (look.hairStyle === 'bun') {
      headParts.push(hairPart(tr(new THREE.SphereGeometry(0.075, 14, 12), C.x, C.y + R * 0.85, C.z - R * 0.55)));
      headParts.push({ geo: tr(new THREE.TorusGeometry(0.06, 0.012, 5, 16).rotateX(-0.9), C.x, C.y + R * 0.72, C.z - R * 0.48), color: look.trim, outline: false });
    }

    // Long hair hangs on its own spring-driven pivot at the back of the head.
    this.hairBack.position.set(0, C.y + R * 0.2, -R * 0.4);
    this.head.add(this.hairBack);
    if (look.hairStyle === 'long') {
      const longHair: Part[] = [];
      for (let i = 0; i < 9; i++) {
        const x = (i / 8 - 0.5) * 0.26;
        const len = 0.55 + Math.sin(i * 1.7) * 0.04;
        longHair.push(hairPart(strand([V(x * 0.6, 0.0, 0.0), V(x * 0.95, -0.12, -0.08), V(x * 1.05, -len * 0.6, -0.07), V(x * 1.0, -len, -0.03)], 0.055, 0.01, 0.45)));
      }
      bone(this.hairBack, longHair, m);
    }

    // Cowlick: one springy lock sticking up from the crown.
    this.cowlick.position.copy(sp(0.12, 0.6, 1.02));
    this.head.add(this.cowlick);
    if (!look.hat) {
      bone(this.cowlick, [hairPart(strand([V(0, 0, 0), V(0.01, 0.05, 0.01), V(0.035, 0.08, 0.04), V(0.06, 0.07, 0.07)], 0.02, 0.003, 0.5, 10))], m);
    }

    if (look.hat) {
      const brim = lathe([[0.001, 0.0], [0.33, -0.01], [0.36, -0.03], [0.34, 0.0], [0.001, 0.015]], 20);
      headParts.push({ geo: tr(brim, C.x, C.y + R * 0.72, C.z - 0.01), color: look.hat });
      const crownPts = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0.18, -0.02), V(0.01, 0.34, -0.09), V(0.06, 0.44, -0.18)]);
      // The pointed crown: a lathe-like cone that bends backward.
      const crown = new THREE.TubeGeometry(crownPts, 14, 1, 16, false);
      const pos = crown.attributes.position as THREE.BufferAttribute;
      const frames = crownPts.computeFrenetFrames(14, false);
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const c = crownPts.getPointAt(t);
        const r = 0.17 * (1 - t) + 0.006;
        for (let j = 0; j <= 16; j++) {
          const a = (j / 16) * Math.PI * 2;
          const nn = frames.normals[i];
          const bb = frames.binormals[i];
          pos.setXYZ(i * 17 + j, c.x + r * (Math.cos(a) * nn.x + Math.sin(a) * bb.x), c.y + r * (Math.cos(a) * nn.y + Math.sin(a) * bb.y), c.z + r * (Math.cos(a) * nn.z + Math.sin(a) * bb.z));
        }
      }
      crown.computeVertexNormals();
      headParts.push({ geo: tr(crown, C.x, C.y + R * 0.72, C.z - 0.01), color: look.hat });
      headParts.push({ geo: tr(lathe([[0.168, 0.0], [0.165, 0.045]], 17), C.x, C.y + R * 0.74, C.z - 0.01), color: look.trim, outline: false });
    }
    bone(this.head, headParts, m);

    // Face: a sphere patch just outside the skin, shaped the same way, carrying the drawn face.
    this.face = createFaceTexture({ iris: look.eyes, brow: new THREE.Color(look.hair).multiplyScalar(bright ? 0.6 : 0.8).getStyle(), calm: look.calm });
    const fg = new THREE.SphereGeometry(R * 1.006, 24, 16, Math.PI / 2 - FACE_PHI_LEN / 2, FACE_PHI_LEN, Math.PI / 2 - FACE_THETA_TOP, FACE_THETA_LEN);
    // Sphere uv runs the other way round from our canvas layout; mirror u.
    const uv = fg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    headShape(fg, R);
    fg.translate(C.x, C.y, C.z);
    const faceMat = new THREE.MeshToonMaterial({ map: this.face, gradientMap: m.gradientMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    atmosphere.patchMaterial(faceMat);
    const faceMesh = new THREE.Mesh(fg, faceMat);
    faceMesh.renderOrder = 2;
    this.head.add(faceMesh);

    // --- Cape: two pivots, so it can bend and trail. ---
    if (look.cape) {
      const sheet = (h: number, wTop: number, wBot: number) => {
        const g = new THREE.PlaneGeometry(1, h, 6, 5);
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i) - h / 2;
          const t = -y / h;
          const width = THREE.MathUtils.lerp(wTop, wBot, t);
          const xx = x * width;
          pos.setXYZ(i, xx, y, -Math.pow(xx / (wBot * 0.5), 2) * 0.05 - Math.sin(x * Math.PI * 3) * 0.008 * t);
        }
        g.computeVertexNormals();
        return g;
      };
      this.capeUpper = new THREE.Bone();
      this.capeUpper.position.set(0, 0.47, -0.088);
      this.torso.add(this.capeUpper);
      this.capeLower = new THREE.Bone();
      this.capeLower.position.y = -0.3;
      this.capeUpper.add(this.capeLower);
      const capeShade: ColorFn = (p) => 0.92 + 0.08 * THREE.MathUtils.smoothstep(p.y, -0.3, 0);
      bone(this.capeUpper, [{ geo: sheet(0.3, 0.34 * w, 0.4 * w), color: look.cape, shade: capeShade, outline: false }], m, 'cloth');
      bone(this.capeLower, [{ geo: sheet(0.3, 0.4 * w, 0.46 * w), color: look.cape, shade: (p) => 0.85 + 0.07 * THREE.MathUtils.smoothstep(p.y, -0.3, 0), outline: false }], m, 'cloth');
      // Mantle around the shoulders, with a gold clasp.
      bone(this.torso, [
        { geo: folds(lathe([[0.065, 0.51], [0.15 * w, 0.46], [0.18 * w, 0.4], [0.182 * w, 0.37]], 17, 0.8), 6, 0.05, 0.46, 0.37), color: look.cape },
        { geo: tr(new THREE.SphereGeometry(0.022, 10, 8).scale(1, 1, 0.5), 0, 0.46, 0.105), color: look.trim, outline: false },
      ], m);
    }

    finalize(this.root, collecting, m);
    collecting = null;

    // Soft contact shadow, so characters sit on the ground on every quality tier.
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), blobMaterial());
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    this.root.add(blob);
  }

  /** Advance the animation. `speed` is ground speed in m/s (from the simulation). */
  update(dtIn: number, time: number, speed: number) {
    const dt = Math.min(Math.max(dtIn, 1e-4), 0.05);
    const S = this.springs;

    // Eased speed and its rate of change; turn rate from the root's heading.
    const prevSpeed = this.speedS;
    this.speedS += (speed - this.speedS) * Math.min(1, dt * 7);
    this.accel += ((this.speedS - prevSpeed) / dt - this.accel) * Math.min(1, dt * 6);
    let dyaw = this.root.rotation.y - this.lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.lastYaw = this.root.rotation.y;
    this.yawRate += (dyaw / dt - this.yawRate) * Math.min(1, dt * 8);

    const pos = this.root.position;
    const moved = Math.min(Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z), 0.5);
    this.lastPos.copy(pos);
    const w = THREE.MathUtils.clamp(this.speedS / 4.5, 0, 1);
    const run = THREE.MathUtils.smoothstep(w, 0.45, 0.95);
    const idle = 1 - THREE.MathUtils.smoothstep(w, 0, 0.25);
    const stride = THREE.MathUtils.lerp(0.9, 1.7, w);
    this.phase += moved * ((Math.PI * 2) / stride);
    const p = this.phase;
    const turn = THREE.MathUtils.clamp(this.yawRate * 0.12, -0.25, 0.25) * w;
    const lean = THREE.MathUtils.clamp(this.accel * 0.02, -0.12, 0.15);

    // Idle weight shift: hips drift over one leg, the other knee softens.
    const shift = Math.sin(time * 0.55 + this.seed) * idle;
    const breathe = Math.sin(time * 2.0 + this.seed);

    // Hips: lowest just after each foot lands, highest mid-stance; rotate with the legs.
    const bob = Math.cos(2 * (p - 0.2));
    this.hips.position.y = Character.HIP_HEIGHT - 0.025 * w - 0.03 * run + (0.025 + 0.025 * run) * w * bob - Math.abs(shift) * 0.008;
    this.hips.position.x = Math.sin(p) * 0.015 * w * (1 - run * 0.5) + shift * 0.022;
    this.hips.rotation.y = Math.sin(p) * (0.14 + 0.08 * run) * w;
    this.hips.rotation.z = Math.cos(p) * 0.04 * w - shift * 0.04 - turn * 0.6;
    this.hips.rotation.x = 0;

    // Torso: counter-twists against the hips, leans with speed and acceleration, rolls into turns.
    this.torso.rotation.y = -Math.sin(p) * (0.22 + 0.12 * run) * w;
    this.torso.rotation.x = 0.05 * w + 0.16 * run + lean + breathe * 0.012 * idle;
    this.torso.rotation.z = -this.hips.rotation.z * 0.7 + shift * 0.02;
    this.torso.position.y = breathe * 0.003 * idle;

    // Legs.
    const A = THREE.MathUtils.lerp(0.45, 0.85, run);
    this.legs.forEach((l, i) => {
      const q = p + i * Math.PI;
      const s = Math.sin(q);
      const c = Math.cos(q);
      const swing = Math.max(0, c); // leg travelling forward
      l.thigh.rotation.x = -(s * A + 0.08 * run) * w - swing * 0.15 * run * w;
      const knee = (0.1 + (0.75 + 0.75 * run) * Math.pow(swing, 1.4) + 0.12 * Math.max(0, -c) * Math.max(0, s)) * w;
      const idleKnee = i === 0 ? Math.max(0, shift) : Math.max(0, -shift);
      l.shin.rotation.x = knee + idleKnee * 0.16;
      l.thigh.rotation.x -= idleKnee * 0.08;
      // Foot: stays roughly level, pushes off with the toes as the leg trails, lifts toes in the swing.
      const toeOff = Math.max(0, -c) * Math.max(0, -s) * 0.7 * w;
      l.foot.rotation.x = -(l.thigh.rotation.x + l.shin.rotation.x) * 0.85 + toeOff - swing * 0.15 * w;
      l.thigh.rotation.z = (i === 0 ? -1 : 1) * (0.02 + 0.02 * idle);
    });

    // Arms: swing opposite the legs, trailing a little behind; elbows bend more as they come forward.
    const AA = THREE.MathUtils.lerp(0.35, 0.95, run);
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const q = p + i * Math.PI - 0.35;
      const s = Math.sin(q);
      const idleSway = Math.sin(time * 0.9 + this.seed + i * 1.3) * 0.035;
      a.upper.rotation.x = s * AA * w + (0.06 + idleSway) * idle + breathe * 0.01 * idle;
      a.upper.rotation.z = side * (0.09 + 0.12 * run + 0.015 * breathe * idle) + side * shift * 0.03 * (i === 0 ? 1 : -1);
      a.upper.rotation.y = side * -0.1 * run;
      a.fore.rotation.x = -(0.22 + 0.35 * w + 0.8 * run) - Math.max(0, -s) * 0.45 * w;
    });

    // Wave: one arm rises and waves, blended in and out over ~1.8 s.
    const wt = time - this.waveStart;
    if (wt >= 0 && wt < 1.8) {
      const g = THREE.MathUtils.smoothstep(wt, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(wt, 1.45, 1.8));
      const arm = this.arms[1];
      arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, 2.5, g);
      arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -0.25, g);
      arm.fore.rotation.x = THREE.MathUtils.lerp(arm.fore.rotation.x, -0.35, g);
      arm.fore.rotation.z = Math.sin(wt * 11) * 0.45 * g;
    } else {
      this.arms[1].fore.rotation.z = 0;
    }
    // Raised hand: eased so it reads as a reaction, not a snap.
    this.raiseAmt += ((this.raised ? 1 : 0) - this.raiseAmt) * Math.min(1, dt * 7);
    if (this.raiseAmt > 0.001 && !(wt >= 0 && wt < 1.8)) {
      const g = this.raiseAmt;
      const arm = this.arms[1];
      arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, 2.75, g);
      arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -0.15, g);
      arm.fore.rotation.x = THREE.MathUtils.lerp(arm.fore.rotation.x, -0.15, g);
      arm.fore.rotation.z = Math.sin(time * 6 + this.seed) * 0.12 * g;
    }
    const nod = wt >= 0 && wt < 0.7 ? Math.sin((wt / 0.7) * Math.PI) * 0.18 : 0;

    // Head: steadied against the body, leads into turns, glances around when idle.
    const wander = Math.sin(time * 0.31 + this.seed) * 0.45 + Math.sin(time * 0.83 + this.seed * 2) * 0.15;
    const target = this.lookTarget ?? wander * idle;
    this.lookYaw += (target - this.lookYaw) * Math.min(1, dt * 3.5);
    this.head.rotation.y = this.lookYaw - (this.torso.rotation.y + this.hips.rotation.y) * 0.85 + this.yawRate * 0.07 * w;
    this.head.rotation.x = -this.torso.rotation.x * 0.7 + Math.sin(time * 0.5 + this.seed) * 0.04 * idle + nod;
    this.head.rotation.z = -this.torso.rotation.z * 0.6 - this.hips.rotation.z * 0.5 + Math.sin(time * 0.37 + this.seed) * 0.04 * idle;

    // Secondary motion: springs chase targets set by speed, acceleration, bounce and turning.
    const bobVel = (this.hips.position.y - this.lastBob) / dt;
    this.lastBob = this.hips.position.y;
    const flutter = Math.sin(time * 11 + this.seed) * 0.06 * run + Math.sin(time * 1.6 + this.seed) * 0.03;
    if (this.capeUpper && this.capeLower) {
      this.capeUpper.rotation.x = S.capeX.step(0.08 + 0.55 * w + 0.35 * run + Math.max(0, lean) * 1.5 - this.torso.rotation.x + flutter, dt);
      this.capeLower.rotation.x = S.capeBend.step(0.05 + 0.35 * run - S.capeX.v * 0.04 + bobVel * 0.3 + flutter * 1.5, dt);
      this.capeUpper.rotation.z = S.capeZ.step(-this.yawRate * 0.12 * (0.3 + w), dt);
    }
    this.hairBack.rotation.x = S.hairX.step(0.08 + 0.3 * run + lean * 0.8 - this.head.rotation.x - bobVel * 0.25, dt);
    this.hairBack.rotation.z = S.hairZ.step(-this.yawRate * 0.1 - this.head.rotation.z * 0.5, dt);
    this.cowlick.rotation.x = S.cowlick.step(-bobVel * 0.6 + 0.2 * run, dt);

    // Blinking.
    if (time > this.nextBlink) {
      this.blinkUntil = time + 0.11;
      const r = Math.abs(Math.sin(time * 12.9898 + this.seed * 78.233)) % 1;
      this.nextBlink = time + 2 + r * 3.5;
    }
    this.face.offset.x = time < this.blinkUntil ? 0.5 : 0;
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
      data.set([20, 30, 25, Math.round(Math.max(0, 1 - d) ** 1.6 * 140)], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return blobMat;
}
