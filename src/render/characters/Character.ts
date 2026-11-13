import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Atmosphere } from '../sky/Atmosphere';
import {
  capeSheet,
  footParts,
  forearmParts,
  headParts,
  hipParts,
  mantleParts,
  shinParts,
  thighParts,
  torsoParts,
  upperArmParts,
} from './body';
import { EXPRESSIONS, EXPRESSION_NAMES, Eyes, FACE_PHI_LEN, FACE_THETA_LEN, FACE_THETA_TOP, faceAtlas, faceMaterial, type Expression } from './face';
import { buildHair, cowlickRoot } from './hair';
import { figureMantle, figureParts, sculptedFacePatch, sculptedSkull } from './figure';
import { Mat, characterMaterials, faceLight, type CharacterMaterials } from './materials';
import { V, colored, detail, faceNormals, headShape, part, type ColorFn, type Part } from './shapes';
import type { Look, Personality } from './looks';

export { updateCharacterLighting } from './materials';

/**
 * Code-built anime characters, made from a Look by the builder modules:
 *   body.ts (body and outfit), hair.ts (layered hair), face.ts (drawn faces with
 *   expressions), materials.ts (toon shading per surface), shapes.ts (geometry helpers).
 *
 * Skeleton: hips > torso > head / arms / two-part cape; hips > legs > shins > feet; plus
 * spring-driven secondary bones (back hair, cowlick). All parts are merged into a few
 * skinned meshes (body, cloth, outline) sharing one skeleton, plus the face: ~5 draw calls.
 *
 * Motion is procedural: eased speed, weight shift, counter-rotation, arm lag, leaning into
 * turns and acceleration, springs that overshoot and settle, an idle personality, talking
 * gestures, blinking and expressions. Units are metres; the model faces +z.
 */
type BoneMat = 'body' | 'cloth';
type Collected = { pivot: THREE.Object3D; parts: Part[]; mat: BoneMat };

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

function finalize(root: THREE.Object3D, items: Collected[], m: CharacterMaterials) {
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const lists: Record<BoneMat | 'outline', THREE.BufferGeometry[]> = { body: [], cloth: [], outline: [] };
  for (const it of items) {
    const bi = bones.indexOf(it.pivot as THREE.Bone);
    const mw = it.pivot.matrixWorld;
    for (const p of it.parts) {
      let g: THREE.BufferGeometry;
      if (p.skinBones) {
        // Sculpted: already in character space, with blended weights over several bones.
        g = colored(p.geo, p.color, p.mat, p.shade);
        const ref = g.attributes.aSkinRef as THREE.BufferAttribute;
        const wt = g.attributes.aSkinW as THREE.BufferAttribute;
        const idx = new Uint16Array(ref.count * 4);
        for (let i = 0; i < ref.count * 4; i++) idx[i] = Math.max(0, bones.indexOf(p.skinBones[ref.array[i]] as THREE.Bone));
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(wt.array), 4));
        g.deleteAttribute('aSkinRef');
        g.deleteAttribute('aSkinW');
      } else if (p.skinTo) {
        g = skin(colored(p.geo, p.color, p.mat, p.shade), bones.indexOf(p.skinTo as THREE.Bone));
      } else {
        g = skin(colored(p.geo, p.color, p.mat, p.shade).applyMatrix4(mw), bi);
      }
      lists[it.mat].push(g);
      if (p.outline !== false && it.mat === 'body') lists.outline.push(g.clone());
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

export interface CharacterOptions {
  /** Crowd characters use a smaller face texture. */
  crowd?: boolean;
}

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
  private faceU: ReturnType<typeof faceMaterial>['uniforms'];
  private personality: Personality;

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
  private talkAmt = 0;
  private nextMouth = 0;
  private mouthOpen = false;
  private gesture = { start: -Infinity, arm: 1 };
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
  /** While true, the mouth moves and the hands gesture now and then. */
  talking = false;
  /** Blink now and then (off for still screenshots). */
  autoBlink = true;

  static readonly HIP_HEIGHT = 0.78;
  /** Facial expressions this character can show. */
  static readonly EXPRESSIONS: readonly string[] = EXPRESSION_NAMES;
  expression: Expression = 'neutral';
  setExpression(name: string) {
    if ((EXPRESSION_NAMES as string[]).includes(name)) this.expression = name as Expression;
  }

  constructor(look: Look, atmosphere: Atmosphere, private seed = 0, options: CharacterOptions = {}) {
    const m = characterMaterials(atmosphere);
    const w = look.build ?? 1;
    detail.crowd = !!options.crowd;
    this.personality = look.personality ?? 'lively';
    const items: Collected[] = [];
    const bone = (pivot: THREE.Object3D, parts: Part[], mat: BoneMat = 'body') => {
      if (parts.length) items.push({ pivot, parts, mat });
    };
    this.root.name = 'character';
    this.root.add(this.hips);
    this.hips.position.y = Character.HIP_HEIGHT;
    this.hips.add(this.torso);
    const sculptedShape = look.shape === 'sculpted';
    if (!sculptedShape) bone(this.hips, hipParts(look, w));

    // Legs, with a foot bone so soles stay flat and toes push off.
    for (const side of [-1, 1]) {
      const thigh = new THREE.Bone();
      thigh.position.set(side * 0.085, -0.05, 0);
      this.hips.add(thigh);
      const shin = new THREE.Bone();
      shin.position.y = -0.37;
      thigh.add(shin);
      const foot = new THREE.Bone();
      foot.position.y = -0.345;
      shin.add(foot);
      if (!sculptedShape) {
        bone(thigh, thighParts(look));
        bone(shin, shinParts(look));
        bone(foot, footParts(look));
      }
      this.legs.push({ thigh, shin, foot });
    }

    if (!sculptedShape) bone(this.torso, torsoParts(look, w));

    // Arms hang from the shoulder line.
    for (const side of [-1, 1]) {
      const upper = new THREE.Bone();
      upper.position.set(side * (0.168 * w + 0.03), 0.425, 0);
      this.torso.add(upper);
      const fore = new THREE.Bone();
      fore.position.y = -0.25;
      upper.add(fore);
      if (!sculptedShape) {
        bone(upper, upperArmParts(look));
        bone(fore, forearmParts(look, side));
      }
      this.arms.push({ upper, fore });
    }

    // Head: shaped skull, ears, hat, layered hair, and the drawn face.
    this.head.position.y = 0.545;
    this.torso.add(this.head);
    const R = 0.163;
    const C = V(0, R * 0.95, 0);
    bone(this.head, headParts(look, C, R, !sculptedShape));
    if (sculptedShape) {
      // Sculpted figure: one smooth body with fitted clothes, and a sculpted head.
      this.root.updateMatrixWorld(true);
      const fb = {
        hips: this.hips, torso: this.torso, head: this.head,
        thighs: this.legs.map((l) => l.thigh), shins: this.legs.map((l) => l.shin), feet: this.legs.map((l) => l.foot),
        uppers: this.arms.map((a) => a.upper), fores: this.arms.map((a) => a.fore),
      };
      bone(this.root, figureParts(look, fb));
      if (look.cape) bone(this.root, figureMantle(look, fb));
      bone(this.head, [sculptedSkull(C, R, look)]);
    }
    const hair = buildHair(look.hairStyle, look.hair, C, R, !!look.hat);
    bone(this.head, hair.head);
    this.hairBack.position.set(0, C.y + R * 0.2, -R * 0.4);
    this.head.add(this.hairBack);
    bone(this.hairBack, hair.back);
    this.cowlick.position.copy(cowlickRoot(C, R));
    this.head.add(this.cowlick);
    bone(this.cowlick, hair.cowlick);

    const hairCol = new THREE.Color(look.hair);
    const bright = hairCol.r + hairCol.g + hairCol.b > 2.2;
    const atlas = faceAtlas({ iris: look.eyes, brow: hairCol.clone().multiplyScalar(bright ? 0.55 : 0.75).getStyle(), calm: look.calm, style: look.faceStyle, noseMark: !sculptedShape }, options.crowd ? 0.5 : 1);
    const face = faceMaterial(atlas);
    this.faceU = face.uniforms;
    atmosphere.patchMaterial(face.material);
    let fg: THREE.BufferGeometry;
    if (sculptedShape) {
      fg = sculptedFacePatch(C, R, FACE_PHI_LEN, FACE_THETA_TOP, FACE_THETA_LEN);
    } else {
      fg = new THREE.SphereGeometry(R * 1.006, options.crowd ? 16 : 24, options.crowd ? 10 : 14, Math.PI / 2 - FACE_PHI_LEN / 2, FACE_PHI_LEN, Math.PI / 2 - FACE_THETA_TOP, FACE_THETA_LEN);
      // Sphere uv runs the other way round from our canvas layout; mirror u.
      const uv = fg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      headShape(fg, R);
      fg.translate(C.x, C.y, C.z);
      faceNormals(fg, C, R);
    }
    const faceMesh = new THREE.Mesh(fg, face.material);
    faceMesh.renderOrder = 2;
    faceMesh.name = 'face';
    this.head.add(faceMesh);

    // Cape: two bones, so it can bend and trail.
    if (look.cape) {
      this.capeUpper = new THREE.Bone();
      this.capeUpper.position.set(0, 0.47, -0.128);
      this.torso.add(this.capeUpper);
      this.capeLower = new THREE.Bone();
      this.capeLower.position.y = -0.3;
      this.capeUpper.add(this.capeLower);
      const capeShade: ColorFn = (p) => 0.92 + 0.08 * THREE.MathUtils.smoothstep(p.y, -0.3, 0);
      bone(this.capeUpper, [part(capeSheet(0.3, 0.38 * w, 0.45 * w), look.cape, Mat.Cloth, { shade: capeShade, outline: false })], 'cloth');
      bone(this.capeLower, [part(capeSheet(0.3, 0.45 * w, 0.52 * w), look.cape, Mat.Cloth, { shade: (p) => 0.85 + 0.07 * THREE.MathUtils.smoothstep(p.y, -0.3, 0), outline: false })], 'cloth');
      if (!sculptedShape) bone(this.torso, mantleParts(look, w));
    }

    finalize(this.root, items, m);
    detail.crowd = false;

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

    // Personality sets the idle: lively characters bob and shift more, calm ones barely move.
    const pers = this.personality;
    const energy = pers === 'lively' ? 1.3 : pers === 'calm' ? 0.5 : 1;
    const shift = Math.sin(time * 0.55 * energy + this.seed) * idle * (pers === 'calm' ? 0.4 : 1);
    const breathe = Math.sin(time * (pers === 'calm' ? 1.4 : 2.0) + this.seed);
    const bounce = pers === 'lively' ? Math.max(0, Math.sin(time * 2.6 + this.seed)) ** 6 * idle : 0;

    // Hips: lowest just after each foot lands, highest mid-stance; rotate with the legs.
    const bob = Math.cos(2 * (p - 0.2));
    this.hips.position.y = Character.HIP_HEIGHT - 0.025 * w - 0.03 * run + (0.025 + 0.025 * run) * w * bob - Math.abs(shift) * 0.008 + bounce * 0.012;
    this.hips.position.x = Math.sin(p) * 0.015 * w * (1 - run * 0.5) + shift * 0.022;
    this.hips.rotation.y = Math.sin(p) * (0.14 + 0.08 * run) * w;
    this.hips.rotation.z = Math.cos(p) * 0.04 * w - shift * 0.04 - turn * 0.6;
    this.hips.rotation.x = 0;

    // Torso: counter-twists against the hips, leans with speed and acceleration, rolls into turns.
    this.torso.rotation.y = -Math.sin(p) * (0.22 + 0.12 * run) * w;
    this.torso.rotation.x = 0.05 * w + 0.16 * run + lean + breathe * 0.012 * idle + (pers === 'busy' ? 0.04 * idle : 0);
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
      const idleKnee = (i === 0 ? Math.max(0, shift) : Math.max(0, -shift)) + bounce * 0.5;
      l.shin.rotation.x = knee + idleKnee * 0.16;
      l.thigh.rotation.x -= idleKnee * 0.08;
      // Foot: stays roughly level, pushes off with the toes as the leg trails, lifts toes in the swing.
      const toeOff = Math.max(0, -c) * Math.max(0, -s) * 0.7 * w;
      l.foot.rotation.x = -(l.thigh.rotation.x + l.shin.rotation.x) * 0.85 + toeOff - swing * 0.15 * w;
      l.thigh.rotation.z = (i === 0 ? -1 : 1) * (0.02 + 0.02 * idle);
    });

    // Arms: swing opposite the legs, trailing a little behind; elbows bend more as they come forward.
    const AA = THREE.MathUtils.lerp(0.35, 0.95, run);
    // Idle hand habits: calm characters clasp their hands in front, busy ones rub them now and then.
    const rub = pers === 'busy' ? THREE.MathUtils.smoothstep(Math.sin(time * 0.35 + this.seed), 0.5, 0.9) * idle : 0;
    const clasp = (pers === 'calm' ? 1 : rub) * idle;
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      const q = p + i * Math.PI - 0.35;
      const s = Math.sin(q);
      const idleSway = Math.sin(time * 0.9 + this.seed + i * 1.3) * 0.035 * energy;
      a.upper.rotation.x = s * AA * w + (0.06 + idleSway) * idle + breathe * 0.01 * idle - clasp * 0.4;
      a.upper.rotation.z = side * (0.09 + 0.12 * run + 0.015 * breathe * idle) + side * shift * 0.03 * (i === 0 ? 1 : -1) - side * clasp * 0.08;
      // Turning the upper arm inward swings the bent forearm across the body, so the hands meet.
      a.upper.rotation.y = side * -0.1 * run - side * clasp * 0.85;
      a.fore.rotation.x = -(0.22 + 0.35 * w + 0.8 * run) - Math.max(0, -s) * 0.45 * w - clasp * 1.15 - rub * Math.sin(time * 9) * 0.08;
      a.fore.rotation.z = 0;
    });

    // Talking: the mouth flaps irregularly, the head bobs with the words, and now and then
    // one hand opens out in a gesture.
    this.talkAmt += ((this.talking ? 1 : 0) - this.talkAmt) * Math.min(1, dt * 8);
    if (this.talking && time > this.gesture.start + 2.4 && Math.sin(time * 1.7 + this.seed) > 0.97) {
      this.gesture = { start: time, arm: Math.sin(time * 3.1) > 0 ? 1 : 0 };
    }
    const gt = time - this.gesture.start;
    if (gt >= 0 && gt < 1.6 && idle > 0.5) {
      const g = THREE.MathUtils.smoothstep(gt, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(gt, 1.1, 1.6));
      const arm = this.arms[this.gesture.arm];
      const side = this.gesture.arm === 0 ? -1 : 1;
      arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -0.55, g);
      arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, side * 0.35, g);
      arm.fore.rotation.x = THREE.MathUtils.lerp(arm.fore.rotation.x, -1.2, g);
      arm.fore.rotation.z = THREE.MathUtils.lerp(0, -side * 0.4, g);
    }

    // Wave: one arm rises and waves, blended in and out over ~1.8 s.
    const wt = time - this.waveStart;
    if (wt >= 0 && wt < 1.8) {
      const g = THREE.MathUtils.smoothstep(wt, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(wt, 1.45, 1.8));
      const arm = this.arms[1];
      arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, 2.5, g);
      arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -0.25, g);
      arm.upper.rotation.y = THREE.MathUtils.lerp(arm.upper.rotation.y, 0, g);
      arm.fore.rotation.x = THREE.MathUtils.lerp(arm.fore.rotation.x, -0.35, g);
      arm.fore.rotation.z = Math.sin(wt * 11) * 0.45 * g;
    }
    // Raised hand: eased so it reads as a reaction, not a snap.
    this.raiseAmt += ((this.raised ? 1 : 0) - this.raiseAmt) * Math.min(1, dt * 7);
    if (this.raiseAmt > 0.001 && !(wt >= 0 && wt < 1.8)) {
      const g = this.raiseAmt;
      const arm = this.arms[1];
      arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, 2.75, g);
      arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -0.15, g);
      arm.upper.rotation.y = THREE.MathUtils.lerp(arm.upper.rotation.y, 0, g);
      arm.fore.rotation.x = THREE.MathUtils.lerp(arm.fore.rotation.x, -0.15, g);
      arm.fore.rotation.z = Math.sin(time * 6 + this.seed) * 0.12 * g;
    }
    const nod = wt >= 0 && wt < 0.7 ? Math.sin((wt / 0.7) * Math.PI) * 0.18 : 0;
    const speechBob = Math.sin(time * 7.3 + this.seed) * Math.sin(time * 2.1) * 0.03 * this.talkAmt;

    // Head: steadied against the body, leads into turns, glances around when idle; expressions tilt it.
    const ex = this.expression;
    const exTilt = ex === 'thinking' ? 0.14 : ex === 'worry' ? -0.06 : ex === 'happy' ? 0.06 : 0;
    const exPitch = ex === 'surprise' ? -0.08 : ex === 'worry' ? 0.06 : ex === 'thinking' ? -0.05 : 0;
    const wander = Math.sin(time * 0.31 * energy + this.seed) * 0.45 + Math.sin(time * 0.83 + this.seed * 2) * 0.15;
    const target = this.lookTarget ?? wander * idle * (pers === 'calm' ? 0.5 : 1);
    this.lookYaw += (target - this.lookYaw) * Math.min(1, dt * 3.5);
    this.head.rotation.y = this.lookYaw - (this.torso.rotation.y + this.hips.rotation.y) * 0.85 + this.yawRate * 0.07 * w;
    this.head.rotation.x = -this.torso.rotation.x * 0.7 + Math.sin(time * 0.5 + this.seed) * 0.04 * idle + nod + speechBob + exPitch + rub * 0.12;
    this.head.rotation.z = -this.torso.rotation.z * 0.6 - this.hips.rotation.z * 0.5 + Math.sin(time * 0.37 + this.seed) * 0.04 * idle + exTilt;

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

    // Face: expression, blinking, and the mouth while talking.
    const e = EXPRESSIONS[ex];
    if (time > this.nextBlink) {
      this.blinkUntil = time + 0.11;
      const r = Math.abs(Math.sin(time * 12.9898 + this.seed * 78.233)) % 1;
      this.nextBlink = time + 2 + r * 3.5;
    }
    const blinking = this.autoBlink && time < this.blinkUntil && e.eyes !== Eyes.Happy;
    this.faceU.uEyes.value = blinking ? Eyes.Closed : e.eyes;
    if (this.talking) {
      if (time > this.nextMouth) {
        this.mouthOpen = !this.mouthOpen;
        const r = Math.abs(Math.sin(time * 91.7 + this.seed)) % 1;
        this.nextMouth = time + (this.mouthOpen ? 0.07 + r * 0.08 : 0.05 + r * 0.1);
      }
    } else this.mouthOpen = false;
    this.faceU.uMouth.value = this.mouthOpen ? e.talk : e.mouth;
    this.faceU.uLight.value.copy(faceLight);
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
