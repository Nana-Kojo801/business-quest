
/**
 * Speech bubbles that float above characters' heads (DOM, positioned each frame
 * by projecting a 3D point to the screen). The dialogue system will build on this.
 */
const CSS = `
.bq-bubble { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; padding: 7px 13px 9px;
  border-radius: 16px; background: #fffaf0; color: #4a2e1c; font: 800 18px/1 system-ui, sans-serif; letter-spacing: .12em;
  box-shadow: 0 4px 14px rgba(40,20,20,.3); opacity: 0; transition: opacity .2s ease;
  will-change: transform; }
.bq-bubble::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -7px;
  border: 7px solid transparent; border-bottom: 0; border-top-color: #fffaf0; }
.bq-bubble.show { opacity: 1; }
`;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Projects a world point to screen pixels; `visible` is false when it's behind the camera. */
export type Project = (p: Point3) => { x: number; y: number; visible: boolean };

export class Bubbles {
  private items = new Map<string, { el: HTMLDivElement; until: number; pos: () => Point3 }>();

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  show(id: string, text: string, pos: () => Point3, seconds = 2.2) {
    let item = this.items.get(id);
    if (!item) {
      const el = document.createElement('div');
      el.className = 'bq-bubble';
      el.setAttribute('data-testid', `bubble-${id}`);
      document.body.appendChild(el);
      item = { el, until: 0, pos };
      this.items.set(id, item);
    }
    item.el.textContent = text;
    item.pos = pos;
    item.until = performance.now() / 1000 + seconds;
    item.el.classList.add('show');
  }

  update(project: Project) {
    const now = performance.now() / 1000;
    for (const item of this.items.values()) {
      const visible = now < item.until;
      item.el.classList.toggle('show', visible);
      if (!visible) continue;
      const sp = project(item.pos());
      const x = sp.x;
      const y = sp.y;
      item.el.style.display = sp.visible ? 'block' : 'none';
      // Bob gently above the head.
      const bob = Math.sin(now * 3) * 3;
      item.el.style.transform = `translate(${x}px, ${y + bob}px) translate(-50%, -100%)`;
    }
  }
}
