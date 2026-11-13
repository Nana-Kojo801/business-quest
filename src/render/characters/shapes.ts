import * as THREE from 'three';
import { Mat } from './materials';

/**
 * Geometry helpers for the character builder. Every part is a smooth shape with a colour
 * and a surface type; the builder merges them per bone. Units are metres; models face +z.
 */
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => number;
export interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  mat: Mat;
  /** Draw an outline around this part (default true). */
  outline?: boolean;
  /** Per-vertex brightness multiplier. */
  shade?: ColorFn;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Level of detail for the character being built. Crowd characters (seen from further away,
 * many at once) use fewer segments. Set by the builder for the duration of one build.
 */
export const detail = { crowd: false };
const latheScale = () => (detail.crowd ? 0.65 : 1);
export const tr = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
export const part = (geo: THREE.BufferGeometry, color: string, mat: Mat, extra: Partial<Part> = {}): Part => ({ geo, color, mat, ...extra });

/** Copy a geometry with baked vertex colour (optionally shaded) and surface type. Keeps normals. */
export function colored(geo: THREE.BufferGeometry, color: string, mat: Mat, shade?: ColorFn): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const base = new THREE.Color(color);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const extra = g.attributes.aShade as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    let k = shade ? shade(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i)) : 1;
    if (extra) k *= extra.getX(i);
    col.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (extra) g.deleteAttribute('aShade');
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(pos.count).fill(mat), 1));
  return g;
}

/** A smooth body part from a side profile (radius, y), turned around the vertical axis. */
export function lathe(profile: [number, number][], segs = 20, zScale = 1, phiStart = 0, phiLen = Math.PI * 2) {
  // Lathe faces point outward only when the profile runs bottom to top.
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), Math.max(8, Math.round(segs * latheScale())), phiStart, phiLen);
  if (zScale !== 1) g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}

/** Smooth a profile: Catmull-Rom through the points, so lathed forms have no visible rings. */
export function smoothProfile(points: [number, number][], samples = detail.crowd ? 2 : 3): [number, number][] {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints((points.length - 1) * samples).map((p) => [Math.max(p.x, 0.0005), p.y]);
}

/** Ripple a garment's lower edge outward in folds. */
export function folds(g: THREE.BufferGeometry, count: number, depth: number, top: number, bottom: number, phase = 0) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((top - y) / (top - bottom), 0, 1);
    const a = Math.atan2(x, z);
    const k = 1 + depth * t * t * (Math.sin(a * count + phase) * 0.7 + Math.sin(a * count * 2.3 + phase * 1.7) * 0.3);
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Widen a lathed torso at shoulder height, so shoulders read as a line, not a cylinder. */
export function shoulders(g: THREE.BufferGeometry, y0: number, width: number, depthKeep = 0.4) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = Math.exp(-Math.pow((y - y0) / 0.07, 2));
    pos.setX(i, pos.getX(i) * (1 + width * k));
    pos.setZ(i, pos.getZ(i) * (1 + width * depthKeep * k * 0.3));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A tapered, curving lock (hair lock, bang, cowlick). Radius goes from r0 at the root to
 * r1 at the tip (eased so locks stay full, then point); `flat` squashes it into a ribbon
 * whose broad side faces outward from `outFrom` (e.g. the head centre).
 */
export function strand(points: THREE.Vector3[], r0: number, r1: number, flat = 0.5, segIn = 9, radialIn = 5, outFrom?: THREE.Vector3) {
  // Locks are seen small on a phone: 9 x 5 segments stay smooth; crowds use fewer.
  const seg = Math.max(4, Math.round(Math.min(segIn, 9) * (detail.crowd ? 0.7 : 1)));
  const radial = detail.crowd ? 4 : Math.min(radialIn, 5);
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = tube.attributes.position as THREE.BufferAttribute;
  // Per-vertex shading so every lock reads on its own: lighter down its middle, darker at its
  // edges and toward the tip (colored() multiplies it in).
  const shadeAttr = new Float32Array(pos.count);
  const frames = curve.computeFrenetFrames(seg, false);
  const out = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    // Full for most of the length, then tapering to a point.
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 1.6));
    tan.copy(frames.tangents[i]);
    if (outFrom) {
      out.copy(c).sub(outFrom);
      out.addScaledVector(tan, -out.dot(tan)).normalize();
      side.crossVectors(tan, out).normalize();
    } else {
      out.copy(frames.normals[i]);
      side.copy(frames.binormals[i]);
    }
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // Broad across the head (side), thin outward (out): a ribbon lying on the head.
      const px = c.x + r * (Math.cos(a) * side.x + Math.sin(a) * out.x * flat);
      const py = c.y + r * (Math.cos(a) * side.y + Math.sin(a) * out.y * flat);
      const pz = c.z + r * (Math.cos(a) * side.z + Math.sin(a) * out.z * flat);
      pos.setXYZ(i * (radial + 1) + j, px, py, pz);
      const across = Math.abs(Math.cos(a)); // 1 at the lock's edges
      shadeAttr[i * (radial + 1) + j] = (1.06 - 0.3 * across * across) * (1 - 0.18 * t * t);
    }
  }
  tube.computeVertexNormals();
  tube.setAttribute('aShade', new THREE.BufferAttribute(shadeAttr, 1));
  return tube;
}

/**
 * An anime head from a sphere: round cranium, a flatter face plane, soft cheeks and a
 * small chin that comes slightly forward.
 */
export function headShape(g: THREE.BufferGeometry, R: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const down = Math.max(0, -y / R); // 0 at the equator, 1 at the bottom
    const front = Math.max(0, z / R);
    const back = Math.max(0, -z / R);
    // Jaw narrows to a soft V; cheeks stay full just below the eyes.
    x *= 1 - 0.3 * Math.pow(down, 1.8) + 0.04 * Math.exp(-Math.pow((down - 0.3) / 0.22, 2));
    // Face plane: slightly flatter at the front, fuller at the back of the skull.
    z *= 1 - 0.08 * front + 0.07 * back * (1 - down);
    // A short lower face (round and youthful) with the chin a little forward.
    y *= 1 - 0.1 * down;
    z += 0.04 * R * down * down * front;
    pos.setXYZ(i, x * 1.02, y * 0.98, z * 0.95);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Face-plane normals: across the front of the head, normals lean toward one forward
 * direction, so light falls on the face as one soft plane (no hard shadow line across it).
 */
export function faceNormals(g: THREE.BufferGeometry, centre: THREE.Vector3, R: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const focus = centre.clone().add(V(0, R * 0.1, -R * 1.8)); // far behind the face
  const f = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const front = THREE.MathUtils.smoothstep((p.z - centre.z) / R, -0.1, 0.55);
    f.copy(p).sub(focus).normalize();
    n.lerp(f, 0.75 * front).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}
