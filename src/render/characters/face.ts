import * as THREE from 'three';

/**
 * Anime faces, drawn in code on a canvas and wrapped onto the front of the head.
 *
 * The face is layered so expressions combine: the shader picks one eye cell (eyes and
 * brows) for the upper face and one mouth cell, over a fixed layer of cheeks and nose.
 *
 * Atlas (1024 x 608):
 *   eye cells, 2 x 3 of 512 x 160 (the upper 62.5% of the face patch)
 *   cheek/nose layer 512 x 96 (the lower face), and 8 mouth cells of 128 x 64
 *
 * Canvas layout matches a sphere patch spanning PHI_LEN radians across and THETA_LEN
 * radians down, starting THETA_TOP above the head's equator.
 */
export const FACE_PHI_LEN = 1.5;
export const FACE_THETA_TOP = 0.6;
export const FACE_THETA_LEN = 1.3;

/** The face patch as drawn: W x H "face pixels". */
const W = 512;
const H = 256;
const EYE_H = 160; // eye cells cover face rows 0..160
const LOWER_H = H - EYE_H; // 96
const ATLAS_W = 1024;
const ATLAS_H = 608;
/** The mouth cell covers this box of the face (face pixels). */
const MOUTH_BOX = { x: 192, y: 176, w: 128, h: 64 };

export const enum Eyes {
  Open = 0,
  Closed = 1,
  Happy = 2,
  Wide = 3,
  Worried = 4,
  Thinking = 5,
}
export const enum Mouth {
  Smile = 0,
  Laugh = 1,
  O = 2,
  Wavy = 3,
  Hmm = 4,
  TalkMid = 5,
  TalkWide = 6,
  Soft = 7,
}

/** Expressions as eye + mouth (+ the mouth to flap to while talking). */
export const EXPRESSIONS = {
  neutral: { eyes: Eyes.Open, mouth: Mouth.Soft, talk: Mouth.TalkMid },
  smile: { eyes: Eyes.Open, mouth: Mouth.Smile, talk: Mouth.TalkWide },
  happy: { eyes: Eyes.Happy, mouth: Mouth.Laugh, talk: Mouth.TalkWide },
  surprise: { eyes: Eyes.Wide, mouth: Mouth.O, talk: Mouth.TalkWide },
  worry: { eyes: Eyes.Worried, mouth: Mouth.Wavy, talk: Mouth.TalkMid },
  thinking: { eyes: Eyes.Thinking, mouth: Mouth.Hmm, talk: Mouth.TalkMid },
} as const;
export type Expression = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as Expression[];

export interface FaceStyle {
  iris: string;
  lash?: string;
  brow: string;
  /** Narrower, gentler eyes for older characters. */
  calm?: boolean;
  /** Drawing style: anime (big glossy eyes), storybook (round, simple), soft (gentle almond eyes). */
  style?: 'anime' | 'storybook' | 'soft' | 'natural';
  /** Draw a little nose mark (heads without a sculpted nose). */
  noseMark?: boolean;
}

/** Face-pixel position for an angle offset from the face centre (radians right, radians down). */
function at(phiOff: number, thetaOff: number): [number, number] {
  return [W / 2 + (phiOff / FACE_PHI_LEN) * W, ((thetaOff + FACE_THETA_TOP) / FACE_THETA_LEN) * H];
}

const EYE_X = 0.36; // radians either side of centre
const EYE_Y = 0.06;

type G = CanvasRenderingContext2D;

/** Eye shape path (open eye), centred on the origin; o = outer corner direction (+1 right). */
function eyePath(g: G, ew: number, eh: number, o: number) {
  g.beginPath();
  g.moveTo(-ew * o, -eh * 0.12);
  g.bezierCurveTo(-ew * 0.72 * o, -eh * 1.02, ew * 0.72 * o, -eh * 1.08, ew * 1.02 * o, -eh * 0.38);
  g.bezierCurveTo(ew * 0.88 * o, eh * 0.72, -ew * 0.55 * o, eh * 0.95, -ew * o, -eh * 0.12);
  g.closePath();
}

interface EyeOpts {
  /** Fraction of the eye left open from the top (1 = fully open). */
  open: number;
  /** Iris offset as a fraction of eye width (glancing aside). */
  look: number;
  /** Iris scale (smaller for surprise). */
  iris: number;
  /** Outer corners tilt down (worry). */
  droop: number;
}

function drawOpenEye(g: G, s: FaceStyle, o: number, opts: EyeOpts) {
  const lash = s.lash ?? '#2a1820';
  const soft = s.style === 'soft';
  const ew = soft ? 52 : 58;
  const eh = (s.calm ? 40 : soft ? 44 : 54) * (0.6 + 0.4 * opts.open);
  g.save();
  g.rotate(opts.droop * o * 0.18);
  // White of the eye with a soft lid shadow.
  eyePath(g, ew, eh, o);
  g.fillStyle = '#fffbf7';
  g.fill();
  g.save();
  eyePath(g, ew, eh, o);
  g.clip();
  const ix = opts.look * ew - o * 3;
  const iy = eh * 0.1;
  const irx = ew * 0.55 * opts.iris;
  const iry = eh * 0.95 * opts.iris;
  const col = new THREE.Color(s.iris);
  const dark = col.clone().multiplyScalar(0.3).getStyle();
  const mid = col.getStyle();
  const light = col.clone().lerp(new THREE.Color('#ffffff'), 0.45).getStyle();
  // Iris: dark top, bright lower half, with a darker rim.
  const grad = g.createLinearGradient(0, iy - iry, 0, iy + iry);
  grad.addColorStop(0, dark);
  grad.addColorStop(0.42, mid);
  grad.addColorStop(1, light);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3.5;
  g.strokeStyle = dark;
  g.stroke();
  // A glow ring in the lower iris.
  g.strokeStyle = col.clone().lerp(new THREE.Color('#ffffff'), 0.7).getStyle();
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(ix, iy + iry * 0.18, irx * 0.62, iry * 0.55, 0, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.globalAlpha = 1;
  // Pupil.
  g.fillStyle = '#160c14';
  g.beginPath();
  g.ellipse(ix, iy - iry * 0.05, irx * 0.4, iry * 0.46, 0, 0, Math.PI * 2);
  g.fill();
  // Upper lid shadow across the white and the iris.
  g.fillStyle = 'rgba(60, 25, 55, 0.3)';
  g.beginPath();
  g.ellipse(0, -eh * 1.0, ew * 1.25, eh * 0.55, 0, 0, Math.PI * 2);
  g.fill();
  // Catchlights: a large soft one up and to the side, a small sharp one below.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(ix - o * irx * 0.32, iy - iry * 0.45, irx * 0.32, iry * 0.24, -0.5 * o, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(ix + o * irx * 0.36, iy + iry * 0.42, irx * 0.13, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // A partly shut eye: erase everything above the lid line (the skin of the head shows there).
  const lidY = -eh * 1.0 + (1 - opts.open) * eh * 0.9;
  if (opts.open < 0.99) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(-ew * 1.5 * o, -eh * 0.08);
    g.bezierCurveTo(-ew * 0.72 * o, lidY - eh * 0.04, ew * 0.7 * o, lidY - eh * 0.1, ew * 1.5 * o, -eh * 0.42);
    g.lineTo(ew * 1.5 * o, -eh * 2);
    g.lineTo(-ew * 1.5 * o, -eh * 2);
    g.closePath();
    g.fill();
    g.restore();
  }
  // Upper lash line: thick, tapering to a flick at the outer corner, with a few lash clumps.
  g.fillStyle = lash;
  g.beginPath();
  g.moveTo(-ew * 1.04 * o, -eh * 0.08);
  g.bezierCurveTo(-ew * 0.72 * o, lidY - eh * 0.08, ew * 0.7 * o, lidY - eh * 0.14, ew * 1.08 * o, -eh * 0.44);
  if (!soft) {
    g.lineTo(ew * 1.32 * o, -eh * 0.66);
    g.lineTo(ew * 1.24 * o, -eh * 0.42);
    g.lineTo(ew * 1.38 * o, -eh * 0.4);
  } else g.lineTo(ew * 1.16 * o, -eh * 0.5);
  g.lineTo(ew * 1.06 * o, -eh * 0.22);
  const th = soft ? 0.09 : 0.16; // lash thickness
  g.bezierCurveTo(ew * 0.66 * o, lidY + eh * th, -ew * 0.6 * o, lidY + eh * (th + 0.04), -ew * 1.04 * o, -eh * 0.08);
  g.closePath();
  g.fill();
  // Eyelid crease above the lashes.
  g.strokeStyle = soft ? 'rgba(120, 60, 60, 0)' : 'rgba(120, 60, 60, 0.55)';
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-ew * 0.55 * o, lidY - eh * 0.32);
  g.quadraticCurveTo(ew * 0.25 * o, lidY - eh * 0.5, ew * 0.85 * o, lidY - eh * 0.2);
  g.stroke();
  // Lower lash: a short soft line at the outer half.
  g.strokeStyle = lash;
  g.globalAlpha = 0.6;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(ew * 0.82 * o, eh * 0.45);
  g.quadraticCurveTo(ew * 0.2 * o, eh * 0.86, -ew * 0.35 * o, eh * 0.74);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
}

function drawClosedEye(g: G, s: FaceStyle, o: number, happy: boolean) {
  const lash = s.lash ?? '#2a1820';
  const ew = 58;
  g.strokeStyle = lash;
  g.lineCap = 'round';
  g.lineWidth = 6.5;
  g.beginPath();
  if (happy) {
    // ^ ^ : an upward arc.
    g.moveTo(-ew * 0.9, 10);
    g.quadraticCurveTo(0, -30, ew * 0.9, 10);
  } else {
    // Gently closed: a downward curve with a lash flick at the outer corner.
    g.moveTo(-ew * 0.95 * o, -2);
    g.quadraticCurveTo(0, 22, ew * 0.95 * o, -2);
    g.moveTo(ew * 0.95 * o, -2);
    g.lineTo(ew * 1.18 * o, -10);
  }
  g.stroke();
}

/** Brows: lift raises both, tilt raises the inner ends (worry) or lowers them (determined); arch for one raised brow. */
function drawBrow(g: G, s: FaceStyle, o: number, lift: number, tilt: number, arch: number) {
  g.fillStyle = s.brow;
  g.save();
  g.translate(0, -lift);
  g.rotate(-tilt * o * 0.25);
  // A tapered brush stroke, thicker at the inner end.
  g.beginPath();
  g.moveTo(-o * 34, 8 + (s.calm ? -2 : 0));
  g.quadraticCurveTo(o * 2, -8 - arch, o * 38, 4);
  g.quadraticCurveTo(o * 2, -1 - arch, -o * 34, 14);
  g.closePath();
  g.fill();
  g.restore();
}

/** Storybook eyes: round, filled with colour, big soft catchlights, a light lid line. */
function drawStorybookEye(g: G, s: FaceStyle, o: number, state: Eyes) {
  const lash = s.lash ?? '#2a1820';
  const ew = 30;
  const eh = (s.calm ? 34 : 42) * (state === Eyes.Wide ? 1.08 : 1);
  if (state === Eyes.Closed || state === Eyes.Happy) {
    g.strokeStyle = lash;
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.beginPath();
    if (state === Eyes.Happy) {
      g.moveTo(-ew * 1.05, 8);
      g.quadraticCurveTo(0, -26, ew * 1.05, 8);
    } else {
      g.moveTo(-ew * 1.05, 0);
      g.quadraticCurveTo(0, 18, ew * 1.05, 0);
    }
    g.stroke();
    return;
  }
  const open = state === Eyes.Thinking ? 0.6 : state === Eyes.Worried ? 0.88 : 1;
  const look = state === Eyes.Thinking ? 0.25 : 0;
  g.save();
  g.rotate(state === Eyes.Worried ? o * 0.12 : 0);
  const col = new THREE.Color(s.iris);
  const grad = g.createLinearGradient(0, -eh, 0, eh);
  grad.addColorStop(0, col.clone().multiplyScalar(0.18).getStyle());
  grad.addColorStop(0.55, col.clone().multiplyScalar(0.55).getStyle());
  grad.addColorStop(1, col.clone().lerp(new THREE.Color('#ffffff'), 0.15).getStyle());
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(look * ew, 0, ew, eh, 0, 0, Math.PI * 2);
  g.fill();
  // Catchlights.
  const hs = state === Eyes.Wide ? 0.75 : 1;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(look * ew - o * ew * 0.3, -eh * 0.38, ew * 0.36 * hs, eh * 0.26 * hs, -0.3 * o, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.85;
  g.beginPath();
  g.arc(look * ew + o * ew * 0.35, eh * 0.4, ew * 0.14 * hs, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // Partly shut: erase above the lid.
  const lidY = -eh + (1 - open) * eh * 1.6;
  if (open < 0.99) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(-ew * 2, -eh * 2, ew * 4, lidY + eh * 2);
    g.restore();
  }
  // Upper lid: a soft dark arc with one lash flick at the outer corner.
  g.strokeStyle = lash;
  g.lineCap = 'round';
  g.lineWidth = 5.5;
  g.beginPath();
  if (open < 0.99) {
    g.moveTo(-ew * 1.05, lidY);
    g.lineTo(ew * 1.05, lidY);
  } else g.ellipse(look * ew, 0, ew * 1.04, eh * 1.02, 0, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(o * ew * 0.88, lidY < -eh * 0.9 ? -eh * 0.62 : lidY);
  g.lineTo(o * ew * 1.28, (lidY < -eh * 0.9 ? -eh * 0.62 : lidY) - 10);
  g.stroke();
  g.restore();
}

/** Storybook brows: short, soft, rounded dashes. */
function drawStorybookBrow(g: G, s: FaceStyle, o: number, lift: number, tilt: number) {
  g.save();
  g.translate(0, -lift);
  g.rotate(-tilt * o * 0.3);
  g.fillStyle = s.brow;
  g.beginPath();
  g.ellipse(0, 0, 22, 5.5, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}


// --- Natural style: lifelike proportions, lined up with the sculpted head's features. ---
const N_EYE_X = 0.29; // radians from centre (the sculpted eye sockets)
const N_EYE_Y = -0.02;

/** Almond eye outline: upper lid arches highest a little inside the middle, lower lid flatter. */
function naturalEyePath(g: G, ew: number, up: number, down: number, o: number) {
  g.beginPath();
  g.moveTo(-ew * o, 1); // inner corner (toward the nose)
  g.bezierCurveTo(-ew * 0.55 * o, -up * 1.15, ew * 0.45 * o, -up * 1.1, ew * o, -up * 0.05);
  g.bezierCurveTo(ew * 0.55 * o, down * 1.05, -ew * 0.45 * o, down * 1.1, -ew * o, 1);
  g.closePath();
}

function drawNaturalEye(g: G, s: FaceStyle, o: number, state: Eyes) {
  const lash = s.lash ?? '#2b1b1e';
  // A little larger than life (as animated films do), keeping a natural almond shape.
  const ew = 49;
  const lid = 'rgba(110, 55, 50, 0.55)';
  if (state === Eyes.Closed || state === Eyes.Happy) {
    // Closed lids: the lash line curves down (relaxed) or up (smiling eyes, cheeks raised).
    g.strokeStyle = lash;
    g.lineCap = 'round';
    g.lineWidth = 4.5;
    g.beginPath();
    const c = state === Eyes.Happy ? -9 : 7;
    g.moveTo(-ew * o, 0);
    g.quadraticCurveTo(0, c, ew * o, state === Eyes.Happy ? -2 : 2);
    g.stroke();
    g.strokeStyle = lid;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-ew * 0.7 * o, c - 9);
    g.quadraticCurveTo(0, c - 15, ew * 0.8 * o, c - 7);
    g.stroke();
    return;
  }
  let up = 22;
  let down = 13;
  let look = 0;
  let irisR = 20;
  if (state === Eyes.Wide) { up = 26; down = 15; irisR = 17; }
  if (state === Eyes.Worried) { up = 16; }
  if (state === Eyes.Thinking) { up = 11; look = 0.3; }
  g.save();
  if (state === Eyes.Worried) g.rotate(o * 0.08);
  // White of the eye, with a soft shadow under the upper lid.
  naturalEyePath(g, ew, up, down, o);
  g.fillStyle = '#f6eee8';
  g.fill();
  g.save();
  naturalEyePath(g, ew, up, down, o);
  g.clip();
  // Iris: a deeper rim, lighter toward the pupil; mostly covered top and bottom by the lids.
  const col = new THREE.Color(s.iris);
  const cx = look * ew * o * (o > 0 ? 1 : -1) + o * 1.5;
  const cy = 0.5;
  const rg = g.createRadialGradient(cx, cy, irisR * 0.2, cx, cy, irisR);
  rg.addColorStop(0, col.clone().lerp(new THREE.Color('#ffffff'), 0.25).getStyle());
  rg.addColorStop(0.65, col.getStyle());
  rg.addColorStop(1, col.clone().multiplyScalar(0.4).getStyle());
  g.fillStyle = rg;
  g.beginPath();
  g.arc(cx, cy, irisR, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = col.clone().multiplyScalar(0.3).getStyle();
  g.lineWidth = 1.8;
  g.stroke();
  g.fillStyle = '#120a0c';
  g.beginPath();
  g.arc(cx, cy, irisR * 0.42, 0, Math.PI * 2);
  g.fill();
  // Lid shadow and one small catchlight.
  g.fillStyle = 'rgba(70, 30, 30, 0.28)';
  g.fillRect(-ew * 1.2, -up * 1.3, ew * 2.4, up * 0.75);
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.beginPath();
  g.arc(cx - irisR * 0.38, cy - irisR * 0.38, irisR * 0.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Upper lash line: thicker toward the outer corner, with a few short lashes.
  g.strokeStyle = lash;
  g.lineCap = 'round';
  g.lineWidth = 3.6;
  g.beginPath();
  g.moveTo(-ew * o, 1);
  g.bezierCurveTo(-ew * 0.55 * o, -up * 1.15, ew * 0.45 * o, -up * 1.1, ew * o, -up * 0.05);
  g.stroke();
  g.lineWidth = 2.2;
  for (const t of [0.55, 0.72, 0.88]) {
    const x = (t * 2 - 1) * ew * o;
    const y = -up * (1 - t * t) * 0.95 - up * 0.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + o * 5, y - 5);
    g.stroke();
  }
  // Lower lid: a fine soft line, and the pink inner corner.
  g.strokeStyle = 'rgba(90, 45, 45, 0.45)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-ew * 0.7 * o, down * 0.7);
  g.bezierCurveTo(-ew * 0.3 * o, down * 1.15, ew * 0.45 * o, down * 1.05, ew * 0.95 * o, 1);
  g.stroke();
  g.fillStyle = 'rgba(220, 120, 120, 0.6)';
  g.beginPath();
  g.ellipse(-ew * 0.93 * o, 1.5, 3, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  // Eyelid crease.
  g.strokeStyle = lid;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(-ew * 0.6 * o, -up - 6);
  g.quadraticCurveTo(ew * 0.1 * o, -up - 11, ew * 0.9 * o, -up * 0.4 - 6);
  g.stroke();
  g.restore();
}

/** Natural brows: a tapered shape (fuller at the inner end) with fine hair strokes. */
function drawNaturalBrow(g: G, s: FaceStyle, o: number, lift: number, tilt: number) {
  g.save();
  g.translate(0, -lift);
  g.rotate(-tilt * o * 0.22);
  g.fillStyle = s.brow;
  g.globalAlpha = 0.9;
  g.beginPath();
  g.moveTo(-o * 34, 5);
  g.quadraticCurveTo(-o * 6, -8, o * 34, 0);
  g.quadraticCurveTo(-o * 4, 1, -o * 34, 12);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.6;
  g.strokeStyle = s.brow;
  g.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const x = -o * 28 + o * i * 6.5;
    const y = 6 - Math.sin((i / 8) * Math.PI) * 7;
    g.beginPath();
    g.moveTo(x, y + 2);
    g.lineTo(x + o * 5, y - 2);
    g.stroke();
  }
  g.restore();
}

function drawNaturalEyes(g: G, s: FaceStyle, state: Eyes) {
  for (const side of [-1, 1]) {
    const [ex, ey] = at(side * N_EYE_X, N_EYE_Y);
    const [bx, by] = at(side * 0.3, -0.165);
    g.save();
    g.translate(ex, ey);
    drawNaturalEye(g, s, side, state);
    g.restore();
    g.save();
    g.translate(bx, by);
    const lift = state === Eyes.Wide ? 9 : state === Eyes.Happy ? 3 : state === Eyes.Thinking && side > 0 ? 7 : 0;
    const tilt = state === Eyes.Worried ? 1 : state === Eyes.Thinking && side < 0 ? -0.5 : 0;
    drawNaturalBrow(g, s, side, lift, tilt);
    g.restore();
  }
}

/** Natural mouths: lips rather than a line (cell centre lined up with the sculpted lips). */
function drawNaturalMouth(g: G, shape: Mouth) {
  const cx = 64;
  const cy = 43;
  const line = '#8a4048';
  const lip = 'rgba(205, 110, 115, 0.55)';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lowerLip = (w: number, y: number) => {
    g.fillStyle = lip;
    g.beginPath();
    g.ellipse(cx, y + 5, w * 0.62, 4.5, 0, 0, Math.PI * 2);
    g.fill();
  };
  const closed = (w: number, curve: number, tilt = 0) => {
    lowerLip(w, cy);
    g.strokeStyle = line;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(cx - w, cy - curve + tilt);
    g.quadraticCurveTo(cx, cy + curve * 0.6, cx + w, cy - curve - tilt);
    g.stroke();
  };
  const open = (w: number, h: number, curve: number, teeth: boolean) => {
    g.fillStyle = '#5a1e26';
    g.beginPath();
    g.moveTo(cx - w, cy - curve);
    g.quadraticCurveTo(cx, cy - curve - 2, cx + w, cy - curve);
    g.quadraticCurveTo(cx, cy + h, cx - w, cy - curve);
    g.closePath();
    g.fill();
    if (teeth) {
      g.save();
      g.clip();
      g.fillStyle = '#f6f0ea';
      g.fillRect(cx - w, cy - curve - 4, w * 2, 6);
      g.restore();
    }
    g.strokeStyle = line;
    g.lineWidth = 2.2;
    g.stroke();
    lowerLip(w, cy + h * 0.55);
  };
  switch (shape) {
    case Mouth.Soft: closed(19, 1.5); break;
    case Mouth.Smile: closed(21, 6); break;
    case Mouth.Laugh: open(19, 13, 4, true); break;
    case Mouth.O: g.fillStyle = '#5a1e26'; g.beginPath(); g.ellipse(cx, cy + 2, 6.5, 8, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = line; g.lineWidth = 2.2; g.stroke(); break;
    case Mouth.Wavy: closed(15, -3); break;
    case Mouth.Hmm: closed(14, 1, 3); break;
    case Mouth.TalkMid: open(14, 7, 1, true); break;
    case Mouth.TalkWide: open(16, 11, 2, true); break;
  }
}

function drawEyes(g: G, s: FaceStyle, state: Eyes) {
  if (s.style === 'natural') {
    drawNaturalEyes(g, s, state);
    return;
  }
  if (s.style === 'storybook') {
    for (const side of [-1, 1]) {
      const [ex, ey] = at(side * 0.33, EYE_Y + 0.02);
      const [bx, by] = at(side * 0.34, -0.26);
      g.save();
      g.translate(ex, ey);
      drawStorybookEye(g, s, side, state);
      g.restore();
      g.save();
      g.translate(bx, by);
      const lift = state === Eyes.Wide ? 12 : state === Eyes.Happy ? 5 : state === Eyes.Thinking && side > 0 ? 9 : 0;
      const tilt = state === Eyes.Worried ? 1 : state === Eyes.Thinking && side < 0 ? -0.4 : 0;
      drawStorybookBrow(g, s, side, lift, tilt);
      g.restore();
    }
    return;
  }
  for (const side of [-1, 1]) {
    const o = side; // outer corner points away from centre
    const [ex, ey] = at(side * EYE_X, EYE_Y);
    const [bx, by] = at(side * 0.37, -0.27);
    g.save();
    g.translate(ex, ey);
    if (state === Eyes.Closed) drawClosedEye(g, s, o, false);
    else if (state === Eyes.Happy) drawClosedEye(g, s, o, true);
    else {
      const opts: EyeOpts = { open: 1, look: 0, iris: 1, droop: 0 };
      if (state === Eyes.Wide) Object.assign(opts, { iris: 0.78 });
      if (state === Eyes.Worried) Object.assign(opts, { open: 0.9, droop: 1 });
      if (state === Eyes.Thinking) Object.assign(opts, { open: 0.62, look: 0.2 });
      drawOpenEye(g, s, o, opts);
    }
    g.restore();
    g.save();
    g.translate(bx, by);
    if (state === Eyes.Wide) drawBrow(g, s, o, 14, 0, 4);
    else if (state === Eyes.Worried) drawBrow(g, s, o, 6, 1, -2);
    else if (state === Eyes.Happy) drawBrow(g, s, o, 5, 0, 2);
    else if (state === Eyes.Thinking) drawBrow(g, s, o, side > 0 ? 10 : 0, side > 0 ? 0 : -0.5, side > 0 ? 6 : 0);
    else drawBrow(g, s, o, 0, 0, 0);
    g.restore();
  }
}

/** Cheeks and nose: the fixed lower-face layer. */
function drawLower(g: G, s: FaceStyle) {
  if (s.style === 'natural') {
    // Just a faint warmth over the cheekbones.
    for (const side of [-1, 1]) {
      const [cx, cy] = at(side * 0.5, 0.2);
      const bl = g.createRadialGradient(cx, cy, 2, cx, cy, 40);
      bl.addColorStop(0, 'rgba(240, 120, 120, 0.16)');
      bl.addColorStop(1, 'rgba(240, 120, 120, 0)');
      g.fillStyle = bl;
      g.beginPath();
      g.ellipse(cx, cy, 44, 26, 0, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  for (const side of [-1, 1]) {
    const [cx, cy] = at(side * 0.5, 0.36);
    const bl = g.createRadialGradient(cx, cy, 2, cx, cy, 32);
    bl.addColorStop(0, 'rgba(255, 120, 130, 0.45)');
    bl.addColorStop(1, 'rgba(255, 120, 130, 0)');
    g.fillStyle = bl;
    g.beginPath();
    g.ellipse(cx, cy, 36, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(230, 95, 105, 0.45)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let k = -1; k <= 1 && s.style !== 'storybook'; k++) {
      g.beginPath();
      g.moveTo(cx + k * 9 - 3, cy + 4);
      g.lineTo(cx + k * 9 + 3, cy - 4);
      g.stroke();
    }
  }
  // Nose: a small shadow under the tip (only on heads without a sculpted nose).
  if (s.noseMark === false) return;
  const [nx, ny] = at(0.025, 0.3);
  g.fillStyle = 'rgba(170, 95, 85, 0.5)';
  g.beginPath();
  g.ellipse(nx - 2, ny + 3, 5, 2.4, -0.3, 0, Math.PI * 2);
  g.fill();
}

/** One mouth shape, centred in a 128 x 64 cell. */
function drawMouth(g: G, shape: Mouth) {
  const cx = 64;
  const cy = 26;
  const line = '#7c3240';
  const inside = '#6b2633';
  const tongue = '#e4767c';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = line;
  g.lineWidth = 4;
  const open = (w: number, h: number, smile: number) => {
    g.beginPath();
    g.moveTo(cx - w, cy - smile);
    g.quadraticCurveTo(cx, cy + h * 1.6, cx + w, cy - smile);
    g.quadraticCurveTo(cx, cy - smile * 0.3 + h * 0.15, cx - w, cy - smile);
    g.closePath();
    g.fillStyle = inside;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = tongue;
    g.beginPath();
    g.ellipse(cx, cy + h * 1.15, w * 0.6, h * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.stroke();
  };
  switch (shape) {
    case Mouth.Smile:
      g.beginPath();
      g.moveTo(cx - 15, cy - 3);
      g.quadraticCurveTo(cx, cy + 9, cx + 15, cy - 3);
      g.stroke();
      break;
    case Mouth.Laugh:
      open(22, 15, 6);
      break;
    case Mouth.O:
      g.fillStyle = inside;
      g.beginPath();
      g.ellipse(cx, cy + 3, 8, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
    case Mouth.Wavy:
      g.beginPath();
      g.moveTo(cx - 14, cy + 3);
      g.quadraticCurveTo(cx - 7, cy - 3, cx, cy + 2);
      g.quadraticCurveTo(cx + 7, cy + 7, cx + 14, cy + 1);
      g.stroke();
      break;
    case Mouth.Hmm:
      g.beginPath();
      g.moveTo(cx - 6, cy + 2);
      g.quadraticCurveTo(cx + 4, cy + 4, cx + 13, cy - 1);
      g.stroke();
      break;
    case Mouth.TalkMid:
      open(11, 7, 1);
      break;
    case Mouth.TalkWide:
      open(15, 10, 3);
      break;
    case Mouth.Soft:
      g.beginPath();
      g.moveTo(cx - 11, cy);
      g.quadraticCurveTo(cx, cy + 5, cx + 11, cy);
      g.stroke();
      break;
  }
}

/** Atlas cell origins (atlas pixels). */
function eyeCell(i: number): [number, number] {
  return [(i % 2) * W, Math.floor(i / 2) * EYE_H];
}
const LOWER_ORIGIN: [number, number] = [0, EYE_H * 3];
function mouthCell(i: number): [number, number] {
  return [W + (i % 4) * MOUTH_BOX.w, EYE_H * 3 + Math.floor(i / 4) * MOUTH_BOX.h];
}

const cache = new Map<string, THREE.CanvasTexture>();

/** The face atlas for a style. Textures are shared between characters with the same style. */
export function faceAtlas(style: FaceStyle, scale = 1): THREE.CanvasTexture {
  const key = `${style.iris}|${style.brow}|${style.lash ?? ''}|${style.calm ? 1 : 0}|${style.style ?? 'anime'}|${style.noseMark === false ? 0 : 1}|${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ATLAS_W * scale);
  canvas.height = Math.round(ATLAS_H * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  for (let i = 0; i < 6; i++) {
    const [x, y] = eyeCell(i);
    g.save();
    g.beginPath();
    g.rect(x, y, W, EYE_H);
    g.clip();
    g.translate(x, y);
    drawEyes(g, style, i as Eyes);
    g.restore();
  }
  g.save();
  g.beginPath();
  g.rect(LOWER_ORIGIN[0], LOWER_ORIGIN[1], W, LOWER_H);
  g.clip();
  g.translate(LOWER_ORIGIN[0], LOWER_ORIGIN[1] - EYE_H);
  drawLower(g, style);
  g.restore();
  for (let i = 0; i < 8; i++) {
    const [x, y] = mouthCell(i);
    g.save();
    g.beginPath();
    g.rect(x, y, MOUTH_BOX.w, MOUTH_BOX.h);
    g.clip();
    g.translate(x, y);
    if (style.style === 'natural') drawNaturalMouth(g, i as Mouth);
    else drawMouth(g, i as Mouth);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, tex);
  return tex;
}

/**
 * Face material: picks the eye cell and mouth cell in the shader. Faces are lit softly
 * and evenly (anime faces never get a hard shadow line across them); uLight follows the
 * scene's brightness so they still darken at dusk.
 */
export function faceMaterial(map: THREE.Texture) {
  const uniforms = {
    uEyes: { value: 0 },
    uMouth: { value: Mouth.Soft as number },
    uLight: { value: new THREE.Color(1, 1, 1) },
  };
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEyes;\nuniform float uMouth;\nuniform vec3 uLight;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        {
          // vMapUv: face-patch coordinates, u across (0..1), v down from the top (0..1).
          vec2 f = vec2(vMapUv.x, 1.0 - vMapUv.y) * vec2(${W.toFixed(1)}, ${H.toFixed(1)});
          vec4 texel = vec4(0.0);
          const vec2 ATLAS = vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)});
          // Atlas pixel (x right, y down from the top) to texture uv (the canvas is flipped on upload).
          #define AT(px) vec2((px).x / ATLAS.x, 1.0 - (px).y / ATLAS.y)
          if (f.y < ${EYE_H.toFixed(1)}) {
            vec2 cell = vec2(mod(uEyes, 2.0) * ${W.toFixed(1)}, floor(uEyes / 2.0) * ${EYE_H.toFixed(1)});
            texel = texture2D(map, AT(cell + f));
          } else {
            vec2 lo = vec2(0.0, ${(EYE_H * 3).toFixed(1)}) + f - vec2(0.0, ${EYE_H.toFixed(1)});
            texel = texture2D(map, AT(lo));
            vec2 mb = f - vec2(${MOUTH_BOX.x.toFixed(1)}, ${MOUTH_BOX.y.toFixed(1)});
            if (mb.x >= 0.0 && mb.y >= 0.0 && mb.x < ${MOUTH_BOX.w.toFixed(1)} && mb.y < ${MOUTH_BOX.h.toFixed(1)}) {
              vec2 cell = vec2(${W.toFixed(1)} + mod(uMouth, 4.0) * ${MOUTH_BOX.w.toFixed(1)}, ${(EYE_H * 3).toFixed(1)} + floor(uMouth / 4.0) * ${MOUTH_BOX.h.toFixed(1)});
              vec4 mt = texture2D(map, AT(cell + mb));
              texel = vec4(mix(texel.rgb, mt.rgb, mt.a), max(texel.a, mt.a));
            }
          }
          diffuseColor *= texel;
          diffuseColor.rgb *= uLight;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'bq-face';
  return { material: m, uniforms };
}
