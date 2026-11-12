import { ICONS } from './icons';
import { installTheme } from './theme';

/**
 * In-world HUD: the objective tracker (top-left), the menu button (top-right)
 * and the location banner shown on arrival. Kept small so the world stays the focus.
 */
const CSS = `
.bq-hud { position: fixed; inset: 0; z-index: 6; pointer-events: none; transition: opacity .25s ease; }
.bq-track { position: absolute; left: calc(12px + var(--bq-safe-l)); top: calc(12px + var(--bq-safe-t)); max-width: min(64vw, 300px);
  padding: 10px 14px 11px 12px; border-radius: 14px; pointer-events: auto; cursor: pointer; animation: bq-rise .4s ease both; }
.bq-track-title { display: flex; align-items: center; gap: 7px; font: 400 15px/1.2 var(--bq-title); color: var(--bq-gold); letter-spacing: .02em; }
.bq-track-title svg { width: 13px; height: 13px; flex: none; }
.bq-track-obj { margin-top: 4px; font: 600 13.5px/1.35 var(--bq-body); color: var(--bq-cream); }
.bq-track.flash { animation: bq-flash .9s ease; }
@keyframes bq-flash { 0% { box-shadow: 0 0 0 0 rgba(242,204,122,.8); } 100% { box-shadow: 0 0 0 14px rgba(242,204,122,0); } }
.bq-menubtn { position: absolute; right: calc(12px + var(--bq-safe-r)); top: calc(12px + var(--bq-safe-t)); pointer-events: auto; }
.bq-banner { position: absolute; left: 0; right: 0; top: 24%; text-align: center; pointer-events: none;
  opacity: 0; transition: opacity 1.2s ease, transform 1.2s ease; transform: translateY(8px); }
.bq-banner.show { opacity: 1; transform: none; }
.bq-banner-sub { font: 700 12px/1 var(--bq-body); letter-spacing: .32em; text-transform: uppercase; color: rgba(255,247,232,.85); text-shadow: 0 1px 6px rgba(40,20,20,.7); }
.bq-banner-title { margin: 10px 0; font: 400 clamp(30px, 8vw, 46px)/1.1 var(--bq-title); color: var(--bq-cream);
  text-shadow: 0 2px 14px rgba(60,25,20,.65), 0 0 30px rgba(255,210,140,.35); letter-spacing: .04em; }
.bq-banner-rule { margin: 0 auto; width: min(70vw, 320px); height: 2px; background: linear-gradient(90deg, transparent, var(--bq-gold), transparent); }
`;

export interface Objective {
  title: string;
  text: string;
}

export class Hud {
  readonly root: HTMLDivElement;
  private title: HTMLDivElement;
  private obj: HTMLDivElement;
  private track: HTMLDivElement;
  private last = '';

  constructor(onMenu: () => void, onTracker: () => void) {
    installTheme();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'bq-hud bq-ui';
    this.root.innerHTML = `
      <div class="bq-track bq-glass" data-testid="objective"><div class="bq-track-title">${ICONS.objective}<span></span></div><div class="bq-track-obj"></div></div>
      <button class="bq-iconbtn bq-glass bq-menubtn" aria-label="Menu" data-testid="menu-button">${ICONS.menu}</button>
      <div class="bq-banner" data-testid="banner"><div class="bq-banner-sub"></div><div class="bq-banner-title"></div><div class="bq-banner-rule"></div></div>`;
    document.body.appendChild(this.root);
    this.track = this.root.querySelector('.bq-track')!;
    this.title = this.root.querySelector('.bq-track-title span')!;
    this.obj = this.root.querySelector('.bq-track-obj')!;
    const menu = this.root.querySelector('.bq-menubtn')!;
    // Keep taps on HUD buttons from reaching the camera/joystick surface underneath.
    menu.addEventListener('pointerdown', (e) => { e.stopPropagation(); onMenu(); });
    this.track.addEventListener('pointerdown', (e) => { e.stopPropagation(); onTracker(); });
  }

  setObjective(o: Objective) {
    const key = o.title + '|' + o.text;
    if (key === this.last) return;
    const changed = this.last !== '';
    this.last = key;
    this.title.textContent = o.title;
    this.obj.textContent = o.text;
    if (changed) {
      this.track.classList.remove('flash');
      void this.track.offsetWidth; // restart the animation
      this.track.classList.add('flash');
    }
  }

  banner(sub: string, title: string, seconds = 3.5) {
    const b = this.root.querySelector('.bq-banner')!;
    b.querySelector('.bq-banner-sub')!.textContent = sub;
    b.querySelector('.bq-banner-title')!.textContent = title;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), seconds * 1000);
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('bq-hidden', !v);
  }
}
