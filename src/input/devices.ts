/**
 * Device input: keyboard, mouse and touch. Produces a screen-relative move
 * vector, camera orbit/zoom deltas and an interact press. Knows nothing about
 * game state. Touch layout (portrait-first):
 *   - left-lower area: a floating joystick appears where the thumb lands
 *   - anywhere else: drag to orbit the camera, pinch to zoom
 *   - action button: handled by the controls UI, reported via pressInteract()
 */
export interface MoveInput {
  x: number; // -1..1, right is positive
  y: number; // -1..1, forward (up the screen) is positive
}

export interface JoystickState {
  active: boolean;
  /** Where the stick is centred, in CSS pixels. */
  originX: number;
  originY: number;
  /** Knob offset, -1..1. */
  dx: number;
  dy: number;
}

const THREE_CLAMP = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

/** Joystick travel radius in CSS pixels. */
export const STICK_RADIUS = 56;

export class Input {
  private held = new Set<string>();
  private walk = false;
  private stickId: number | null = null;
  readonly stick: JoystickState = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };
  private orbit = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private camDx = 0;
  private camDy = 0;
  private zoom = 0;
  private interact = false;
  /** Seconds since the camera was last moved by hand (for auto-follow). */
  lastCameraInput = -Infinity;
  /** Whether the player is using touch (shows touch controls). */
  touchMode: boolean;
  onModeChange: (touch: boolean) => void = () => {};

  constructor(private surface: HTMLElement) {
    this.touchMode = matchMedia('(pointer: coarse)').matches;

    window.addEventListener('keydown', (e) => {
      if (e.code in KEYS) { this.held.add(e.code); e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.walk = true;
      if ((e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && !e.repeat) { this.interact = true; e.preventDefault(); }
      this.setMode(false);
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.walk = false;
    });
    window.addEventListener('blur', () => { this.held.clear(); this.walk = false; });

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    surface.addEventListener('pointerup', (e) => this.up(e));
    surface.addEventListener('pointercancel', (e) => this.up(e));
    surface.addEventListener('wheel', (e) => { this.zoom += THREE_CLAMP(e.deltaY * 0.005, -2, 2); this.lastCameraInput = performance.now() / 1000; e.preventDefault(); }, { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setMode(touch: boolean) {
    if (touch === this.touchMode) return;
    this.touchMode = touch;
    this.onModeChange(touch);
  }

  /** The joystick may start in the lower-left area of the screen. */
  private inStickZone(x: number, y: number) {
    const w = this.surface.clientWidth;
    const h = this.surface.clientHeight;
    return x < w * 0.5 && y > h * 0.4;
  }

  private down(e: PointerEvent) {
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (e.g. synthetic events); tracking still works without capture.
    }
    const touch = e.pointerType !== 'mouse';
    this.setMode(touch);
    if (touch && this.stickId === null && this.inStickZone(e.clientX, e.clientY)) {
      this.stickId = e.pointerId;
      Object.assign(this.stick, { active: true, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0 });
      return;
    }
    this.orbit.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.orbit.size === 2) this.pinchDist = this.pinchSpan();
  }

  private move(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      let dx = (e.clientX - this.stick.originX) / STICK_RADIUS;
      let dy = (e.clientY - this.stick.originY) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        // Drag past the edge: the stick follows the thumb, so it never feels stuck.
        this.stick.originX += (dx / len) * (len - 1) * STICK_RADIUS;
        this.stick.originY += (dy / len) * (len - 1) * STICK_RADIUS;
        dx /= len;
        dy /= len;
      }
      this.stick.dx = dx;
      this.stick.dy = dy;
      return;
    }
    const prev = this.orbit.get(e.pointerId);
    if (!prev) return;
    if (this.orbit.size >= 2) {
      this.orbit.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const span = this.pinchSpan();
      if (this.pinchDist > 0) this.zoom += (this.pinchDist - span) * 0.03;
      this.pinchDist = span;
    } else {
      // Mouse needs a button held to orbit.
      if (e.pointerType === 'mouse' && e.buttons === 0) return;
      this.camDx += e.clientX - prev.x;
      this.camDy += e.clientY - prev.y;
      this.orbit.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    this.lastCameraInput = performance.now() / 1000;
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      Object.assign(this.stick, { active: false, dx: 0, dy: 0 });
    }
    this.orbit.delete(e.pointerId);
    this.pinchDist = this.orbit.size === 2 ? this.pinchSpan() : 0;
  }

  private pinchSpan() {
    const [a, b] = [...this.orbit.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Called by the on-screen action button. */
  pressInteract() {
    this.interact = true;
  }

  read(): MoveInput {
    let x = this.stick.dx;
    let y = -this.stick.dy;
    // A small dead zone, then full range; the stick's distance sets walking vs running.
    const sl = Math.hypot(x, y);
    if (sl < 0.12) { x = 0; y = 0; } else { const k = (sl - 0.12) / 0.88 / sl; x *= k; y *= k; }
    let kx = 0;
    let ky = 0;
    for (const code of this.held) {
      kx += KEYS[code][0];
      ky += KEYS[code][1];
    }
    const kl = Math.hypot(kx, ky);
    if (kl > 0) {
      const s = this.walk ? 0.4 : 1;
      x += (kx / kl) * s;
      y += (ky / kl) * s;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Camera deltas since the last call: orbit in pixels, zoom in steps. */
  takeCamera() {
    const out = { dx: this.camDx, dy: this.camDy, zoom: this.zoom };
    this.camDx = 0;
    this.camDy = 0;
    this.zoom = 0;
    return out;
  }

  takeInteract() {
    const v = this.interact;
    this.interact = false;
    return v;
  }
}
