import type { QualityState } from '../render/quality';

/** Small corner readout of fps and quality, shown with ?debug=1. */
export function createDebugOverlay(read: () => QualityState & { pixelRatio: number }) {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'debug-overlay');
  Object.assign(el.style, {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
    left: '8px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgba(20, 14, 40, 0.6)',
    color: '#fff',
    font: '12px/1.4 ui-monospace, monospace',
    pointerEvents: 'none',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  const refresh = () => {
    const q = read();
    el.textContent = `${q.fps} fps · ${q.tier} · res ${Math.round(q.scale * 100)}% · dpr ${q.pixelRatio.toFixed(2)}`;
  };
  refresh(); // show something immediately, before the first frame-time sample
  setInterval(refresh, 500);
}
