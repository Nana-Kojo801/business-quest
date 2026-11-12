# Architecture

The code is split into layers so multiplayer can be added later without a rewrite.

```
devices -> controller -> transport -> simulation -> view
(input)    (input)       (net)        (core)        (render)
```

| Layer | Folder | Job | May import |
|---|---|---|---|
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
