# Business Quest: working notes for Claude Code

A fantasy RPG that teaches a full business administration degree through play. Read
`docs/ARCHITECTURE.md` (how the code is built) and `docs/DECISIONS.md` (owner decisions) first.
The original spec lives in the owner's head and the GitHub issues; issue #1 holds the definition
of done.

## Where things stand
- **Phase 0 (visual test slice) is complete** (issues #1–#14 closed). Owner decision: everything
  stays **code-built** (characters too), no paid AI asset tools; raise quality to "premium but
  handcrafted" (see `docs/DECISIONS.md`).
- **Phase 1 starts with three quality passes, in this order:** #41 world, #40 characters,
  #39 UI. Then #15 (curriculum check against Ashesi's catalog → `CURRICULUM.md`), #16 design doc,
  and on through #24. Regions are tracking issues #25–#35, split into issues when each starts.
- The live build: https://nana-kojo801.github.io/business-quest/

## How the owner works (follow this)
- **One issue at a time.** Build → automated tests → check phone-portrait and desktop → deploy →
  the owner tests on their phone → **only start the next issue after their sign-off.**
- The owner plays **on a phone, in portrait**. Check visuals at real phone pixel density
  (Playwright `devices['Pixel 7']`, full DPR) before handing anything over.
- **Don't spoil** story, mechanics or world design; describe what to try, not how it works.
- Speak plainly. Report honestly what failed and what was fixed.
- Ask them for the `?debug=1` line or the Settings → "Show frame rate" readout after visual
  changes; target 60 fps at 100% resolution **on medium** (check the readout says `medium`, not
  `low`: on Auto the game silently drops a tier when slow). No MSAA on phones (halved fps, #41).
  Before shipping, compare CPU-renderer frame cost against the last build that held 60 fps
  (interleave runs and take the best of three: single readings vary by 20%+).
- The readout's `worst N ms` is the slowest frame; a high number with a good fps means stutter.
  The owner also tests on an old 2018 Intel Mac (4 GB), which needs the low setting.
- They like the current handcrafted look and want it sharper and more premium, not realistic.
- Commit messages: say "Part of #N", **never "Closes #N"** (that closes issues before sign-off).
  Close issues on GitHub only after sign-off.

## Commands
- `npm run dev` / `npm run build` / `npm test` (unit via Vitest + browser via Playwright; browser
  tests take ~7 min, one worker, CPU rendering).
- `npm run typecheck` also checks that `src/core` has no DOM/three.js dependencies.
- Pushing to the repo's **default branch** runs CI and deploys to GitHub Pages
  (`.github/workflows/ci.yml` deploys only from the default branch). If a session works on a new
  branch, deploy by merging it into the default branch, or ask the owner.

## Debug URL options
`?quality=low|medium|high`, `?adaptive=0`, `?dpr=1.5` / `?msaa=0|4` (override every tier, for
measuring costs on the owner's phone), `?fps=30` (even 30 fps cap), `?debug=1`, `?sky=goldenHour|day|dusk`,
`?cam=close` (character close-up camera), `?spawn=x,z`, `?quest=meet|return|market|debrief|done`.
`window.__bq` exposes state for tests; `window.triBreakdown()` lists triangles per object.

## Architecture rules (enforced by tests)
- `src/core`: deterministic game state, plain JSON, changed only by commands (multiplayer-ready).
- Only `src/render` imports three.js. UI is DOM in `src/ui`; content is data in `src/content`.
- Every new world mesh goes through `atmosphere.adopt()` so it gets the shared fog.
- Procedural shaders sample the baked noise texture (`src/render/noiseTexture.ts`).
