import type { MarketResult } from '../core';
import { installTheme } from './theme';
import type { Project, Point3 } from './bubbles';

/**
 * The market-morning panel: set a price, see how many want to buy against how
 * many peaches there are, open the stall, and read how the morning went.
 * Plus the Ledger Lens tags: each shopper's limit, lit when they'd buy.
 */
const CSS = `
.bq-price { position: fixed; left: 0; right: 0; bottom: 0; z-index: 8; display: flex; justify-content: center;
  padding: 0 calc(12px + var(--bq-safe-r)) calc(14px + var(--bq-safe-b)) calc(12px + var(--bq-safe-l));
  transform: translateY(110%); transition: transform .32s cubic-bezier(.2,.9,.3,1.1); pointer-events: none; }
.bq-price.open { transform: none; pointer-events: auto; }
.bq-price-card { width: min(100%, 520px); border-radius: 22px; padding: 16px 18px 18px; box-sizing: border-box;
  background: linear-gradient(170deg, rgba(48,30,52,.95), rgba(26,16,32,.96)); border: 1px solid rgba(242,204,122,.3);
  box-shadow: 0 -6px 30px rgba(10,4,14,.45); }
.bq-price-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.bq-price-title { font: 400 19px/1.1 var(--bq-title); color: var(--bq-gold); letter-spacing: .03em; }
.bq-price-day { font: 700 12.5px/1 var(--bq-body); color: rgba(255,247,232,.65); letter-spacing: .08em; text-transform: uppercase; }
.bq-price-row { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 4px 0 8px; }
.bq-price-step { width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer; font: 800 28px/1 var(--bq-body); color: var(--bq-ink);
  background: radial-gradient(circle at 38% 30%, #fffaf0, #e7c98c); box-shadow: 0 4px 0 #b88c4c, 0 6px 14px rgba(20,10,20,.35); }
.bq-price-step:active { transform: translateY(3px); box-shadow: 0 1px 0 #b88c4c; }
.bq-price-val { min-width: 120px; text-align: center; font: 800 46px/1 var(--bq-body); color: var(--bq-cream); text-shadow: 0 2px 10px rgba(255,200,120,.35); }
.bq-price-val small { font-size: 18px; color: var(--bq-gold); margin-left: 4px; font-weight: 800; }
.bq-price-range { width: 100%; accent-color: var(--bq-gold); margin: 2px 0 12px; }
.bq-price-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.bq-stat { border-radius: 14px; padding: 10px 12px; background: rgba(255,247,232,.07); text-align: center; }
.bq-stat b { display: block; font: 800 26px/1.1 var(--bq-body); color: var(--bq-cream); }
.bq-stat span { font: 700 12.5px/1.2 var(--bq-body); color: rgba(255,247,232,.7); }
.bq-price-go { width: 100%; }
.bq-result { text-align: center; }
.bq-result h4 { margin: 2px 0 8px; font: 400 22px/1.2 var(--bq-title); }
.bq-result.good h4 { color: #b9e88a; }
.bq-result.bad h4 { color: #ffb48a; }
.bq-result p { margin: 0 0 6px; font: 600 15px/1.5 var(--bq-body); color: rgba(255,247,232,.88); }
.bq-result .bq-result-nums { display: flex; justify-content: center; gap: 14px; margin: 10px 0 14px; font: 700 13.5px/1.3 var(--bq-body); color: rgba(255,247,232,.75); }
.bq-result .bq-result-nums b { display: block; font-size: 22px; color: var(--bq-cream); }
.bq-tag { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; padding: 4px 9px 4px 6px; border-radius: 999px;
  display: flex; align-items: center; gap: 5px; font: 800 14px/1 var(--bq-body); color: #5a4a3a;
  background: rgba(255,247,232,.55); box-shadow: 0 2px 8px rgba(30,15,20,.25); transition: background .2s, color .2s, transform .1s; will-change: transform; }
.bq-tag i { width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff3c4, #d9a63e); box-shadow: inset 0 -1px 2px rgba(120,70,10,.5); }
.bq-tag.on { background: linear-gradient(180deg, #fff7d8, #f2cc7a); color: #4a2e1c; box-shadow: 0 0 14px rgba(255,210,120,.8), 0 2px 8px rgba(30,15,20,.3); }
`;

export interface PricingRound {
  supply: number;
  startPrice: number;
  limits: number[];
  min: number;
  max: number;
  day: string;
}

export class PricingPanel {
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private round: PricingRound | null = null;
  private price = 1;
  private tags: HTMLDivElement[] = [];
  private onPrice: (p: number) => void = () => {};
  private onOpen: (p: number) => void = () => {};

  constructor() {
    installTheme();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'bq-price bq-ui';
    this.root.setAttribute('data-testid', 'pricing');
    this.root.innerHTML = '<div class="bq-price-card"></div>';
    this.card = this.root.firstElementChild as HTMLDivElement;
    // Keep taps on the panel from reaching the world below.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  /** Fraction of the screen covered (so the camera can keep the crowd above it). */
  get coverFraction() {
    return this.isOpen ? this.card.offsetHeight / Math.max(1, window.innerHeight) + 0.03 : 0;
  }

  /** Show the price-setting controls for a round. */
  open(round: PricingRound, onPrice: (p: number) => void, onOpen: (p: number) => void) {
    this.round = round;
    this.onPrice = onPrice;
    this.onOpen = onOpen;
    this.price = round.startPrice;
    this.ensureTags(round.limits.length);
    this.renderControls();
    this.root.classList.add('open');
    this.setPrice(this.price);
  }

  close() {
    this.root.classList.remove('open');
    this.round = null;
    for (const t of this.tags) t.style.display = 'none';
  }

  private renderControls() {
    const r = this.round!;
    this.card.innerHTML = `
      <div class="bq-price-head"><div class="bq-price-title">Sunpeach price</div><div class="bq-price-day"></div></div>
      <div class="bq-price-row">
        <button class="bq-price-step" data-d="-1" aria-label="Lower price" data-testid="price-down">−</button>
        <div class="bq-price-val" data-testid="price-value"></div>
        <button class="bq-price-step" data-d="1" aria-label="Raise price" data-testid="price-up">+</button>
      </div>
      <input class="bq-price-range" type="range" min="${r.min}" max="${r.max}" step="1" data-testid="price-range">
      <div class="bq-price-stats">
        <div class="bq-stat"><b data-k="want"></b><span>want to buy</span></div>
        <div class="bq-stat"><b data-k="supply">${r.supply}</b><span>peaches today</span></div>
      </div>
      <button class="bq-pill bq-price-go" data-testid="open-stall">Open the stall</button>`;
    this.card.querySelector('.bq-price-day')!.textContent = r.day;
    this.card.querySelectorAll<HTMLButtonElement>('.bq-price-step').forEach((b) =>
      b.addEventListener('click', () => this.setPrice(this.price + Number(b.dataset.d))),
    );
    this.card.querySelector<HTMLInputElement>('.bq-price-range')!.addEventListener('input', (e) => this.setPrice(Number((e.target as HTMLInputElement).value)));
    this.card.querySelector('.bq-price-go')!.addEventListener('click', () => this.onOpen(this.price));
  }

  setPrice(p: number) {
    const r = this.round;
    if (!r) return;
    this.price = Math.max(r.min, Math.min(r.max, Math.round(p)));
    const val = this.card.querySelector('.bq-price-val');
    if (val) val.innerHTML = `${this.price}<small>coins</small>`;
    const range = this.card.querySelector<HTMLInputElement>('.bq-price-range');
    if (range) range.value = String(this.price);
    const want = r.limits.filter((l) => l >= this.price).length;
    const w = this.card.querySelector('[data-k=want]');
    if (w) w.textContent = String(want);
    this.tags.forEach((t, i) => t.classList.toggle('on', r.limits[i] >= this.price));
    this.onPrice(this.price);
  }

  /** Show how the morning went. */
  showResult(res: MarketResult, line: string, next: { label: string; action: () => void }) {
    const good = res.cleared;
    this.card.innerHTML = `
      <div class="bq-result ${good ? 'good' : 'bad'}" data-testid="price-result">
        <h4>${good ? 'Every peach sold' : res.shortage > 0 ? 'Not enough peaches' : 'Peaches left over'}</h4>
        <p></p>
        <div class="bq-result-nums">
          <div><b>${res.sold}</b>sold</div>
          <div><b>${res.revenue}</b>coins earned</div>
          <div><b>${res.shortage > 0 ? res.shortage : res.surplus}</b>${res.shortage > 0 ? 'went without' : 'left over'}</div>
        </div>
        <button class="bq-pill bq-price-go" data-testid="result-next"></button>
      </div>`;
    this.card.querySelector('p')!.textContent = line;
    const b = this.card.querySelector<HTMLButtonElement>('[data-testid=result-next]')!;
    b.textContent = next.label;
    b.addEventListener('click', next.action);
    for (const t of this.tags) t.style.display = 'none';
  }

  /** Back to the controls for another try (same round). */
  retry() {
    if (!this.round) return;
    this.renderControls();
    this.setPrice(this.price);
  }

  private ensureTags(n: number) {
    while (this.tags.length < n) {
      const t = document.createElement('div');
      t.className = 'bq-tag bq-ui';
      t.setAttribute('data-testid', `lens-tag-${this.tags.length}`);
      document.body.appendChild(t);
      this.tags.push(t);
    }
    this.tags.forEach((t, i) => {
      t.style.display = i < n ? 'flex' : 'none';
      if (i < n && this.round) t.innerHTML = `<i></i>${this.round.limits[i]}`;
    });
  }

  /** Position the lens tags above shoppers' heads. */
  updateTags(project: Project, head: (i: number) => Point3) {
    if (!this.round || !this.card.querySelector('.bq-price-range')) return;
    this.tags.forEach((t, i) => {
      if (i >= this.round!.limits.length) return;
      const s = project(head(i));
      t.style.display = s.visible ? 'flex' : 'none';
      t.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    });
  }
}
