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
scene (HDR) -> painterly filter -> bloom -> tone mapping (Khronos Neutral) -> colour grade -> screen
```

`src/render/quality.ts` picks a tier (phones start on medium, desktops on high), then lowers
render resolution when frames are slow and drops a tier if that is not enough.

| Tier | Max pixel ratio | Painterly radius | MSAA | Shadows |
|---|---|---|---|---|
| low | 1 | off | off | off |
| medium | 1.5 | 2 | off | 1024 |
| high | 2 | 3 | 4x | 2048 |

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
