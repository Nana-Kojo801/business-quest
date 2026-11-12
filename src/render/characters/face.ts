import * as THREE from 'three';

/**
 * Anime faces drawn on a canvas and wrapped onto the front of the head.
 * The texture is an atlas: left half eyes open, right half eyes closed (blink).
 *
 * Canvas layout matches a sphere patch spanning PHI_LEN radians across and
 * THETA_LEN radians down, starting THETA_TOP above the equator.
 */
export const FACE_PHI_LEN = 1.5;
export const FACE_THETA_TOP = 0.6;
export const FACE_THETA_LEN = 1.3;

const W = 512;
const H = 256;

/** Canvas coordinates for an angle offset from the face centre (radians right, radians down). */
function at(phiOff: number, thetaOff: number): [number, number] {
  return [W / 2 + (phiOff / FACE_PHI_LEN) * W, ((thetaOff + FACE_THETA_TOP) / FACE_THETA_LEN) * H];
}

export interface FaceStyle {
  iris: string;
  lash?: string;
  brow: string;
  /** Narrower, gentler eyes for older characters. */
  calm?: boolean;
}

function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, side: number, s: FaceStyle, open: boolean) {
  const lash = s.lash ?? '#241821';
  const ew = 60;
  const eh = s.calm ? 42 : 56;
  g.save();
  g.translate(cx, cy);
  if (!open) {
    // Closed: a soft downward curve with a little lash flick.
    g.strokeStyle = lash;
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-ew * 0.95, -2);
    g.quadraticCurveTo(0, eh * 0.38, ew * 0.95, -2);
    g.stroke();
    g.restore();
    return;
  }
  // Eye white, clipped to the eye shape.
  const shape = () => {
    g.beginPath();
    g.moveTo(-ew, -eh * 0.15);
    g.bezierCurveTo(-ew * 0.7, -eh * 1.0, ew * 0.75, -eh * 1.05, ew, -eh * 0.35);
    g.bezierCurveTo(ew * 0.85, eh * 0.75, -ew * 0.6, eh * 0.95, -ew, -eh * 0.15);
    g.closePath();
  };
  shape();
  g.fillStyle = '#fffaf6';
  g.fill();
  g.save();
  shape();
  g.clip();
  // Iris: tall ellipse, dark at the top fading to a bright lower half.
  const ix = side * -4;
  const grad = g.createLinearGradient(0, -eh, 0, eh);
  const iris = new THREE.Color(s.iris);
  const dark = iris.clone().multiplyScalar(0.35).getStyle();
  const light = iris.clone().lerp(new THREE.Color('#ffffff'), 0.35).getStyle();
  grad.addColorStop(0, dark);
  grad.addColorStop(0.45, iris.getStyle());
  grad.addColorStop(1, light);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(ix, eh * 0.08, ew * 0.56, eh * 0.95, 0, 0, Math.PI * 2);
  g.fill();
  // Iris ring and pupil.
  g.strokeStyle = dark;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#1a1018';
  g.beginPath();
  g.ellipse(ix, eh * 0.02, ew * 0.24, eh * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  // Shadow from the upper lid.
  g.fillStyle = 'rgba(40, 20, 50, 0.28)';
  g.beginPath();
  g.ellipse(0, -eh * 0.95, ew * 1.2, eh * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  // Highlights: a big soft one and a small sharp one.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(ix + side * -ew * 0.2 + ew * 0.1, -eh * 0.28, ew * 0.17, eh * 0.2, -0.4, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(ix + ew * 0.18, eh * 0.4, ew * 0.07, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Upper lash: thick, tapering, with a flick at the outer corner.
  g.fillStyle = lash;
  g.beginPath();
  const o = side; // outer corner direction
  g.moveTo(-ew * 1.02 * o, -eh * 0.1);
  g.bezierCurveTo(-ew * 0.7 * o, -eh * 1.1, ew * 0.7 * o, -eh * 1.15, ew * 1.1 * o, -eh * 0.45);
  g.lineTo(ew * 1.28 * o, -eh * 0.62);
  g.lineTo(ew * 1.05 * o, -eh * 0.25);
  g.bezierCurveTo(ew * 0.65 * o, -eh * 0.88, -ew * 0.6 * o, -eh * 0.85, -ew * 1.02 * o, -eh * 0.1);
  g.closePath();
  g.fill();
  // Lower lash: a thin partial line.
  g.strokeStyle = lash;
  g.globalAlpha = 0.7;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(ew * 0.75 * o, eh * 0.5);
  g.quadraticCurveTo(ew * 0.1 * o, eh * 0.85, -ew * 0.45 * o, eh * 0.72);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
}

function drawFace(g: CanvasRenderingContext2D, ox: number, s: FaceStyle, open: boolean) {
  g.save();
  g.translate(ox, 0);
  for (const side of [-1, 1]) {
    const [ex, ey] = at(side * 0.36, 0.06);
    // side -1 is the viewer's left (the character's right); the outer corner points away from centre.
    drawEye(g, ex, ey, side, s, open);
    // Brow: a thin arched stroke.
    const [bx, by] = at(side * 0.37, -0.27);
    g.strokeStyle = s.brow;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(bx - side * 34, by + (s.calm ? 4 : 8));
    g.quadraticCurveTo(bx, by - 6, bx + side * 36, by + 4);
    g.stroke();
    // Blush with a few soft hatch lines.
    const [cx, cy] = at(side * 0.5, 0.36);
    const bl = g.createRadialGradient(cx, cy, 2, cx, cy, 30);
    bl.addColorStop(0, 'rgba(255, 120, 130, 0.5)');
    bl.addColorStop(1, 'rgba(255, 120, 130, 0)');
    g.fillStyle = bl;
    g.beginPath();
    g.ellipse(cx, cy, 34, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(230, 90, 100, 0.55)';
    g.lineWidth = 2;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(cx + k * 9 - 4, cy + 5);
      g.lineTo(cx + k * 9 + 4, cy - 5);
      g.stroke();
    }
  }
  // Nose: a tiny shadow mark.
  const [nx, ny] = at(0.03, 0.3);
  g.strokeStyle = 'rgba(160, 90, 80, 0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(nx, ny - 5);
  g.lineTo(nx - 4, ny + 3);
  g.stroke();
  // Mouth: a small soft smile.
  const [mx, my] = at(0, 0.5);
  g.strokeStyle = '#8a3c44';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(mx - 14, my - 3);
  g.quadraticCurveTo(mx, my + 7, mx + 14, my - 3);
  g.stroke();
  g.restore();
}

export function createFaceTexture(style: FaceStyle): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  drawFace(g, 0, style, true);
  drawFace(g, W, style, false);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(0.5, 1);
  tex.anisotropy = 4;
  return tex;
}
