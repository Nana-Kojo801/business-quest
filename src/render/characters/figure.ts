import * as THREE from 'three';
import { Mat } from './materials';
import { above, below, blend, blobWeights, bounds, inter, minus, shell, slab, surfaceNets, surfacePoint, type Blob, type Field } from './sculpt';
import { V, detail, faceNormals, type Part } from './shapes';
import type { Look } from './looks';

/**
 * Sculpted figures: the body is one smooth form melted together from soft blobs (see
 * sculpt.ts), and the outfit is fitted shells of that same form, cut at hems and cuffs.
 * Built in the character's bind pose (character space), skinned to the skeleton with
 * weights that blend across joints, so elbows, knees and shoulders bend smoothly.
 */
export interface FigureBones {
  hips: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  thighs: THREE.Object3D[];
  shins: THREE.Object3D[];
  feet: THREE.Object3D[];
  uppers: THREE.Object3D[];
  fores: THREE.Object3D[];
}

const METAL = '#e8bb5e';

/** A sculpted part: the mesh in character space, with its skin bones and weights baked in. */
function sculpted(field: Field, blobs: Blob[], color: string, mat: Mat, cell: number, extra: Partial<Part> = {}, weightBlobs = blobs): Part {
  const g = surfaceNets(field, bounds(blobs, 0.04), cell);
  const { skinBones, skinWeights } = blobWeights(g, weightBlobs);
  const bones: THREE.Object3D[] = [];
  const ref = new Float32Array(skinBones.length * 4);
  skinBones.forEach((list, v) => {
    list.forEach((b, s) => {
      let i = bones.indexOf(b);
      if (i < 0) i = bones.push(b) - 1;
      ref[v * 4 + s] = i;
    });
  });
  g.setAttribute('aSkinRef', new THREE.BufferAttribute(ref, 4));
  g.setAttribute('aSkinW', new THREE.BufferAttribute(skinWeights, 4));
  return { geo: g, color, mat, skinBones: bones, ...extra };
}

const W = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());

/** The figure's blobs, placed from the skeleton's bind pose. */
function bodyBlobs(look: Look, b: FigureBones) {
  const w = look.build ?? 1;
  const hip = W(b.hips);
  const sh = b.uppers.map(W);
  const el = b.fores.map(W);
  const th = b.thighs.map(W);
  const kn = b.shins.map(W);
  const an = b.feet.map(W);
  const torso: Blob[] = [
    { kind: 'ellipsoid', a: V(0, hip.y + 0.34, 0.006), r: V(0.132 * w, 0.112, 0.094), k: 0, bone: b.torso },
    { kind: 'ellipsoid', a: V(0, hip.y + 0.16, 0), r: V(0.124 * w, 0.115, 0.09), k: 0.07, bone: b.torso },
  ];
  const shoulders: Blob[] = sh.map((p) => ({ kind: 'ellipsoid', a: V(p.x * 0.86, p.y - 0.012, 0), r: V(0.062, 0.055, 0.06), k: 0.06, bone: b.torso }) as Blob);
  const neck: Blob = { kind: 'capsule', a: V(0, hip.y + 0.42, 0), b: V(0, hip.y + 0.58, 0.006), r: 0.047, rb: 0.042, k: 0.05, bone: b.torso };
  const pelvis: Blob = { kind: 'ellipsoid', a: V(0, hip.y + 0.01, 0), r: V(0.138 * w, 0.1, 0.095), k: 0.06, bone: b.hips };
  const uppers: Blob[] = sh.map((p, i) => ({ kind: 'capsule', a: V(p.x, p.y - 0.005, 0), b: V(el[i].x * 1.02, el[i].y + 0.01, 0), r: 0.051, rb: 0.043, k: 0.03, bone: b.uppers[i] }) as Blob);
  const fores: Blob[] = el.map((p, i) => ({ kind: 'capsule', a: V(p.x * 1.02, p.y - 0.005, 0), b: V(p.x * 1.02, p.y - 0.18, 0.008), r: 0.043, rb: 0.034, k: 0.022, bone: b.fores[i] }) as Blob);
  const hands: Blob[] = el.flatMap((p, i) => {
    const side = i === 0 ? -1 : 1;
    const x = p.x * 1.02;
    return [
      // A soft mitten: palm and fingers in one rounded form, and a thumb.
      { kind: 'ellipsoid', a: V(x, p.y - 0.225, 0.01), r: V(0.03, 0.05, 0.036), k: 0.025, bone: b.fores[i] },
      { kind: 'capsule', a: V(x - side * 0.014, p.y - 0.21, 0.022), b: V(x - side * 0.03, p.y - 0.235, 0.04), r: 0.012, rb: 0.011, k: 0.012, bone: b.fores[i] },
    ] as Blob[];
  });
  const thighs: Blob[] = th.map((p, i) => ({ kind: 'capsule', a: V(p.x, p.y + 0.02, 0), b: V(kn[i].x, kn[i].y + 0.02, 0.008), r: 0.088, rb: 0.064, k: 0.06, bone: b.thighs[i] }) as Blob);
  const shins: Blob[] = kn.map((p, i) => ({ kind: 'capsule', a: V(p.x, p.y, 0.008), b: V(an[i].x, an[i].y + 0.06, 0), r: 0.062, rb: 0.048, k: 0.035, bone: b.shins[i] }) as Blob);
  const feet: Blob[] = an.map((p, i) => ({ kind: 'ellipsoid', a: V(p.x, 0.048, 0.04), r: V(0.062, 0.05, 0.105), k: 0.04, bone: b.feet[i] }) as Blob);
  return { torso, shoulders, neck, pelvis, uppers, fores, hands, thighs, shins, feet, hipY: hip.y, w, el, sh, kn };
}

/** Body and outfit parts for a sculpted figure. */
export function figureParts(look: Look, b: FigureBones): Part[] {
  const B = bodyBlobs(look, b);
  const cell = detail.crowd ? 0.017 : 0.0125;
  const out: Part[] = [];
  const all = [...B.torso, ...B.shoulders, B.neck, B.pelvis, ...B.uppers, ...B.fores, ...B.hands, ...B.thighs, ...B.shins, ...B.feet];
  const body = blend(all);
  const waist = B.hipY + 0.11;
  const elbowY = B.el[0].y + 0.015;
  const armX = Math.abs(B.sh[0].x) * 0.8;

  // Skin: only where it shows (neck, forearms, hands); it runs a little under every garment edge.
  const skinRegion: Field = (x, y) => Math.min(Math.max(B.hipY + 0.4 - y, Math.abs(x) - 0.08), Math.max(y - (elbowY + 0.02), armX - Math.abs(x)));
  out.push(sculpted(inter(body, skinRegion), all, look.skin, Mat.Skin, cell));

  // Shirt: torso and sleeves to the elbow.
  const shirtBlobs = [...B.torso, ...B.shoulders, B.neck, ...B.uppers];
  const shirtField = blend(shirtBlobs);
  const shirtCut: Field = (x, y) => (Math.abs(x) > armX ? elbowY - y : waist - 0.03 - y);
  const neckCut = below(B.hipY + 0.47);
  out.push(sculpted(shell(shirtField, 0.006, inter(shirtCut, neckCut)), shirtBlobs, look.top, Mat.Cloth, cell));
  // Collar: a soft band around the neck.
  out.push(sculpted(shell(blend([B.neck]), 0.011, slab(B.hipY + 0.415, B.hipY + 0.455)), [B.neck], look.top, Mat.Cloth, cell * 0.8));

  // Tunic skirt from the waist, flaring with soft folds to above the knee (or a long robe).
  const robe = !!look.robe;
  const hem = robe ? 0.04 : B.hipY - 0.24;
  const flareR = (robe ? 0.29 : 0.22) * B.w;
  const skirtBlob: Blob = { kind: 'capsule', a: V(0, waist, 0), b: V(0, hem - 0.05, 0), r: 0.135 * B.w, rb: flareR, k: 0, bone: b.hips };
  const skirtBase = blend([skirtBlob]);
  const skirt: Field = (x, y, z) => {
    const t = THREE.MathUtils.clamp((waist - y) / (waist - hem), 0, 1);
    const a = Math.atan2(x, z);
    return skirtBase(x, y, z * 1.12) - 0.012 * t * Math.sin(a * 8) - 0.006 * t * Math.sin(a * 13 + 1);
  };
  out.push(sculpted(inter(skirt, slab(hem, waist + 0.01)), [skirtBlob], look.top, Mat.Cloth, cell));
  // Hem band.
  out.push(sculpted(inter((x, y, z) => skirt(x, y, z) - 0.005, slab(hem, hem + 0.025)), [skirtBlob], look.accent, Mat.Cloth, cell));

  // Vest: open at the front, no sleeves.
  if (look.vest !== false && !robe) {
    const vestBlobs = [...B.torso];
    const opening: Field = (x, y, z) => Math.max(Math.abs(x) - (0.03 + (y - waist) * 0.12), -z);
    const vest = minus(shell(blend(vestBlobs), 0.015, slab(waist - 0.02, B.hipY + 0.43)), opening);
    out.push(sculpted(vest, vestBlobs, look.accent, Mat.Cloth, cell));
    // Gold buttons on the shirt, between the vest's edges.
    for (const dy of [0.25, 0.32, 0.39]) {
      const p = surfacePoint(shirtField, V(0, B.hipY + dy, 0), V(0, 0, 1));
      if (p) out.push({ geo: new THREE.SphereGeometry(0.009, 10, 8).scale(1, 1, 0.55).translate(p.x, p.y, p.z + 0.006), color: METAL, mat: Mat.Metal, outline: false, skinTo: b.torso });
    }
  }

  // Leather belt with a gold buckle.
  const beltBlobs = [...B.torso, B.pelvis];
  const beltField = blend(beltBlobs);
  out.push(sculpted(shell(beltField, 0.013, slab(waist - 0.035, waist - 0.005)), beltBlobs, look.belt ?? '#6b4630', Mat.Leather, cell * 0.8));
  const bp = surfacePoint(beltField, V(0, waist - 0.02, 0), V(0, 0, 1));
  if (bp) {
    out.push({ geo: new THREE.BoxGeometry(0.044, 0.034, 0.012).translate(bp.x, bp.y, bp.z + 0.016), color: METAL, mat: Mat.Metal, outline: false, skinTo: b.torso });
  }

  // Trousers down into the boots, then boots with a thick turned-over cuff and a dark sole.
  const legBlobs = [B.pelvis, ...B.thighs, ...B.shins];
  if (!robe) out.push(sculpted(shell(blend(legBlobs), 0.004, inter(above(0.2), below(waist - 0.02))), legBlobs, look.legs, Mat.Cloth, cell));
  const bootBlobs = [...B.shins, ...B.feet];
  const bootTop = robe ? 0.16 : 0.27;
  out.push(sculpted(shell(blend(bootBlobs), 0.009, below(bootTop)), bootBlobs, look.boots, Mat.Leather, cell));
  if (!robe) out.push(sculpted(shell(blend(B.shins), 0.017, slab(bootTop - 0.055, bootTop + 0.008)), B.shins, look.boots, Mat.Leather, cell, { shade: () => 1.14 }));
  out.push(sculpted(shell(blend(B.feet), 0.012, below(0.012)), B.feet, '#2a1c16', Mat.Leather, cell, { outline: false }));

  // Leather bracers at the wrists.
  if (!robe) {
    out.push(sculpted(shell(blend(B.fores), 0.007, slab(B.el[0].y - 0.175, B.el[0].y - 0.115)), B.fores, look.cuffs ?? look.belt ?? '#6b4630', Mat.Leather, cell * 0.8));
  }
  return out;
}

/** Mantle over the shoulders and back, open at the front (for a cape). */
export function figureMantle(look: Look, b: FigureBones): Part[] {
  const B = bodyBlobs(look, b);
  const blobs = [...B.torso, ...B.shoulders];
  const open: Field = (x, _y, z) => Math.max(Math.abs(x) - 0.065, -z);
  const mantle = minus(shell(blend(blobs), 0.013, above(B.hipY + 0.35)), open);
  const part = sculpted(mantle, blobs, look.cape!, Mat.Cloth, detail.crowd ? 0.017 : 0.0125);
  const clasp = surfacePoint(blend(blobs), V(0, B.hipY + 0.44, 0), V(0, 0, 1));
  const out: Part[] = [part];
  if (clasp) out.push({ geo: new THREE.SphereGeometry(0.02, 12, 10).scale(1, 1, 0.5).translate(clasp.x, clasp.y, clasp.z + 0.02), color: METAL, mat: Mat.Metal, outline: false, skinTo: b.torso });
  return out;
}

/** The sculpted head (cranium, full cheeks, a soft chin, a small nose, ears) as a field around C (head space). */
export function headField(C: THREE.Vector3, R: number) {
  const bone = new THREE.Object3D();
  const blobs: Blob[] = [
    { kind: 'ellipsoid', a: V(C.x, C.y + 0.012, C.z - 0.01), r: V(R * 1.0, R * 0.97, R * 0.98), k: 0, bone },
    { kind: 'ellipsoid', a: V(C.x - 0.056, C.y - 0.062, C.z + 0.058), r: V(0.068, 0.062, 0.066), k: 0.06, bone },
    { kind: 'ellipsoid', a: V(C.x + 0.056, C.y - 0.062, C.z + 0.058), r: V(0.068, 0.062, 0.066), k: 0.06, bone },
    { kind: 'ellipsoid', a: V(C.x, C.y - 0.102, C.z + 0.05), r: V(0.056, 0.05, 0.056), k: 0.06, bone },
    { kind: 'ellipsoid', a: V(C.x, C.y - 0.042, C.z + R * 0.955), r: V(0.0085, 0.009, 0.008), k: 0.024, bone },
    { kind: 'ellipsoid', a: V(C.x - R * 0.97, C.y - 0.022, C.z - 0.012), r: V(0.012, 0.03, 0.022), k: 0.016, bone },
    { kind: 'ellipsoid', a: V(C.x + R * 0.97, C.y - 0.022, C.z - 0.012), r: V(0.012, 0.03, 0.022), k: 0.016, bone },
  ];
  return { field: blend(blobs), blobs };
}

/** Skull mesh (head space) from the sculpted head field. */
export function sculptedSkull(C: THREE.Vector3, R: number, look: Look): Part {
  const { field, blobs } = headField(C, R);
  const g = surfaceNets(field, bounds(blobs, 0.03), detail.crowd ? 0.009 : 0.0062);
  faceNormals(g, C, R);
  return { geo: g, color: look.skin, mat: Mat.Skin };
}

/**
 * The face decal for a sculpted head: a grid of rays from the head centre, landing on
 * the sculpted surface (so the face wraps the cheeks and nose), with the same angular
 * layout as the face atlas.
 */
export function sculptedFacePatch(C: THREE.Vector3, R: number, phiLen: number, thetaTop: number, thetaLen: number, U = 34, Vn = 22) {
  const { field } = headField(C, R);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const e = 0.0015;
  for (let j = 0; j <= Vn; j++) {
    const v = j / Vn;
    const theta = Math.PI / 2 - thetaTop + v * thetaLen;
    for (let i = 0; i <= U; i++) {
      const u = i / U;
      const az = (0.5 - u) * phiLen;
      const dir = V(Math.sin(theta) * Math.sin(az), Math.cos(theta), Math.sin(theta) * Math.cos(az));
      const p = surfacePoint(field, C, dir, R * 2) ?? C.clone().addScaledVector(dir, R);
      // Lift just off the skin along the surface normal.
      const n = V(field(p.x + e, p.y, p.z) - field(p.x - e, p.y, p.z), field(p.x, p.y + e, p.z) - field(p.x, p.y - e, p.z), field(p.x, p.y, p.z + e) - field(p.x, p.y, p.z - e)).normalize();
      p.addScaledVector(n, 0.0012);
      pos.push(p.x, p.y, p.z);
      uv.push(u, 1 - v);
    }
  }
  for (let j = 0; j < Vn; j++) {
    for (let i = 0; i < U; i++) {
      const a = j * (U + 1) + i;
      const b2 = a + 1;
      const c = a + U + 1;
      const d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
