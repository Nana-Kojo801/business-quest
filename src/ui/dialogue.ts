import type { Script } from '../content/dialogue';
import { ICONS } from './icons';
import { installTheme } from './theme';

/**
 * The conversation box. Portrait: a band across the bottom with choices stacked
 * above it, right-aligned within thumb reach. Wide screens: a centred box with
 * choices beside it on the right. Text types itself out; tap/click (or Space,
 * Enter, E) completes the line, then continues. Number keys pick choices.
 */
const CSS = `
.bq-dlg { position: fixed; inset: 0; z-index: 8; pointer-events: none; }
.bq-dlg.open { pointer-events: auto; }
.bq-dlg-band { position: absolute; left: 0; right: 0; bottom: 0;
  padding: 46px calc(20px + var(--bq-safe-r)) calc(26px + var(--bq-safe-b)) calc(20px + var(--bq-safe-l));
  background: linear-gradient(180deg, rgba(20,12,24,0) 0%, rgba(20,12,24,.72) 34%, rgba(16,10,20,.9) 100%);
  opacity: 0; transform: translateY(20px); transition: opacity .25s ease, transform .25s ease; }
.bq-dlg.open .bq-dlg-band { opacity: 1; transform: none; }
.bq-dlg-inner { max-width: 980px; margin: 0 auto; position: relative; }
.bq-dlg-name { display: inline-flex; align-items: center; gap: 10px; font: 400 21px/1 var(--bq-title); color: var(--bq-gold);
  letter-spacing: .03em; margin-bottom: 10px; text-shadow: 0 2px 6px rgba(0,0,0,.5); }
.bq-dlg-name::before { content: ''; width: 26px; height: 2px; background: linear-gradient(90deg, transparent, var(--bq-gold)); }
.bq-dlg-name::after { content: ''; width: 60px; height: 2px; background: linear-gradient(90deg, var(--bq-gold), transparent); }
.bq-dlg-text { font: 600 17.5px/1.55 var(--bq-body); color: var(--bq-cream); min-height: 4.65em; text-shadow: 0 1px 3px rgba(0,0,0,.45); }
.bq-dlg-next { position: absolute; right: 0; bottom: -6px; width: 22px; height: 22px; color: var(--bq-gold); animation: bq-bob 1s ease-in-out infinite; opacity: 0; transition: opacity .2s; }
.bq-dlg-next.show { opacity: 1; }
.bq-dlg-choices { position: absolute; right: calc(16px + var(--bq-safe-r)); display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.bq-dlg-choice { display: flex; align-items: center; gap: 10px; min-width: 210px; max-width: min(88vw, 420px); text-align: left;
  padding: 12px 18px 12px 12px; border-radius: 14px; border: 1px solid rgba(242,204,122,.35); cursor: pointer;
  font: 700 16px/1.3 var(--bq-body); color: var(--bq-cream); background: var(--bq-glass-strong);
  box-shadow: 0 6px 18px rgba(10,5,15,.4); animation: bq-rise .28s ease both; transition: background .15s, transform .1s; }
.bq-dlg-choice:active { transform: scale(.97); background: rgba(70,46,60,.95); }
.bq-dlg-choice .bq-dlg-key { flex: none; width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #fffaf0, #e9cf98); color: var(--bq-ink); font: 800 13px/1 var(--bq-body); }
@media (orientation: landscape) and (min-width: 820px) {
  .bq-dlg-text { font-size: 19px; }
  .bq-dlg-choices { right: calc(40px + var(--bq-safe-r)); top: auto; }
}
`;

export class DialogueBox {
  private root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private nextEl: HTMLDivElement;
  private choicesEl: HTMLDivElement;
  private band: HTMLDivElement;
  private script: Script | null = null;
  private lineId = '';
  private full = '';
  private shown = 0;
  private onEnd: (() => void) | null = null;
  /** Called as characters appear (for typing blips), with the speaker's name. */
  onType: (speaker: string) => void = () => {};
  /** Called when a choice is picked or a line is advanced. */
  onAdvance: () => void = () => {};
  /** Characters revealed per second. */
  speed = 48;

  constructor() {
    installTheme();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'bq-dlg bq-ui';
    this.root.setAttribute('data-testid', 'dialogue');
    this.root.innerHTML = `
      <div class="bq-dlg-choices"></div>
      <div class="bq-dlg-band"><div class="bq-dlg-inner">
        <div class="bq-dlg-name"></div>
        <div class="bq-dlg-text" data-testid="dialogue-text"></div>
        <div class="bq-dlg-next">${ICONS.next}</div>
      </div></div>`;
    document.body.appendChild(this.root);
    this.band = this.root.querySelector('.bq-dlg-band')!;
    this.nameEl = this.root.querySelector('.bq-dlg-name')!;
    this.textEl = this.root.querySelector('.bq-dlg-text')!;
    this.nextEl = this.root.querySelector('.bq-dlg-next')!;
    this.choicesEl = this.root.querySelector('.bq-dlg-choices')!;

    // Tap anywhere (except a choice) to continue.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.bq-dlg-choice')) return;
      e.stopPropagation();
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) this.choose(n - 1);
    });
  }

  get isOpen() {
    return this.script !== null;
  }

  /** Who is speaking, how they look, and whether their words are still appearing. */
  get current(): { speaker: string; mood: string; typing: boolean } | null {
    if (!this.script) return null;
    const line = this.line;
    return { speaker: line.speaker, mood: line.mood ?? 'neutral', typing: this.shown < this.full.length };
  }

  /** Height of the dialogue band, so the camera can keep faces above it. */
  get coverFraction() {
    return this.isOpen ? this.band.offsetHeight / Math.max(1, window.innerHeight) : 0;
  }

  open(script: Script, onEnd: () => void) {
    this.script = script;
    this.onEnd = onEnd;
    this.root.classList.add('open');
    this.show(script.start);
  }

  private show(id: string) {
    const line = this.script!.lines[id];
    this.lineId = id;
    this.nameEl.textContent = line.speaker;
    this.full = line.text;
    this.shown = 0;
    this.textEl.textContent = '';
    this.choicesEl.innerHTML = '';
    this.nextEl.classList.remove('show');
  }

  private get line() {
    return this.script!.lines[this.lineId];
  }

  private finishLine() {
    this.shown = this.full.length;
    this.textEl.textContent = this.full;
    const line = this.line;
    if (line.choices) {
      // Place choices just above the band.
      this.choicesEl.style.bottom = `${this.band.offsetHeight + 12}px`;
      this.choicesEl.innerHTML = '';
      line.choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'bq-dlg-choice';
        b.style.animationDelay = `${i * 60}ms`;
        b.setAttribute('data-testid', `choice-${i}`);
        b.innerHTML = `<span class="bq-dlg-key">${i + 1}</span><span></span>`;
        b.lastElementChild!.textContent = c.label;
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.choose(i);
        });
        this.choicesEl.appendChild(b);
      });
    } else {
      this.nextEl.classList.add('show');
    }
  }

  /** Tap / Space / E: finish the line if it's still typing, else continue. */
  advance() {
    if (!this.script) return;
    if (this.shown < this.full.length) {
      this.finishLine();
      return;
    }
    const line = this.line;
    if (line.choices) return; // waiting for a choice
    this.onAdvance();
    this.goto(line.next ?? null);
  }

  choose(i: number) {
    if (!this.script || this.shown < this.full.length) return;
    const c = this.line.choices?.[i];
    if (c) {
      this.onAdvance();
      this.goto(c.next);
    }
  }

  private goto(next: string | null) {
    if (next) {
      this.show(next);
      return;
    }
    this.close();
  }

  close() {
    this.script = null;
    this.root.classList.remove('open');
    this.choicesEl.innerHTML = '';
    const done = this.onEnd;
    this.onEnd = null;
    done?.();
  }

  update(dt: number) {
    if (!this.script || this.shown >= this.full.length) return;
    this.shown = Math.min(this.full.length, this.shown + this.speed * dt);
    const before = this.textEl.textContent?.length ?? 0;
    const n = Math.floor(this.shown);
    this.textEl.textContent = this.full.slice(0, n);
    if (n > before && /\S/.test(this.full[n - 1] ?? '')) this.onType(this.line.speaker);
    if (n >= this.full.length) this.finishLine();
  }
}
