import type { QualityState } from '../render/quality';

/** Small readout of fps and quality (bottom centre). Shown with ?debug=1 or the settings toggle. */
export function createDebugOverlay(read: () => QualityState & { pixelRatio: number }) {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'debug-overlay');
  Object.assign(el.style, {
    position: 'fixed',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '3px 8px',
    borderRadius: '6px',
    background: 'rgba(20, 14, 40, 0.55)',
    color: '#fff',
    font: '11px/1.4 ui-monospace, monospace',
    pointerEvents: 'none',
    zIndex: '10',
    whiteSpace: 'nowrap',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  const refresh = () => {
    const q = read();
    el.textContent = `${q.fps} fps · worst ${q.worstMs} ms · ${q.tier} · res ${Math.round(q.scale * 100)}% · dpr ${q.pixelRatio.toFixed(2)}`;
  };
  refresh();
  setInterval(refresh, 500);
  return {
    setVisible(v: boolean) {
      el.style.display = v ? 'block' : 'none';
      refresh();
    },
  };
}
