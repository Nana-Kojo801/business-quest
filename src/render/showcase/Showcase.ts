import * as THREE from 'three';
import { Character, updateCharacterLighting } from '../characters/Character';
import { LOOKS, villagerLook, type Look } from '../characters/looks';
import { Pipeline } from '../pipeline';
import { TIER_SETTINGS, type Tier } from '../quality';
import { Atmosphere } from '../sky/Atmosphere';
import { presetFromParams } from '../sky/presets';

/**
 * Character showcase (showcase.html): the cast under the game's real sky, light and
 * post-processing, on a turntable. For judging characters up close, and for previewing
 * new cast members made with the character builder.
 *
 * URL: ?who=player|merchant|keeper|villager1..3  ?view=full|face  ?yaw=<deg>
 *      ?anim=idle|walk|run|wave  ?expr=<expression>  ?quality=low|medium|high
 *      ?crowd=1 (build at crowd detail)  ?still=1 (no blinking, for screenshots)
 */
interface Entry {
  name: string;
  look: Look;
}

const CAST: Entry[] = [
  // Sample of the sculpted style (#40), in two face styles, beside the current hero.
  { name: 'hero-new', look: { ...LOOKS.player, shape: 'sculpted', faceStyle: 'storybook' } },
  { name: 'hero-new-soft', look: { ...LOOKS.player, shape: 'sculpted', faceStyle: 'soft' } },
  { name: 'player', look: LOOKS.player },
  { name: 'merchant', look: LOOKS.merchant },
  { name: 'keeper', look: LOOKS.keeper },
  { name: 'villager1', look: villagerLook(11) },
  { name: 'villager2', look: villagerLook(23) },
  { name: 'villager3', look: villagerLook(37) },
];
const SPACING = 1.6;
const ANIMS = ['idle', 'walk', 'run', 'wave'] as const;
type Anim = (typeof ANIMS)[number];
const SPEED: Record<Anim, number> = { idle: 0, walk: 1.8, run: 4.5, wave: 0 };

export class Showcase {
  readonly renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, depth: false });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 300);
  private atmosphere: Atmosphere;
  private pipeline: Pipeline;
  private tier: Tier;
  private cast: { entry: Entry; character: Character; track: THREE.Group }[] = [];
  private index = 0;
  private anim: Anim = 'idle';
  private view: 'full' | 'face' = 'full';
  private yaw = 0;
  private pitch = 0.08;
  private zoom = 1;
  private lastWave = 0;
  frames = 0;
  /** Called whenever the selection changes (for the page's labels). */
  onChange: () => void = () => {};

  constructor(private container: HTMLElement, params: URLSearchParams) {
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    const q = params.get('quality');
    this.tier = q === 'low' || q === 'medium' || q === 'high' ? q : matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
    const settings = TIER_SETTINGS[this.tier];
    this.atmosphere = new Atmosphere(this.scene);
    this.atmosphere.setPreset(presetFromParams(params));
    this.atmosphere.setShadowMapSize(Math.max(settings.shadowMapSize, 1024));
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, settings);

    // A simple meadow stage.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#86b25c' }));
    ground.name = 'stage';
    this.scene.add(ground);
    this.atmosphere.adopt(ground, { cast: false, receive: true });

    CAST.forEach((entry, i) => {
      const track = new THREE.Group();
      track.position.x = (i - 0) * SPACING;
      const character = new Character(entry.look, this.atmosphere, 1.3 + i * 4.1, { crowd: params.has('crowd') });
      if (params.has('still')) character.autoBlink = false;
      track.add(character.root);
      this.scene.add(track);
      this.cast.push({ entry, character, track });
    });

    const who = params.get('who');
    this.index = Math.max(0, CAST.findIndex((c) => c.name === who));
    const anim = params.get('anim') as Anim | null;
    if (anim && ANIMS.includes(anim)) this.anim = anim;
    if (params.get('view') === 'face') this.view = 'face';
    const yaw = Number(params.get('yaw'));
    if (Number.isFinite(yaw)) this.yaw = (yaw * Math.PI) / 180;
    const expr = params.get('expr');
    if (expr) this.setExpression(expr);

    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get current() {
    return this.cast[this.index];
  }
  get state() {
    return { who: this.current.entry.name, anim: this.anim, view: this.view, expression: this.current.character.expression };
  }

  next(step: number) {
    this.index = (this.index + step + this.cast.length) % this.cast.length;
    this.onChange();
  }
  cycleAnim() {
    this.anim = ANIMS[(ANIMS.indexOf(this.anim) + 1) % ANIMS.length];
    this.onChange();
  }
  toggleView() {
    this.view = this.view === 'full' ? 'face' : 'full';
    this.zoom = 1;
    this.onChange();
  }
  setExpression(name: string) {
    for (const c of this.cast) c.character.setExpression(name);
    this.onChange();
  }
  expressions() {
    return Character.EXPRESSIONS;
  }

  private bindInput() {
    const el = this.renderer.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1) {
        this.yaw -= ((e.clientX - prev.x) / el.clientHeight) * 4;
        this.pitch = THREE.MathUtils.clamp(this.pitch + ((e.clientY - prev.y) / el.clientHeight) * 2, -0.3, 1.1);
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom = THREE.MathUtils.clamp(this.zoom * (pinch / d), 0.4, 2.5);
        pinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.1, Math.sign(e.deltaY)), 0.4, 2.5);
    }, { passive: false });
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const s = TIER_SETTINGS[this.tier];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, s.maxPixelRatio));
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 40 : 30;
    this.camera.updateProjectionMatrix();
  }

  private lastTime = 0;
  frame(timeMs: number) {
    const time = timeMs / 1000;
    const dt = this.lastTime ? Math.min(time - this.lastTime, 0.1) : 1 / 60;
    this.lastTime = time;

    for (const c of this.cast) {
      const selected = c === this.current;
      const speed = selected ? SPEED[this.anim] : 0;
      // Treadmill: the character really walks forward (so its stride matches the ground),
      // while its track slides back to keep it in place.
      c.character.root.position.z += speed * dt;
      c.track.position.z = -c.character.root.position.z;
      if (selected && this.anim === 'wave' && time - this.lastWave > 2.2) {
        c.character.wave();
        this.lastWave = time;
      }
      c.character.update(dt, time, speed);
    }

    // Orbit the selected character: full body, or a close look at the face.
    const target = this.current.character.root.getWorldPosition(new THREE.Vector3());
    const face = this.view === 'face';
    target.y += face ? 1.52 : 0.9;
    const dist = (face ? 0.75 : 3.6) * this.zoom;
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
      target.y + Math.sin(this.pitch) * dist,
      target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist,
    );
    this.camera.lookAt(target);

    this.atmosphere.update(time, this.camera, target);
    updateCharacterLighting(this.atmosphere, this.camera, this.renderer.domElement.height);
    this.pipeline.render(dt);
    this.frames++;
  }

  start() {
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }
}
