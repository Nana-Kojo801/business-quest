/**
 * Minimal input: keyboard (WASD / arrows) and touch/mouse drag.
 * Produces a normalized move vector. Replaced by the full control scheme in a later issue.
 */
export interface MoveInput {
  x: number; // -1..1, right is positive
  y: number; // -1..1, forward (up the screen) is positive
}

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  private held = new Set<string>();
  private dragOrigin: { x: number; y: number } | null = null;
  private drag = { x: 0, y: 0 };
  private activePointer: number | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code in KEYS) { this.held.add(e.code); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    target.addEventListener('pointerdown', (e) => {
      if (this.activePointer !== null) return;
      this.activePointer = e.pointerId;
      this.dragOrigin = { x: e.clientX, y: e.clientY };
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.activePointer || !this.dragOrigin) return;
      const radius = 60;
      const dx = (e.clientX - this.dragOrigin.x) / radius;
      const dy = (e.clientY - this.dragOrigin.y) / radius;
      const len = Math.hypot(dx, dy);
      const k = len > 1 ? 1 / len : 1;
      this.drag = { x: dx * k, y: -dy * k };
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.dragOrigin = null;
      this.drag = { x: 0, y: 0 };
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  read(): MoveInput {
    let x = this.drag.x;
    let y = this.drag.y;
    for (const code of this.held) {
      const [kx, ky] = KEYS[code];
      x += kx;
      y += ky;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }
}
