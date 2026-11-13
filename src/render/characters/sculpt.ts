import * as THREE from 'three';

/**
 * Sculpting characters from code, like soft clay.
 *
 * A figure is described as smooth blobs (ellipsoids and tapered capsules) melted
 * together with a smooth union, so shoulders flow into arms and the waist into the
 * hips, with no visible primitives. The blended shape (a signed distance field) is
 * turned into a mesh with "surface nets", with normals taken from the field itself.
 *
 * Every blob belongs to a bone; each vertex is skinned to the bones of the blobs
 * nearest it, so joints bend smoothly instead of hinging between separate parts.
 *
 * Garments are shells of the same field (the body grown by a thickness), cut by
 * planes and slabs, so they fit the body exactly and their hems and cuffs have real
 * thickness.
 */
export type Vec = THREE.Vector3;

export interface Blob {
  kind: 'ellipsoid' | 'capsule';
  /** Ellipsoid centre, or capsule start. */
  a: Vec;
  /** Capsule end. */
  b?: Vec;
  /** Ellipsoid radii (x, y, z), or capsule radius at a. */
  r: Vec | number;
  /** Capsule radius at b. */
  rb?: number;
  /** Blend radius: how softly this blob melts into the shape before it. */
  k: number;
  bone: THREE.Object3D;
  /** Subtract instead of add (a smooth carve). */
  carve?: boolean;
}

const tmp = new THREE.Vector3();
const ba = new THREE.Vector3();

/** Exact-ish ellipsoid distance (iq's bound), good near the surface. */
function sdEllipsoid(px: number, py: number, pz: number, r: Vec) {
  const k0 = Math.hypot(px / r.x, py / r.y, pz / r.z);
  const k1 = Math.hypot(px / (r.x * r.x), py / (r.y * r.y), pz / (r.z * r.z));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r.x, r.y, r.z);
}

/** Tapered capsule ("round cone") from a (radius r1) to b (radius r2). */
function sdRoundCone(px: number, py: number, pz: number, a: Vec, b: Vec, r1: number, r2: number) {
  ba.subVectors(b, a);
  tmp.set(px - a.x, py - a.y, pz - a.z);
  const l2 = ba.lengthSq();
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = tmp.dot(ba);
  const z = y - l2;
  const xx = tmp.x * l2 - ba.x * y;
  const xy = tmp.y * l2 - ba.y * y;
  const xz = tmp.z * l2 - ba.z * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function blobDistance(bl: Blob, x: number, y: number, z: number) {
  if (bl.kind === 'ellipsoid') return sdEllipsoid(x - bl.a.x, y - bl.a.y, z - bl.a.z, bl.r as Vec);
  return sdRoundCone(x, y, z, bl.a, bl.b!, bl.r as number, bl.rb ?? (bl.r as number));
}

/** Polynomial smooth minimum. */
function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

export type Field = (x: number, y: number, z: number) => number;

/** The blended shape of a list of blobs. */
export function blend(blobs: Blob[]): Field {
  return (x, y, z) => {
    let d = 1e9;
    for (const bl of blobs) {
      const e = blobDistance(bl, x, y, z);
      d = bl.carve ? smax(d, -e, bl.k) : smin(d, e, bl.k);
    }
    return d;
  };
}

export interface Box {
  min: Vec;
  max: Vec;
}

/** Bounding box of blobs, padded. */
export function bounds(blobs: Blob[], pad: number): Box {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const bl of blobs) {
    if (bl.carve) continue;
    const r = typeof bl.r === 'number' ? Math.max(bl.r, bl.rb ?? bl.r) : Math.max(bl.r.x, bl.r.y, bl.r.z);
    for (const p of bl.b ? [bl.a, bl.b] : [bl.a]) {
      min.min(tmp.set(p.x - r, p.y - r, p.z - r));
      max.max(tmp.set(p.x + r, p.y + r, p.z + r));
    }
  }
  min.subScalar(pad);
  max.addScalar(pad);
  return { min, max };
}

/**
 * Naive surface nets: one vertex per grid cell the surface passes through (at the
 * average of its edge crossings), quads across every edge with a sign change.
 * Produces an even, smooth mesh with far fewer slivers than marching cubes.
 */
export function surfaceNets(field: Field, box: Box, cell: number): THREE.BufferGeometry {
  const nx = Math.max(2, Math.ceil((box.max.x - box.min.x) / cell) + 1);
  const ny = Math.max(2, Math.ceil((box.max.y - box.min.y) / cell) + 1);
  const nz = Math.max(2, Math.ceil((box.max.z - box.min.z) / cell) + 1);
  const ox = box.min.x;
  const oy = box.min.y;
  const oz = box.min.z;
  const vals = new Float32Array(nx * ny * nz);
  const I = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[I(i, j, k)] = field(ox + i * cell, oy + j * cell, oz + k * cell);

  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const C = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corners[c];
          cv[c] = vals[I(i + a, j + b, k + d)];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [e0, e1] of edges) {
          const v0 = cv[e0];
          const v1 = cv[e1];
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          const c0 = corners[e0];
          const c1 = corners[e1];
          sx += c0[0] + (c1[0] - c0[0]) * t;
          sy += c0[1] + (c1[1] - c0[1]) * t;
          sz += c0[2] + (c1[2] - c0[2]) * t;
          n++;
        }
        cellVert[C(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
      }
    }
  }

  // Quads: for each grid edge with a sign change, join the four cells around it.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v = vals[I(i, j, k)] < 0;
        // x edge (i,j,k)-(i+1,j,k): cells around share j-1..j, k-1..k
        if (i < nx - 1 && v !== vals[I(i + 1, j, k)] < 0) {
          quad(cellVert[C(i, j - 1, k - 1)], cellVert[C(i, j, k - 1)], cellVert[C(i, j, k)], cellVert[C(i, j - 1, k)], !v);
        }
        if (j < ny - 1 && v !== vals[I(i, j + 1, k)] < 0) {
          quad(cellVert[C(i - 1, j, k - 1)], cellVert[C(i - 1, j, k)], cellVert[C(i, j, k)], cellVert[C(i, j, k - 1)], !v);
        }
        if (k < nz - 1 && v !== vals[I(i, j, k + 1)] < 0) {
          quad(cellVert[C(i - 1, j - 1, k)], cellVert[C(i, j - 1, k)], cellVert[C(i, j, k)], cellVert[C(i - 1, j, k)], !v);
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  const P = new Float32Array(pos);
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(idx);
  // Normals from the field's gradient: smooth, and exactly matching the sculpted shape.
  const N = new Float32Array(P.length);
  const e = cell * 0.5;
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v];
    const y = P[v + 1];
    const z = P[v + 2];
    const gx = field(x + e, y, z) - field(x - e, y, z);
    const gy = field(x, y + e, z) - field(x, y - e, z);
    const gz = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    N[v] = gx / l;
    N[v + 1] = gy / l;
    N[v + 2] = gz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}

/**
 * Skin weights from blobs: each vertex follows the bones of the blobs nearest it,
 * blending across joints. Returns per-vertex skin bones and weights (4 each).
 */
export function blobWeights(g: THREE.BufferGeometry, blobs: Blob[], softness = 0.02) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const bones: THREE.Object3D[] = [];
  for (const bl of blobs) if (!bl.carve && !bones.includes(bl.bone)) bones.push(bl.bone);
  const n = pos.count;
  const skinBones: THREE.Object3D[][] = [];
  const skinWeights = new Float32Array(n * 4);
  const per = new Float32Array(bones.length);
  for (let v = 0; v < n; v++) {
    per.fill(0);
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    let best = Infinity;
    const ds: number[] = [];
    for (const bl of blobs) {
      const d = bl.carve ? Infinity : blobDistance(bl, x, y, z);
      ds.push(d);
      best = Math.min(best, d);
    }
    blobs.forEach((bl, i) => {
      if (bl.carve) return;
      const w = Math.exp(-(ds[i] - best) / softness);
      const b = bones.indexOf(bl.bone);
      per[b] = Math.max(per[b], w);
    });
    const order = [...per.keys()].sort((a, b) => per[b] - per[a]).slice(0, 4);
    let sum = 0;
    for (const o of order) sum += per[o];
    const list: THREE.Object3D[] = [];
    order.forEach((o, s) => {
      list.push(bones[o]);
      skinWeights[v * 4 + s] = per[o] / sum;
    });
    while (list.length < 4) list.push(list[0]);
    skinBones.push(list);
  }
  return { skinBones, skinWeights };
}

/** A shell (garment) around a field: grown by `thickness`, kept only where `region` <= 0. */
export function shell(body: Field, thickness: number, region: Field, edge = 0.004): Field {
  return (x, y, z) => smax(body(x, y, z) - thickness, region(x, y, z), edge);
}

/** Region helpers (negative inside). */
export const above = (h: number): Field => (_x, y) => h - y;
export const below = (h: number): Field => (_x, y) => y - h;
export const slab = (lo: number, hi: number): Field => (_x, y) => Math.max(lo - y, y - hi);
export const inter = (...fs: Field[]): Field => (x, y, z) => fs.reduce((m, f) => Math.max(m, f(x, y, z)), -1e9);
export const minus = (a: Field, b: Field): Field => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));

/** March from inside a field outward along a ray to the surface (for decals and buttons). */
export function surfacePoint(field: Field, from: Vec, dir: Vec, maxDist = 0.5): Vec | null {
  let t = 0;
  const p = new THREE.Vector3();
  // Step outward until outside, then bisect.
  let prev = field(from.x, from.y, from.z);
  if (prev > 0) return null;
  const step = 0.004;
  while (t < maxDist) {
    t += step;
    p.copy(from).addScaledVector(dir, t);
    const d = field(p.x, p.y, p.z);
    if (d > 0) {
      let lo = t - step;
      let hi = t;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        p.copy(from).addScaledVector(dir, mid);
        if (field(p.x, p.y, p.z) > 0) hi = mid;
        else lo = mid;
      }
      return p.copy(from).addScaledVector(dir, hi).clone();
    }
    prev = d;
  }
  return null;
}
