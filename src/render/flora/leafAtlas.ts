import * as THREE from 'three';

/**
 * Hand-drawn foliage, drawn in code at startup: a 512 x 256 atlas of two cells.
 *   cell 0: a cluster of leaves (broadleaf crowns)
 *   cell 1: a cluster of five-petal blossoms with a few leaves
 * R holds a brightness multiplier (each leaf shaded lighter toward its tip, with a darker
 * midrib and a thin darker outline, like an illustration); A holds the cut-out shape.
 * The colour itself comes from the tree, so one atlas serves every palette.
 */
export const LEAF_CELLS = 2;
const CELL = 256;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;
const grey = (v: number) => {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c},${c},${c})`;
};

/** An almond-shaped leaf from (0,0) along +x. */
function leafPath(ctx: Ctx, len: number, wid: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -wid * 0.62, len * 0.7, -wid * 0.5, len, 0);
  ctx.bezierCurveTo(len * 0.7, wid * 0.5, len * 0.25, wid * 0.62, 0, 0);
  ctx.closePath();
}

function drawLeaf(lum: Ctx, mask: Ctx, x: number, y: number, ang: number, len: number, wid: number, shade: number) {
  for (const ctx of [lum, mask]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    leafPath(ctx, len, wid);
    if (ctx === mask) {
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, grey(shade * 0.78));
      g.addColorStop(0.75, grey(shade * 1.0));
      g.addColorStop(1, grey(shade * 1.06));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = grey(shade * 0.55);
      ctx.stroke();
      // Midrib.
      ctx.beginPath();
      ctx.moveTo(len * 0.08, 0);
      ctx.quadraticCurveTo(len * 0.5, wid * 0.05, len * 0.86, 0);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = grey(shade * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBlossom(lum: Ctx, mask: Ctx, x: number, y: number, rad: number, rot: number, shade: number) {
  for (const ctx of [lum, mask]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (let p = 0; p < 5; p++) {
      ctx.save();
      ctx.rotate((p / 5) * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(rad * 0.52, 0, rad * 0.52, rad * 0.36, 0, 0, Math.PI * 2);
      if (ctx === mask) {
        ctx.fillStyle = '#fff';
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, grey(shade * 0.8));
        g.addColorStop(1, grey(shade * 1.05));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = grey(shade * 0.78);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (ctx === lum) {
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = grey(shade * 0.75);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLeafCluster(lum: Ctx, mask: Ctx, ox: number, r: () => number) {
  const cx = ox + CELL / 2;
  const cy = CELL / 2;
  // Back leaves first (darker), front leaves last (lighter): the cluster has depth.
  const n = 15;
  for (let i = 0; i < n; i++) {
    const depth = i / (n - 1);
    const a = r() * Math.PI * 2;
    const d = r() * 34 * (1 - depth * 0.5);
    const len = 62 + r() * 30;
    const wid = 30 + r() * 12;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    // Point roughly outward from the centre so the outline is leafy.
    const ang = a + (r() - 0.5) * 0.9;
    // Keep the tip inside the cell.
    const tipX = x + Math.cos(ang) * len;
    const tipY = y + Math.sin(ang) * len;
    const over = Math.max(0, Math.hypot(tipX - cx, tipY - cy) - 118);
    drawLeaf(lum, mask, x, y, ang, len - over, wid * (1 - over / len), 0.72 + depth * 0.28 + (r() - 0.5) * 0.08);
  }
}

function drawBlossomCluster(lum: Ctx, mask: Ctx, ox: number, r: () => number) {
  const cx = ox + CELL / 2;
  const cy = CELL / 2;
  // Blossoms only (no backing leaves, which read as dark blotches on a shaded crown):
  // many small flowers heaped into a rounded cluster.
  const n = 22;
  for (let i = 0; i < n; i++) {
    const depth = i / (n - 1);
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 82 * (1 - depth * 0.3);
    const rad = 17 + r() * 9;
    drawBlossom(lum, mask, cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.min(rad, 118 - d), r() * 6.28, 0.92 + depth * 0.14);
  }
}

let shared: THREE.DataTexture | null = null;

export function getLeafAtlas(): THREE.DataTexture {
  if (shared) return shared;
  const w = CELL * LEAF_CELLS;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = CELL;
    return c.getContext('2d')!;
  };
  const lum = make();
  const mask = make();
  // Brightness behind the shapes is mid-grey, so filtered edges don't darken.
  lum.fillStyle = grey(0.8);
  lum.fillRect(0, 0, w, CELL);
  mask.fillStyle = '#000';
  mask.fillRect(0, 0, w, CELL);
  drawLeafCluster(lum, mask, 0, rng(11));
  drawBlossomCluster(lum, mask, CELL, rng(23));

  const L = lum.getImageData(0, 0, w, CELL).data;
  const M = mask.getImageData(0, 0, w, CELL).data;
  const data = new Uint8Array(w * CELL * 4);
  for (let i = 0; i < w * CELL; i++) {
    data[i * 4] = L[i * 4];
    data[i * 4 + 1] = L[i * 4];
    data[i * 4 + 2] = L[i * 4];
    data[i * 4 + 3] = M[i * 4];
  }
  const tex = new THREE.DataTexture(data, w, CELL, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}
