import * as THREE from 'three';
import { Mat } from './materials';
import { V, detail, faceNormals, folds, headShape, lathe, part, shoulders, smoothProfile, strand, tr, type ColorFn, type Part } from './shapes';
import type { Look } from './looks';

/**
 * Body and outfit parts for each bone, built from a Look. Every garment has a surface
 * type so it reads as what it is: cloth, leather (belts, boots, cuffs), metal (buckles,
 * clasps, trims) or skin. Positions are in each bone's own space (see Character).
 */
const shadeDown: ColorFn = (p) => 0.86 + 0.14 * THREE.MathUtils.smoothstep(p.y, -0.3, 0.1);
const DEFAULT_BELT = '#6b4630';
const METAL = '#e8bb5e';

const belt = (look: Look) => look.belt ?? DEFAULT_BELT;

/** Pelvis, belt, and the tunic skirt, apron or robe. */
export function hipParts(look: Look, w: number): Part[] {
  const out: Part[] = [
    part(lathe(smoothProfile([[0.001, -0.12], [0.1, -0.11], [0.145, -0.05], [0.152, 0.02], [0.144, 0.07]]), 22, 0.78), look.legs, Mat.Cloth),
    // Leather belt with a gold buckle.
    part(lathe([[0.154 * w, 0.03], [0.158 * w, 0.045], [0.156 * w, 0.065]], 26, 0.8), belt(look), Mat.Leather),
    part(tr(new THREE.BoxGeometry(0.046, 0.036, 0.014), 0, 0.048, 0.128 * w), METAL, Mat.Metal, { outline: false }),
    part(tr(new THREE.BoxGeometry(0.026, 0.018, 0.016), 0, 0.048, 0.129 * w), belt(look), Mat.Leather, { outline: false }),
  ];
  if (look.robe) {
    out.push(part(folds(lathe(smoothProfile([[0.152 * w, 0.06], [0.17 * w, -0.08], [0.23, -0.4], [0.27, -0.66], [0.276, -0.69]]), 26, 0.85), 10, 0.06, -0.05, -0.69), look.top, Mat.Cloth, { shade: shadeDown }));
    out.push(part(folds(lathe([[0.268, -0.6], [0.28, -0.695]], 26, 0.85), 10, 0.06, 0.2, -0.69), look.trim, Mat.Cloth, { outline: false }));
  } else {
    out.push(part(folds(lathe(smoothProfile([[0.153 * w, 0.06], [0.166 * w, -0.04], [0.2 * w, -0.17], [0.218 * w, -0.23]]), 24, 0.82), 8, 0.07, 0.0, -0.23), look.top, Mat.Cloth, { shade: shadeDown }));
    // Hem band.
    out.push(part(folds(lathe([[0.212 * w, -0.205], [0.222 * w, -0.235]], 24, 0.82), 8, 0.07, 0.17, -0.23), look.accent, Mat.Cloth, { outline: false }));
  }
  if (look.apron) {
    // Apron skirt: a curved sheet over the front, to the knee.
    out.push(part(curvedSheet(0.26, 0.34, 0.18 * w, 0.0, -0.32, 0.135 * w), look.apron, Mat.Cloth));
  }
  return out;
}

/** A sheet wrapped around the front of the body (apron panels). Width/height in metres. */
function curvedSheet(wTop: number, wBot: number, radius: number, yTop: number, yBot: number, zFront: number) {
  const g = new THREE.PlaneGeometry(1, 1, 8, 6);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // -0.5..0.5
    const t = 0.5 - pos.getY(i); // 0 top .. 1 bottom
    const width = THREE.MathUtils.lerp(wTop, wBot, t);
    const a = (u * width) / radius;
    const y = THREE.MathUtils.lerp(yTop, yBot, t);
    const flare = 1 + 0.25 * t;
    pos.setXYZ(i, Math.sin(a) * radius * flare, y, zFront - radius + Math.cos(a) * radius * flare + 0.012);
  }
  g.computeVertexNormals();
  return g;
}

export function thighParts(look: Look): Part[] {
  return [part(lathe(smoothProfile([[0.08, 0.05], [0.084, -0.05], [0.073, -0.25], [0.06, -0.37]]), 16), look.legs, Mat.Cloth)];
}

export function shinParts(look: Look): Part[] {
  return [
    part(lathe(smoothProfile([[0.06, 0.03], [0.064, -0.05], [0.055, -0.15]]), 16), look.legs, Mat.Cloth),
    // Boot shaft and a folded-over cuff.
    part(lathe(smoothProfile([[0.06, -0.13], [0.067, -0.17], [0.062, -0.26], [0.057, -0.345]]), 16), look.boots, Mat.Leather),
    part(lathe(smoothProfile([[0.064, -0.11], [0.074, -0.135], [0.071, -0.165]]), 16), look.boots, Mat.Leather, { shade: () => 1.12 }),
  ];
}

export function footParts(look: Look): Part[] {
  return [
    part(tr(new THREE.SphereGeometry(0.064, 18, 12).scale(0.92, 0.62, 1.8), 0, -0.018, 0.045), look.boots, Mat.Leather),
    // Sole and heel, darker.
    part(tr(lathe([[0.0005, -0.06], [0.058, -0.058], [0.06, -0.045], [0.0005, -0.043]], 18).scale(0.95, 1, 1.85), 0, 0, 0.045), '#2a1c16', Mat.Leather, { outline: false }),
  ];
}

/** Shirt with shaped shoulders, neck, collar, and the vest, apron bib or robe top. */
export function torsoParts(look: Look, w: number): Part[] {
  const profile = smoothProfile([[0.128, -0.02], [0.131, 0.08], [0.148, 0.2], [0.156, 0.29], [0.152, 0.37], [0.124, 0.44], [0.07, 0.49], [0.045, 0.515]]);
  const shirt = shoulders(lathe(profile, 26, 0.72), 0.42, 0.18).scale(w, 1, w);
  const out: Part[] = [
    part(shirt, look.top, Mat.Cloth, { shade: shadeDown }),
    part(lathe([[0.046, 0.46], [0.043, 0.59]], 16), look.skin, Mat.Skin),
    // Collar: a soft band hugging the neck.
    part(lathe(smoothProfile([[0.051, 0.475], [0.059, 0.5], [0.054, 0.528]]), 20), look.top, Mat.Cloth),
  ];
  if (look.robe) {
    // Robe: a trim band down the front and a capelet with a trimmed edge.
    out.push(part(tr(new THREE.BoxGeometry(0.05, 0.48, 0.016), 0, 0.22, 0.112 * w), look.trim, Mat.Cloth, { outline: false }));
    out.push(part(shoulders(folds(lathe(smoothProfile([[0.062, 0.51], [0.13, 0.475], [0.172, 0.42], [0.186, 0.36], [0.19, 0.33]]), 24, 0.78), 9, 0.045, 0.46, 0.33), 0.43, 0.12), look.accent, Mat.Cloth));
    out.push(part(folds(lathe([[0.185, 0.345], [0.194, 0.325]], 24, 0.78), 9, 0.045, 0.6, 0.33), look.trim, Mat.Metal, { outline: false }));
  } else if (look.vest !== false) {
    // Vest: open at the front, with leather edging.
    const gap = 0.46;
    const vp = smoothProfile([[0.142, 0.03], [0.146, 0.1], [0.161, 0.21], [0.168, 0.29], [0.16, 0.37], [0.134, 0.43]]);
    const vest = shoulders(lathe(vp, 26, 0.76, gap, Math.PI * 2 - gap * 2), 0.42, 0.12).scale(w, 1, w);
    out.push(part(vest, look.accent, Mat.Cloth));
    for (const side of [-1, 1]) {
      const pts = vp.filter((_, i) => i % 3 === 0).map(([r, y]) => V(Math.sin(side * gap) * r * w * 1.02, y, Math.cos(side * gap) * r * 0.76 * w * 1.02));
      out.push(part(strand(pts, 0.007, 0.007, 1, 10, 5), look.trim, Mat.Leather, { outline: false }));
    }
    // Two small gold buttons on the shirt placket.
    for (const y of [0.3, 0.38]) out.push(part(tr(new THREE.SphereGeometry(0.009, 8, 6).scale(1, 1, 0.5), 0, y, 0.113 * w), METAL, Mat.Metal, { outline: false }));
  }
  if (look.apron) {
    out.push(part(curvedSheet(0.17, 0.2, 0.15 * w, 0.36, 0.04, 0.112 * w), look.apron, Mat.Cloth));
    // Neck strap.
    out.push(part(strand([V(-0.07, 0.36, 0.1), V(-0.05, 0.47, 0.06), V(0, 0.52, -0.02), V(0.05, 0.47, 0.06), V(0.07, 0.36, 0.1)], 0.008, 0.008, 1, 14, 5), look.apron, Mat.Cloth, { outline: false }));
  }
  // A cloth sash across the chest (not with a robe or apron).
  if (!look.robe && !look.apron) {
    out.push(part(tr(new THREE.TorusGeometry(0.17 * w, 0.014, 6, 32).scale(1, 1, 0.8).rotateZ(0.5), 0, 0.27, 0).rotateY(Math.PI / 2).scale(0.76, 1, 1).rotateY(-Math.PI / 2), look.trim, Mat.Cloth, { outline: false }));
  }
  return out;
}

/** Upper arm: a sleeve that grows out of the shoulder line. */
export function upperArmParts(look: Look): Part[] {
  return [
    part(tr(new THREE.SphereGeometry(0.052, 16, 12).scale(1, 0.85, 0.92), 0, -0.01, 0), look.top, Mat.Cloth),
    part(lathe(smoothProfile([[0.05, 0.005], [0.051, -0.05], [0.047, -0.14], [0.043, -0.25]]), 16), look.top, Mat.Cloth, { shade: shadeDown }),
  ];
}

/** Forearm (skin or a robe's bell sleeve), cuff, and a hand with fingers and thumb. */
export function forearmParts(look: Look, side: number): Part[] {
  const out: Part[] = [];
  if (look.robe) {
    out.push(part(lathe(smoothProfile([[0.047, 0.02], [0.056, -0.08], [0.07, -0.165], [0.074, -0.175]]), 18), look.top, Mat.Cloth));
    out.push(part(lathe([[0.07, -0.15], [0.076, -0.178]], 18), look.trim, Mat.Cloth, { outline: false }));
  } else {
    out.push(part(lathe(smoothProfile([[0.043, 0.02], [0.044, -0.05], [0.035, -0.17]]), 16), look.skin, Mat.Skin));
    out.push(part(lathe(smoothProfile([[0.046, -0.1], [0.05, -0.13], [0.048, -0.165]]), 16), look.cuffs ?? belt(look), Mat.Leather));
  }
  const hand = look.skin;
  // Palm, a row of slightly curled fingers, and a thumb (a little larger than life, anime-style).
  out.push(part(tr(new THREE.SphereGeometry(0.043, 12, 9).scale(0.8, 1.05, 0.52), 0, -0.205, 0.003), hand, Mat.Skin));
  if (detail.crowd) {
    // Crowd: a mitten (fingers together) and a thumb.
    out.push(part(tr(new THREE.SphereGeometry(0.036, 10, 8).scale(0.95, 1.2, 0.55).rotateX(-0.3), 0, -0.25, 0.008), hand, Mat.Skin, { outline: false }));
    out.push(part(tr(new THREE.CapsuleGeometry(0.0098, 0.03, 2, 5).rotateZ(side * 0.75).rotateX(-0.45), side * -0.032, -0.205, 0.018), hand, Mat.Skin, { outline: false }));
    return out;
  }
  for (let f = 0; f < 4; f++) {
    const x = (f - 1.5) * 0.016;
    const len = 0.036 - Math.abs(f - 1.2) * 0.005;
    const finger = new THREE.CapsuleGeometry(0.0088, len, 2, 6).rotateX(-0.35);
    out.push(part(tr(finger, x, -0.25 - len * 0.3, 0.009), hand, Mat.Skin, { outline: false }));
  }
  const thumb = new THREE.CapsuleGeometry(0.0098, 0.03, 2, 6).rotateZ(side * 0.75).rotateX(-0.45);
  out.push(part(tr(thumb, side * -0.032, -0.205, 0.018), hand, Mat.Skin, { outline: false }));
  return out;
}

/** Skull, ears and hat (the hair is built separately). C is the head centre, R its radius. */
export function headParts(look: Look, C: THREE.Vector3, R: number): Part[] {
  const skull = headShape(new THREE.SphereGeometry(R, detail.crowd ? 20 : 28, detail.crowd ? 14 : 20), R).translate(C.x, C.y, C.z);
  faceNormals(skull, C, R);
  const out: Part[] = [part(skull, look.skin, Mat.Skin)];
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.03, 12, 10).scale(0.38, 0.95, 0.72).rotateY(side * 0.35);
    out.push(part(tr(ear, side * R * 0.95, C.y - 0.012, -0.012), look.skin, Mat.Skin));
  }
  if (look.hat) {
    const brim = lathe(smoothProfile([[0.001, 0.0], [0.3, -0.008], [0.355, -0.03], [0.345, -0.005], [0.001, 0.016]]), 32);
    out.push(part(tr(brim, C.x, C.y + R * 0.72, C.z - 0.01), look.hat, Mat.Cloth));
    const crownPts = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0.18, -0.02), V(0.01, 0.34, -0.09), V(0.06, 0.44, -0.18)]);
    const crown = new THREE.TubeGeometry(crownPts, 18, 1, 20, false);
    const pos = crown.attributes.position as THREE.BufferAttribute;
    const frames = crownPts.computeFrenetFrames(18, false);
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const c = crownPts.getPointAt(t);
      const r = 0.17 * (1 - t) + 0.006;
      for (let j = 0; j <= 20; j++) {
        const a = (j / 20) * Math.PI * 2;
        const nn = frames.normals[i];
        const bb = frames.binormals[i];
        pos.setXYZ(i * 21 + j, c.x + r * (Math.cos(a) * nn.x + Math.sin(a) * bb.x), c.y + r * (Math.cos(a) * nn.y + Math.sin(a) * bb.y), c.z + r * (Math.cos(a) * nn.z + Math.sin(a) * bb.z));
      }
    }
    crown.computeVertexNormals();
    out.push(part(tr(crown, C.x, C.y + R * 0.72, C.z - 0.01), look.hat, Mat.Cloth));
    out.push(part(tr(lathe([[0.168, 0.0], [0.166, 0.045]], 24), C.x, C.y + R * 0.74, C.z - 0.01), look.trim, Mat.Metal, { outline: false }));
  }
  return out;
}

/** A cape panel: a sheet that widens toward the hem with a gentle curve and soft ripples. */
export function capeSheet(h: number, wTop: number, wBot: number) {
  const g = new THREE.PlaneGeometry(1, h, 8, 6);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) - h / 2;
    const t = -y / h;
    const width = THREE.MathUtils.lerp(wTop, wBot, t);
    const xx = x * width;
    pos.setXYZ(i, xx, y, -Math.pow(xx / (wBot * 0.5), 2) * 0.05 - Math.sin(x * Math.PI * 3) * 0.01 * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Mantle over the shoulders and back, open at the front and tied with a gold clasp (with a cape). */
export function mantleParts(look: Look, w: number): Part[] {
  const gap = 0.62; // half-width of the opening at the front, radians
  const mantle = lathe(smoothProfile([[0.066, 0.515], [0.15 * w, 0.465], [0.182 * w, 0.4], [0.186 * w, 0.365]]), 24, 0.8, gap, Math.PI * 2 - gap * 2);
  const out: Part[] = [part(folds(mantle, 7, 0.05, 0.46, 0.365), look.cape!, Mat.Cloth)];
  // Cords from the mantle's front edges to the clasp at the collar.
  for (const side of [-1, 1]) {
    const a = side * gap;
    const edge = V(Math.sin(a) * 0.12 * w, 0.47, Math.cos(a) * 0.12 * w * 0.8);
    out.push(part(strand([edge, V(side * 0.03, 0.48, 0.1), V(0, 0.475, 0.108)], 0.006, 0.006, 1, 8, 5), METAL, Mat.Metal, { outline: false }));
  }
  out.push(part(tr(new THREE.SphereGeometry(0.02, 12, 10).scale(1, 1, 0.5), 0, 0.475, 0.108), METAL, Mat.Metal, { outline: false }));
  return out;
}
