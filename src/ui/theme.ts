// Bundled fonts (latin subset only, to keep downloads small; works offline).
import '@fontsource/marcellus/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';

/**
 * Shared look for all UI: colour tokens, fonts and a few reusable pieces
 * (panels, pill buttons, icon buttons). Warm gold and cream on deep plum glass,
 * matching the golden-hour world.
 */
const CSS = `
:root {
  --bq-gold: #f2cc7a;
  --bq-gold-deep: #c9973f;
  --bq-cream: #fff7e8;
  --bq-ink: #3b2418;
  --bq-glass: rgba(34, 22, 40, 0.62);
  --bq-glass-strong: rgba(28, 18, 34, 0.86);
  --bq-line: rgba(242, 204, 122, 0.45);
  --bq-title: 'Marcellus', 'Palatino Linotype', Georgia, serif;
  --bq-body: 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --bq-safe-t: env(safe-area-inset-top, 0px);
  --bq-safe-b: env(safe-area-inset-bottom, 0px);
  --bq-safe-l: env(safe-area-inset-left, 0px);
  --bq-safe-r: env(safe-area-inset-right, 0px);
}
.bq-ui { font-family: var(--bq-body); color: var(--bq-cream); -webkit-font-smoothing: antialiased; }
.bq-ui button { font-family: inherit; }
.bq-glass { background: var(--bq-glass); backdrop-filter: blur(8px) saturate(1.2); -webkit-backdrop-filter: blur(8px) saturate(1.2);
  border: 1px solid rgba(255, 236, 200, 0.14); box-shadow: 0 8px 26px rgba(20, 8, 20, 0.35); }
.bq-iconbtn { width: 46px; height: 46px; border-radius: 14px; border: none; padding: 0; cursor: pointer; color: var(--bq-cream);
  display: inline-flex; align-items: center; justify-content: center; transition: transform .12s ease, background .2s ease; }
.bq-iconbtn:active { transform: scale(.92); }
.bq-iconbtn svg { width: 24px; height: 24px; }
.bq-pill { border: none; cursor: pointer; border-radius: 999px; padding: 12px 20px; font: 700 15px/1.2 var(--bq-body);
  color: var(--bq-ink); background: linear-gradient(180deg, #fffaf0 0%, #f3dcae 100%);
  box-shadow: 0 4px 0 #b88c4c, 0 8px 18px rgba(30, 15, 20, 0.3); transition: transform .1s ease, box-shadow .1s ease; }
.bq-pill:active { transform: translateY(3px); box-shadow: 0 1px 0 #b88c4c, 0 4px 10px rgba(30, 15, 20, 0.3); }
.bq-hidden { opacity: 0 !important; pointer-events: none !important; }
@keyframes bq-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }
@keyframes bq-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
`;

let installed = false;
export function installTheme() {
  if (installed) return;
  installed = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}
