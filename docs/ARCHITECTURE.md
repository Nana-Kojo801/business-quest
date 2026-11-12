# Architecture

The code is split into layers so multiplayer can be added later without a rewrite.

```
devices -> controller -> transport -> simulation -> view
(input)    (input)       (net)        (core)        (render)
```

| Layer | Folder | Job | May import |
|---|---|---|---|---|
| Core | `src/core` | Game state and rules. Plain JSON data, fixed 60 Hz deterministic steps, changed only by commands. | nothing outside `src/core` |
| Input | `src/input` | Reads keyboard/touch and turns it into commands for the local player. | core types, net |
| Net | `src/net` | Delivers commands. `LocalTransport` feeds the local simulation; a network transport can replace it. | core |
| Render | `src/render` | Draws the state with three.js. Reads state, never writes it. Interpolates between ticks for smooth motion. | core types, three |
| Wiring | `src/game.ts` | Connects the layers and runs the frame loop. | everything |

## Rules (enforced by `npm run typecheck` and unit tests)

- `src/core` compiles with no DOM and no three.js (`tsconfig.core.json`).
- Only `src/render` imports three.js.
- Game state changes only through `Command`s, so the same commands on the same ticks give the same result anywhere.

## Adding multiplayer later

1. Write a network `CommandTransport` that sends commands to a server.
2. Run the same `Simulation` on the server; broadcast state snapshots.
3. Clients apply snapshots and keep predicting their own player locally.

No changes to core rules or rendering are needed for that.

## Rendering

`src/render/pipeline.ts` runs each frame through:

```
scene (HDR) -> painterly filter -> sharpen -> bloom -> tone mapping (Khronos Neutral) -> colour grade -> screen
```

`src/render/quality.ts` picks a tier (phones start on medium, desktops on high), then lowers
render resolution when frames are slow and drops a tier if that is not enough.

| Tier | Max pixel ratio | Painterly radius | MSAA | Shadows |
|---|---|---|---|---|
| low | 1 | off | off | off |
| medium | 1.75 | 1 | off | 1024 |
| high | 2 | 2 | 4x | 2048 |

URL options: `?quality=low|medium|high`, `?adaptive=0`, `?debug=1` (fps overlay).

## Sky, light and fog

`src/render/sky/Atmosphere.ts` owns the sky dome, sun (with shadows), ambient light and fog,
all driven by a preset in `src/render/sky/presets.ts` (`goldenHour` default, `day`, `dusk`;
choose with `?sky=`).

The sky colour function lives in shared GLSL (`atmosphereGlsl.ts`). World materials are
patched (`atmosphere.adopt(object)`) so their fog uses the same function: distant things
fade into exactly the sky colour behind them, and the ground meets the sky without a seam.
Any new world mesh must go through `adopt`.

Shadows follow the player and are snapped to shadow-map texels to avoid shimmering.
Shadow resolution is part of the quality tier (off on low).

## Terrain

The land is defined once, as pure math, in `src/core/terrain.ts` (`heightAt`, `isWalkable`,
`pathMask`, layout in `TERRAIN`). It uses integer hashing rather than `Math.sin`, so every
browser computes identical heights; a snapshot test guards this. The simulation uses it to keep
players out of the lake and inside the valley (sliding along boundaries), and the renderer builds
the ground mesh from it (`src/render/terrain/Terrain.ts`), colouring it in a shader: warm and
cool grass patches, brush-stroke breakup, sandy shores, worn paths and rock on steep slopes.

## Water and shared noise

`src/render/noiseTexture.ts` bakes a tiling four-octave noise texture at startup. Shaders sample
it (`bqNoiseA..D`, `bqFbm`) rather than computing noise per pixel, which is much cheaper on phone
GPUs. Use it for any new procedural shader.

`src/render/water/Water.ts` draws the lake: colour by depth (baked per vertex from `heightAt`),
sky reflection using the shared sky colour function, sun glints that catch the bloom, breathing
shore foam, and the shared atmospheric fog.

## Vegetation and rocks

- `src/core/flora.ts`: deterministic tree and boulder placement (clear of paths, spawn, water
  and the plateau top). `src/core/collision.ts`: walkability including trees and rocks; players
  slide around them.
- `src/render/terrain/groundData.ts`: a texture baked at startup with height, grass density and
  flower density, read by vegetation vertex shaders.
- `src/render/flora/Field.ts`: grass and flowers wrap around the player on the GPU (no per-frame
  CPU work). Geometry must carry a normal attribute, or three.js silently flat-shades it.
- `src/render/flora/Trees.ts`: instanced code-built trees (three shapes) with crown-centred
  normals for soft painted shading, wind sway, backlit rim glow, and a dither dissolve for
  anything between the camera and the player. Simple trees cover the lower mountain slopes.
- `src/render/flora/Rocks.ts`: instanced faceted boulders with moss, and small shore/path stones.

Counts scale with the quality tier (`grass`, `flowers`, `farTrees`, `pebbles`).

## Buildings and props

`src/core/structures.ts` lays out the landmark tower (on the plateau, door facing the end of the
path), the market stall at the fork, the signpost and lanterns along the main path; all block
movement. `src/render/structures/Buildings.ts` builds each one from simple shapes, merged into
one painted mesh plus one glowing mesh per structure; glowing parts use colours above 1.0 so
the bloom picks them up. Buildings dissolve when they come between the camera and the player.

## Atmosphere and ambient motion

`src/render/ambient/`: GPU point clouds for drifting motes (sparkle when backlit), fireflies
(strength follows the sky preset: none by day, faint at golden hour, bright at dusk) and petals
falling from blossom trees; light shafts as camera-facing strips on an artistic, mostly upright
axis leaning toward the sun (an exactly sun-aligned beam collapses on screen when the sun is
ahead); and a small flock of birds with wing flaps in the vertex shader. Counts are part of the
quality tier (`particles`, `lightShafts`).

## Characters

`src/render/characters/Character.ts` builds anime-style characters from code:
- Shape: smooth lathe profiles for body and limbs (profiles are normalised bottom-to-top so faces
  point outward), clothing with folds, hair from tapered curving strands with a glossy band, and
  a hand-drawn face (`face.ts`, canvas atlas with a blink frame) wrapped onto the shaped head.
- Skeleton: hips > torso > head / arms / two-part cape; legs > shins > feet; spring-driven back
  hair and cowlick.
- Shading: soft cel ramp, sunlit rim, thin ink outlines (inverted hull), contact shadow.
- Motion: eased speed; weight shift; hips/torso counter-rotation; arm lag; knee lift, foot roll
  and toe-off; leaning into acceleration and turns; head steadied and leading turns; springs on
  cape and hair that overshoot and settle; idle breathing, glances and blinking.

Appearances live in `looks.ts`. Villagers are placed in `src/core/npcs.ts` (they block
movement), turn to face a nearby player, and glance around otherwise. `?cam=close` is a debug
close-up camera for judging characters.

## Controls and camera

- `src/input/devices.ts`: keyboard (WASD/arrows, Shift to walk, E/Space to interact), mouse
  (drag to orbit, wheel to zoom) and touch (floating joystick in the lower-left area; drag
  elsewhere to orbit; pinch to zoom). All pointer input lands on the `#controls` surface.
- `src/ui/controls.ts`: joystick visuals, the context action button (bottom-right, thumb reach,
  safe-area aware) and the desktop key prompt. `src/ui/bubbles.ts`: speech bubbles over heads.
- `src/render/CameraRig.ts`: eased orbit camera. Portrait keeps the player low in a closer frame;
  landscape sits further back and lower. Gentle auto-follow on touch only. Never dips below the
  ground or looks through hills.
- Interaction goes through the core: `interact` command + `interactTarget()` (nearest villager in
  reach, preferring ones in front); the result is stored on the player state, so the UI prompt,
  the simulation and future multiplayer agree.
- Debug: `?spawn=x,z` starts the player elsewhere.

## UI

All UI is DOM over the canvas, styled from `src/ui/theme.ts` (colour tokens, bundled fonts:
Marcellus for titles, Nunito for text; SVG icons in `icons.ts`).
- `dialogue.ts`: conversation box (typewriter, tap/Space/E to continue, numbered choices);
  bottom band with stacked choices in portrait, choices beside it on wide screens. Scripts are
  data in `src/content/dialogue.ts`.
- `hud.ts`: objective tracker, menu button, arrival banner. `menu.ts`: Journal, Codex,
  Settings (quality, camera sensitivity, FPS readout; saved in localStorage).
- `src/game.ts` runs the screen flow (explore / dialogue / menu): movement and camera input are
  ignored outside explore, and a conversation swings the camera to a two-shot that keeps faces
  above the dialogue box (`CameraRig.conversation`).
- UI files never import three.js; anything needing 3D (screen projection) goes through the view.

## Quests (first slice)

- `src/core/market.ts`: pure market rules (willingness to pay, quantity demanded, settle a day,
  clearing prices). `place` command for scripted positioning.
- `src/content/`: dialogue scripts, market data (shoppers' limits, rounds), Codex entries.
- `src/quests/firstQuests.ts`: hand-written stage machine for the opening (meet → return →
  market → debrief → done); the general quest engine (#18) replaces it.
- `src/render/scenes/MarketScene.ts`: the market crowd (raised hands, buyers walk to the counter,
  those who missed out stomp off) and its camera shot. `src/ui/pricing.ts`: price panel, results,
  and the Ledger Lens tags above heads.
- Debug: `?quest=meet|return|market|debrief|done` jumps to a stage.

## Sound, loading and performance

- `src/audio/AudioEngine.ts`: all sound generated with the Web Audio API (no files): wind,
  birdsong, lapping water by distance to the lake, generative pentatonic music, footsteps (grass
  vs path), UI taps, dialogue blips per speaker, chimes, coins. Starts on the first user gesture,
  suspends when the tab is hidden; Music and Sound volumes in Settings.
- `index.html` contains the loading screen, so it shows before any script loads; `main.ts` fades
  it after `renderer.compileAsync` has prepared every shader and the first frames have drawn.
- Characters are skinned meshes (one skeleton, body/cloth/outline meshes: ~5 draw calls each).
  Valley trees are instanced per 32 m cell so culling works for the camera and the shadow map;
  far trees use low-detail crowns. Medium tier: ~130 draw calls, ~445k triangles (was 226 / 709k).
- Debug: `window.triBreakdown()` lists triangles per scene object; `__bq.renderInfo` gives calls.
