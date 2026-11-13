import * as THREE from 'three';
import { Mat } from './materials';
import { V, detail, part, strand, tr, type ColorFn, type Part } from './shapes';

/**
 * Layered anime hair: a smooth base shell over the skull, then broad ribbon locks laid
 * over it in layers (crown, fringe, side locks, back rows), each lock full along its
 * length and tapering to a point. The shine (the "halo") is drawn by the hair shader.
 *
 * Returns parts for three bones: the head, the springy back hair, and the cowlick.
 */
export type HairStyle = 'short' | 'bun' | 'long';

export interface HairParts {
  head: Part[];
  back: Part[];
  cowlick: Part[];
}

export function buildHair(style: HairStyle, color: string, C: THREE.Vector3, R: number, hasHat: boolean): HairParts {
  const out: HairParts = { head: [], back: [], cowlick: [] };
  // Darker underneath, at the nape and toward the tips; the halo shine is added in the shader.
  const shade: ColorFn = (p) => {
    const h = (p.y - C.y) / R;
    return 0.74 + 0.3 * THREE.MathUtils.smoothstep(h, -1.4, 0.7);
  };
  const lock = (g: THREE.BufferGeometry, outline = true) => part(g, color, Mat.Hair, { shade, outline });

  /** A point around the head centre: polar angle from the top, azimuth from the front (+z), radius factor k. */
  const sp = (polar: number, az: number, k = 1.07) =>
    V(C.x + Math.sin(polar) * Math.sin(az) * R * k, C.y + Math.cos(polar) * R * k, C.z + Math.sin(polar) * Math.cos(az) * R * k);
  /** A lock that follows the head from (p0, az0) to (p1, az1), lifting off the surface toward its tip. */
  const flow = (p0: number, az0: number, p1: number, az1: number, r0: number, lift = 0.06, k0 = 1.03, flat = 0.38) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      pts.push(sp(THREE.MathUtils.lerp(p0, p1, t), THREE.MathUtils.lerp(az0, az1, t), k0 + 0.05 * Math.sin(t * Math.PI) + lift * t * t));
    }
    return strand(pts, r0, 0.003, flat, 12, 6, C);
  };

  // Base shell: covers the crown and back, leaving the forehead open below a high hairline.
  const cap = new THREE.SphereGeometry(R * 1.035, 28, 14, 0, Math.PI * 2, 0, Math.PI * (style === 'long' ? 0.56 : 0.5));
  cap.rotateX(-0.62);
  cap.translate(C.x, C.y + 0.004, C.z - 0.008);
  out.head.push(lock(cap));

  if (!hasHat) {
    // Crown: locks radiating from the crown over the shell, giving the top its chunky silhouette.
    const crown = (style === 'bun' ? 6 : 9) - (detail.crowd ? 3 : 0);
    for (let i = 0; i < crown; i++) {
      const az = (i / crown) * Math.PI * 2 + 0.3;
      const frontish = Math.cos(az); // 1 = front
      const end = 1.05 + 0.35 * (1 - frontish) * 0.5 + ((i * 7) % 3) * 0.05;
      out.head.push(lock(flow(0.24, az * 0.8, end, az, style === 'bun' ? 0.07 : 0.09, style === 'bun' ? 0.01 : 0.075, 1.035, 0.46), false));
    }
    if (style === 'short' && !detail.crowd) {
      // A few lively tufts sweeping up and back from the crown.
      for (const [az, len] of [[2.4, 0.9], [3.1, 1.05], [-2.6, 0.95]] as [number, number][]) {
        const root = sp(0.2, az, 1.0);
        const mid = sp(0.55, az, 1.17);
        const tip = sp(len, az + 0.15, 1.24);
        out.head.push(lock(strand([root, mid, tip], 0.06, 0.003, 0.5, 10, 6, C)));
      }
    }
  }

  // Fringe: separate pointed locks from the hairline over the forehead, ending at the brows.
  const parting = style === 'bun' ? 0.5 : style === 'long' ? 0 : 0.22;
  const fringe = (style === 'bun' ? 5 : style === 'long' ? 7 : 9) - (detail.crowd ? 2 : 0);
  for (let i = 0; i < fringe; i++) {
    const u = i / (fringe - 1) - 0.5; // -0.5..0.5 across the forehead
    const az = u * (style === 'long' ? 1.5 : 1.75);
    // Away from the parting the locks sweep outward; lengths vary for a hand-cut look.
    const sweep = (az - parting) * 0.18 + (style === 'bun' ? -0.25 : 0);
    // Alternate long and short locks, so the fringe has depth and a jagged, hand-cut edge.
    const len = 1.14 + Math.abs(u) * 0.3 + (i % 2) * 0.1 + ((i * 37) % 5) * 0.02 - (style === 'bun' ? 0.06 : 0);
    out.head.push(lock(flow(0.45, az * 0.75 + parting * 0.3, len, az + sweep, i % 2 ? 0.05 : 0.058, 0.0, 1.05 + (i % 2) * 0.012, 0.32)));
  }

  // Side locks framing the face, in front of the ears.
  for (const side of [-1, 1]) {
    const n = style === 'long' ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const az = side * (1.18 + k * 0.26);
      const end = style === 'long' ? 2.2 + k * 0.1 : style === 'bun' ? 1.8 : 2.05 + k * 0.12;
      out.head.push(lock(flow(0.55, az * 0.95, end, az * 0.94, 0.058, 0.02, 1.05)));
    }
  }

  // Back rows: two layers of locks over the back of the head down to the nape.
  const rows = style === 'bun' || detail.crowd ? 1 : 2;
  for (let row = 0; row < rows; row++) {
    const n = 9 - row;
    for (let i = 0; i < n; i++) {
      const az = Math.PI + (i / (n - 1) - 0.5) * (2.5 - row * 0.4);
      const end = style === 'short' ? 1.98 + row * 0.1 + (i % 2) * 0.08 : style === 'bun' ? 1.75 : 1.95;
      // The inner row is covered by the outer one at the edges: no outline needed.
      out.head.push(lock(flow(0.4 + row * 0.35, az, end, az, 0.075, style === 'short' ? 0.08 : 0.02, 1.05 + row * 0.02), rows === 1 || row === 1));
    }
  }

  if (style === 'short') {
    // Flicked-out tufts at the nape.
    for (const s of [-1, -0.35, 0.35, 1]) {
      const az = Math.PI + s * 0.55;
      const base = sp(1.98, az, 1.05);
      out.head.push(lock(strand([base, base.clone().add(V(s * 0.02, -0.045, -0.03)), base.clone().add(V(s * 0.06, -0.06, -0.07))], 0.032, 0.003, 0.5, 8, 6)));
    }
  } else if (style === 'bun') {
    // A neat bun high at the back, wrapped by a ribbon, with two loose wisps.
    const bc = V(C.x, C.y + R * 0.72, C.z - R * 0.78);
    out.head.push(lock(tr(new THREE.SphereGeometry(0.078, 18, 14).scale(1, 0.92, 0.95), bc.x, bc.y, bc.z)));
    for (let i = 0; i < 5; i++) {
      // Spiral locks on the bun.
      const a = (i / 5) * Math.PI * 2;
      out.head.push(lock(strand([
        V(bc.x + Math.cos(a) * 0.05, bc.y + Math.sin(a) * 0.05, bc.z + 0.05),
        V(bc.x + Math.cos(a + 1.2) * 0.075, bc.y + Math.sin(a + 1.2) * 0.075, bc.z - 0.01),
        V(bc.x + Math.cos(a + 2.4) * 0.045, bc.y + Math.sin(a + 2.4) * 0.045, bc.z - 0.06),
      ], 0.03, 0.006, 0.6, 8, 5), false));
    }
    for (const side of [-1, 1]) {
      const az = side * 1.5;
      out.head.push(lock(flow(1.2, az, 2.25, az * 0.92, 0.022, 0.06, 1.06, 0.5)));
    }
  } else if (style === 'long') {
    // Long hair hangs from the back of the head on its own springy bone (origin there).
    for (let i = 0; i < 11; i++) {
      const x = (i / 10 - 0.5) * 0.28;
      const len = 0.58 + Math.sin(i * 1.7) * 0.04;
      const g = strand([V(x * 0.6, 0.02, 0.0), V(x * 0.95, -0.12, -0.07), V(x * 1.08, -len * 0.6, -0.065), V(x * 1.02, -len, -0.02)], 0.06, 0.008, 0.42, 14, 6);
      out.back.push(lock(g));
    }
  }

  // Cowlick: one springy lock standing up from the crown (bone origin at its root).
  if (!hasHat && style === 'short') {
    out.cowlick.push(lock(strand([V(0, 0, 0), V(0.01, 0.05, 0.01), V(0.035, 0.085, 0.04), V(0.065, 0.075, 0.075)], 0.022, 0.003, 0.5, 12, 6)));
  }
  return out;
}

/** Where the cowlick grows, in head space. */
export function cowlickRoot(C: THREE.Vector3, R: number) {
  const polar = 0.12;
  const az = 0.6;
  return V(C.x + Math.sin(polar) * Math.sin(az) * R * 1.02, C.y + Math.cos(polar) * R * 1.02, C.z + Math.sin(polar) * Math.cos(az) * R * 1.02);
}
