import { STICK_RADIUS, type Input } from '../input/devices';

/**
 * On-screen controls drawn over the game: the floating joystick, the context
 * action button (bottom-right, in thumb reach) and, on desktop, a key prompt.
 * Also creates the full-screen surface that receives pointer input.
 */
const CSS = `
#controls { position: fixed; inset: 0; z-index: 5; touch-action: none; }
.bq-stick { position: fixed; width: ${STICK_RADIUS * 2}px; height: ${STICK_RADIUS * 2}px; margin: -${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px;
  border-radius: 50%; pointer-events: none; transition: opacity .2s ease;
  background: radial-gradient(circle, rgba(255,248,232,.10) 0%, rgba(255,248,232,.22) 68%, rgba(255,240,210,.5) 71%, rgba(255,240,210,0) 74%);
  box-shadow: inset 0 0 18px rgba(255,236,200,.25); }
.bq-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #fffaf0 0%, #f6e3bd 55%, #d9b779 100%);
  box-shadow: 0 4px 14px rgba(60,30,20,.35), inset 0 -3px 6px rgba(150,100,40,.35); }
.bq-stick.idle { opacity: .55; }
.bq-action { position: fixed; right: calc(22px + env(safe-area-inset-right)); bottom: calc(34px + env(safe-area-inset-bottom));
  width: 78px; height: 78px; border-radius: 50%; border: none; padding: 0; cursor: pointer; z-index: 6;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: #4a2e1c; font: 700 12px/1 system-ui, sans-serif; letter-spacing: .02em;
  background: radial-gradient(circle at 38% 30%, #fffaf0 0%, #f6e3bd 55%, #e0b866 100%);
  box-shadow: 0 6px 18px rgba(60,30,20,.4), 0 0 0 3px rgba(255,246,225,.55), inset 0 -4px 8px rgba(150,100,40,.35);
  transform: scale(.6); opacity: 0; pointer-events: none; transition: transform .22s cubic-bezier(.3,1.6,.5,1), opacity .18s ease; }
.bq-action.show { transform: scale(1); opacity: 1; pointer-events: auto; }
.bq-action:active { transform: scale(.92); }
.bq-action svg { width: 30px; height: 30px; }
.bq-prompt { position: fixed; left: 50%; bottom: calc(40px + env(safe-area-inset-bottom)); transform: translate(-50%, 8px);
  padding: 9px 16px 9px 10px; border-radius: 22px; display: flex; align-items: center; gap: 10px; z-index: 6;
  color: #fff7e8; font: 600 15px/1 system-ui, sans-serif; pointer-events: none;
  background: rgba(38,24,40,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgba(20,10,20,.3); opacity: 0; transition: opacity .18s ease, transform .18s ease; }
.bq-prompt.show { opacity: 1; transform: translate(-50%, 0); }
.bq-key { min-width: 26px; height: 26px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(#fffaf0, #e9d3a6); color: #4a2e1c; font-weight: 800; font-size: 13px; box-shadow: 0 2px 0 #b8925a; }
.bq-hint { position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top)); transform: translateX(-50%); z-index: 6;
  color: rgba(255,247,232,.92); font: 500 13px/1.4 system-ui, sans-serif; text-shadow: 0 1px 3px rgba(30,15,20,.6);
  pointer-events: none; transition: opacity 1s ease; white-space: nowrap; }
`;

const TALK_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 5C9 5 4 9.3 4 14.6c0 2.9 1.5 5.4 3.9 7.2L7 27l5.3-2.9c1.2.3 2.4.4 3.7.4 7 0 12-4.3 12-9.9S23 5 16 5z"/><circle cx="11" cy="14.7" r="1.8" fill="#f6e3bd"/><circle cx="16" cy="14.7" r="1.8" fill="#f6e3bd"/><circle cx="21" cy="14.7" r="1.8" fill="#f6e3bd"/></svg>`;

export interface Controls {
  surface: HTMLElement;
  /** Call each frame with the input state and what (if anything) can be interacted with. */
  update(input: Input, action: { label: string } | null): void;
}

export function createControls(onAction: () => void): Controls {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const surface = document.createElement('div');
  surface.id = 'controls';
  document.body.appendChild(surface);

  const stick = document.createElement('div');
  stick.className = 'bq-stick idle';
  stick.setAttribute('data-testid', 'joystick');
  const knob = document.createElement('div');
  knob.className = 'bq-knob';
  stick.appendChild(knob);
  document.body.appendChild(stick);

  const action = document.createElement('button');
  action.className = 'bq-action';
  action.setAttribute('data-testid', 'action-button');
  action.innerHTML = `${TALK_ICON}<span>Talk</span>`;
  const label = action.querySelector('span')!;
  // Pointer events on the button must not reach the surface (or they'd orbit the camera).
  action.addEventListener('pointerdown', (e) => { e.stopPropagation(); onAction(); });
  document.body.appendChild(action);

  const prompt = document.createElement('div');
  prompt.className = 'bq-prompt';
  prompt.setAttribute('data-testid', 'action-prompt');
  prompt.innerHTML = `<span class="bq-key">E</span><span>Talk</span>`;
  const promptLabel = prompt.lastElementChild as HTMLElement;
  document.body.appendChild(prompt);

  const hint = document.createElement('div');
  hint.className = 'bq-hint';
  document.body.appendChild(hint);
  let hintShown = false;
  setTimeout(() => (hint.style.opacity = '0'), 6000);

  return {
    surface,
    update(input, act) {
      const touch = input.touchMode;
      if (!hintShown || hint.dataset.touch !== String(touch)) {
        hintShown = true;
        hint.dataset.touch = String(touch);
        hint.textContent = touch ? 'Left thumb to move · drag to look · pinch to zoom' : 'WASD to move · drag to look · scroll to zoom · E to talk';
      }

      // Joystick: hidden on desktop; on touch it rests faintly bottom-left and jumps to the thumb.
      stick.style.display = touch ? 'block' : 'none';
      if (touch) {
        const s = input.stick;
        if (s.active) {
          stick.classList.remove('idle');
          stick.style.left = `${s.originX}px`;
          stick.style.top = `${s.originY}px`;
        } else {
          stick.classList.add('idle');
          stick.style.left = `calc(${STICK_RADIUS + 34}px + env(safe-area-inset-left))`;
          stick.style.top = `calc(100% - ${STICK_RADIUS + 46}px - env(safe-area-inset-bottom))`;
        }
        knob.style.transform = `translate(${s.dx * STICK_RADIUS}px, ${s.dy * STICK_RADIUS}px)`;
      }

      action.classList.toggle('show', touch && !!act);
      prompt.classList.toggle('show', !touch && !!act);
      if (act) {
        label.textContent = act.label;
        promptLabel.textContent = act.label;
      }
    },
  };
}
