import type { CodexEntry } from '../content/codex';
import { ICONS } from './icons';
import { installTheme } from './theme';

/**
 * The game menu: Journal (objectives), Codex (terms learned; filled by the
 * knowledge layer later) and Settings. Portrait: tabs across the top, content
 * below. Wide screens: a side rail with the content beside it.
 */
const CSS = `
.bq-menu { position: fixed; inset: 0; z-index: 9; display: flex; align-items: center; justify-content: center;
  background: rgba(16,10,20,.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  opacity: 0; pointer-events: none; transition: opacity .22s ease; }
.bq-menu.open { opacity: 1; pointer-events: auto; }
.bq-menu-panel { position: relative; width: min(94vw, 900px); height: min(86vh, 640px); margin-top: var(--bq-safe-t);
  border-radius: 22px; display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(170deg, rgba(48,30,52,.94), rgba(26,16,32,.96)); border: 1px solid rgba(242,204,122,.28);
  box-shadow: 0 20px 60px rgba(10,4,14,.55); transform: translateY(14px) scale(.98); transition: transform .25s ease; }
.bq-menu.open .bq-menu-panel { transform: none; }
.bq-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 8px 22px; }
.bq-menu-head .bq-iconbtn { background: rgba(255,247,232,.1); }
.bq-menu-head h2 { margin: 0; font: 400 24px/1 var(--bq-title); color: var(--bq-gold); letter-spacing: .04em; }
.bq-tabs { display: flex; gap: 8px; padding: 6px 16px 12px; border-bottom: 1px solid rgba(242,204,122,.18); }
.bq-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border-radius: 12px;
  border: none; cursor: pointer; background: transparent; color: rgba(255,247,232,.7); font: 700 12.5px/1 var(--bq-body); transition: background .15s, color .15s; }
.bq-tab svg { width: 22px; height: 22px; }
.bq-tab.active { background: rgba(242,204,122,.16); color: var(--bq-gold); }
.bq-menu-body { flex: 1; overflow-y: auto; padding: 18px 22px 26px; -webkit-overflow-scrolling: touch; }
.bq-section h3 { margin: 0 0 6px; font: 400 21px/1.2 var(--bq-title); color: var(--bq-cream); }
.bq-section p { margin: 0 0 14px; font: 600 15px/1.55 var(--bq-body); color: rgba(255,247,232,.82); }
.bq-steps { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
.bq-steps li { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 12px; background: rgba(255,247,232,.06);
  font: 600 15px/1.3 var(--bq-body); }
.bq-steps li .bq-tick { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(242,204,122,.6); display: inline-flex; align-items: center; justify-content: center; color: var(--bq-ink); }
.bq-steps li.done { color: rgba(255,247,232,.6); }
.bq-steps li.done .bq-tick { background: var(--bq-gold); border-color: var(--bq-gold); }
.bq-steps li .bq-tick svg { width: 15px; height: 15px; stroke-width: 3; }
.bq-empty { text-align: center; padding: 40px 10px; color: rgba(255,247,232,.7); font: 600 15px/1.55 var(--bq-body); }
.bq-empty svg { width: 46px; height: 46px; color: var(--bq-gold); opacity: .7; margin-bottom: 10px; }
.bq-codex { display: grid; gap: 12px; }
.bq-entry { padding: 14px 16px; border-radius: 14px; background: rgba(255,247,232,.06); border-left: 3px solid var(--bq-gold); animation: bq-rise .3s ease both; }
.bq-entry h4 { margin: 0; font: 400 19px/1.2 var(--bq-title); color: var(--bq-cream); }
.bq-entry .bq-aka { margin: 3px 0 8px; font: 700 12px/1.2 var(--bq-body); color: var(--bq-gold); letter-spacing: .04em; }
.bq-entry p { margin: 0 0 8px; font: 600 15px/1.5 var(--bq-body); color: rgba(255,247,232,.9); }
.bq-entry .bq-seen { margin: 0; font: 600 13.5px/1.45 var(--bq-body); color: rgba(255,247,232,.62); font-style: italic; }
.bq-setting { padding: 14px 0; border-bottom: 1px solid rgba(255,247,232,.08); }
.bq-setting label, .bq-setting .bq-setting-name { display: block; font: 700 15px/1.3 var(--bq-body); margin-bottom: 9px; }
.bq-setting small { display: block; margin-top: 6px; font: 600 12.5px/1.4 var(--bq-body); color: rgba(255,247,232,.6); }
.bq-seg { display: flex; padding: 4px; border-radius: 12px; background: rgba(0,0,0,.25); gap: 4px; }
.bq-seg button { flex: 1; padding: 9px 4px; border: none; border-radius: 9px; cursor: pointer; background: transparent; color: rgba(255,247,232,.75); font: 700 14px/1 var(--bq-body); }
.bq-seg button.on { background: linear-gradient(180deg, #fffaf0, #ecd4a1); color: var(--bq-ink); }
.bq-setting .bq-switch { display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin: 0; }
.bq-switch input { appearance: none; width: 50px; height: 30px; border-radius: 15px; background: rgba(0,0,0,.35); position: relative; cursor: pointer; transition: background .2s; margin: 0; }
.bq-switch input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff7e8; transition: transform .2s; }
.bq-switch input:checked { background: var(--bq-gold-deep); }
.bq-switch input:checked::after { transform: translateX(20px); }
.bq-range { width: 100%; accent-color: var(--bq-gold); }
@media (orientation: landscape) and (min-width: 820px) {
  .bq-menu-panel { flex-direction: row; flex-wrap: wrap; }
  .bq-menu-head { width: 100%; box-sizing: border-box; }
  .bq-tabs { flex-direction: column; width: 170px; border-bottom: none; border-right: 1px solid rgba(242,204,122,.18); padding: 6px 12px; height: calc(100% - 64px); box-sizing: border-box; }
  .bq-tab { flex: none; flex-direction: row; justify-content: flex-start; gap: 10px; padding: 12px 14px; font-size: 14.5px; }
  .bq-menu-body { height: calc(100% - 64px); box-sizing: border-box; }
}
`;

export type Tab = 'journal' | 'codex' | 'settings';

export interface QuestView {
  title: string;
  description: string;
  steps: { text: string; done: boolean }[];
}

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  showFps: boolean;
  /** Camera turn sensitivity multiplier. */
  sensitivity: number;
}

export class Menu {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private tab: Tab = 'journal';
  private quest: QuestView | null = null;
  private codex: CodexEntry[] = [];

  constructor(
    private settings: Settings,
    private onSettings: (s: Settings) => void,
    private onClose: () => void,
  ) {
    installTheme();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'bq-menu bq-ui';
    this.root.setAttribute('data-testid', 'menu');
    this.root.innerHTML = `
      <div class="bq-menu-panel">
        <div class="bq-menu-head"><h2>Menu</h2><button class="bq-iconbtn" aria-label="Close" data-testid="menu-close">${ICONS.close}</button></div>
        <div class="bq-tabs">
          <button class="bq-tab" data-tab="journal">${ICONS.journal}<span>Journal</span></button>
          <button class="bq-tab" data-tab="codex" data-testid="tab-codex">${ICONS.codex}<span>Codex</span></button>
          <button class="bq-tab" data-tab="settings" data-testid="tab-settings">${ICONS.settings}<span>Settings</span></button>
        </div>
        <div class="bq-menu-body"></div>
      </div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.bq-menu-body')!;
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.root) this.close(); // tap outside the panel
    });
    this.root.querySelector('[data-testid=menu-close]')!.addEventListener('click', () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('.bq-tab').forEach((b) =>
      b.addEventListener('click', () => this.show(b.dataset.tab as Tab)),
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open(tab: Tab = this.tab) {
    this.root.classList.add('open');
    this.show(tab);
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    this.onClose();
  }

  setQuest(q: QuestView) {
    this.quest = q;
    if (this.isOpen && this.tab === 'journal') this.show('journal');
  }

  setCodex(entries: CodexEntry[]) {
    this.codex = entries;
    if (this.isOpen && this.tab === 'codex') this.show('codex');
  }

  private show(tab: Tab) {
    this.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>('.bq-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'journal') this.renderJournal();
    else if (tab === 'codex') this.renderCodex();
    else this.renderSettings();
  }

  private renderJournal() {
    const q = this.quest;
    if (!q) {
      this.body.innerHTML = `<div class="bq-empty">${ICONS.journal}<div>No tasks yet. Explore!</div></div>`;
      return;
    }
    this.body.innerHTML = `<div class="bq-section"><h3></h3><p></p><ul class="bq-steps"></ul></div>`;
    this.body.querySelector('h3')!.textContent = q.title;
    this.body.querySelector('p')!.textContent = q.description;
    const ul = this.body.querySelector('ul')!;
    for (const s of q.steps) {
      const li = document.createElement('li');
      li.className = s.done ? 'done' : '';
      li.innerHTML = `<span class="bq-tick">${s.done ? ICONS.check : ''}</span><span></span>`;
      li.lastElementChild!.textContent = s.text;
      ul.appendChild(li);
    }
  }

  private renderCodex() {
    if (!this.codex.length) {
      this.body.innerHTML = `<div class="bq-empty">${ICONS.codex}<div>Ideas and terms you discover on your journey will be recorded here.</div></div>`;
      return;
    }
    this.body.innerHTML = '<div class="bq-codex" data-testid="codex"></div>';
    const list = this.body.firstElementChild!;
    this.codex.forEach((e, i) => {
      const el = document.createElement('div');
      el.className = 'bq-entry';
      el.style.animationDelay = `${i * 40}ms`;
      el.innerHTML = '<h4></h4><div class="bq-aka"></div><p></p><p class="bq-seen"></p>';
      el.querySelector('h4')!.textContent = e.term;
      const aka = el.querySelector<HTMLElement>('.bq-aka')!;
      if (e.aka) aka.textContent = `Also called: ${e.aka}`;
      else aka.remove();
      el.querySelector('p')!.textContent = e.definition;
      el.querySelector('.bq-seen')!.textContent = e.seenIt;
      list.appendChild(el);
    });
  }

  private renderSettings() {
    const s = this.settings;
    const q = (['auto', 'low', 'medium', 'high'] as const).map((v) => `<button data-q="${v}" class="${s.quality === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
    this.body.innerHTML = `
      <div class="bq-setting"><span class="bq-setting-name">Graphics quality</span><div class="bq-seg" data-testid="quality-setting">${q}</div>
        <small>Auto adjusts to keep the game smooth. Higher looks richer but works your device harder.</small></div>
      <div class="bq-setting"><label for="bq-sens">Camera sensitivity</label><input id="bq-sens" class="bq-range" type="range" min="0.4" max="2" step="0.1" value="${s.sensitivity}"></div>
      <div class="bq-setting"><label class="bq-switch">Show frame rate<input type="checkbox" data-testid="fps-setting" ${s.showFps ? 'checked' : ''}></label></div>`;
    this.body.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        this.update({ quality: b.dataset.q as Settings['quality'] });
        this.renderSettings();
      }),
    );
    this.body.querySelector<HTMLInputElement>('#bq-sens')!.addEventListener('input', (e) => this.update({ sensitivity: Number((e.target as HTMLInputElement).value) }));
    this.body.querySelector<HTMLInputElement>('[data-testid=fps-setting]')!.addEventListener('change', (e) => this.update({ showFps: (e.target as HTMLInputElement).checked }));
  }

  private update(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.onSettings(this.settings);
  }
}

const KEY = 'bq-settings';
export const DEFAULT_SETTINGS: Settings = { quality: 'auto', showFps: false, sensitivity: 1 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable (private mode etc.): use defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
