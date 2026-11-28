# Rally – notes for Claude Code

Browser game: rally simulator with a Colin McRae 2005 feel (realistic physics, forgiving assists),
a career with money/upgrades, fictional cars and brands. See README.md for architecture and controls.

## Commands

```sh
npm install
npm run dev           # Vite on :5173
npm run typecheck
npm run test:physics  # runs in Node, must always be green
npm run test:account  # account: key, sanitizing, merging
npm run test:career   # career: purchases, daily bonus, prizes, upgrades
(cd sync && npm run typecheck)  # the sync server; run `npm run types` after changing wrangler.jsonc
npm run build:single  # a single HTML file in dist-single/
```

Run `typecheck`, `test:physics`, `test:account` and `test:career` before committing (and the sync server's typecheck if `sync/` or `src/account/protocol.ts` changed). If you change the physics, check that
the tests' ranges (0–100, braking distance, lateral grip, crash) still hold, and only adjust
them deliberately.

## Rules

- `src/physics/` is pure TypeScript. Import only `three` (math), never `three/webgpu`, the DOM or `window`.
- Fixed physics step at 240 Hz, decoupled from rendering.
- Coordinates: the car's local x = left, y = up, z = forward. Positive steering angle = left.
- Cars and brands are fictional. Never use real brand or model names.
- Stages are real roads from open map data (OpenStreetMap, ODbL, in `src/physics/real/`) that
  give the source in `StageDef.credit`. Use place names, never a rally's trademark, as stage names.
  The tests have two fictional stages as fixtures (`tests/stages.ts`).
- Language: UI text in Swedish (for now). Everything else in the repo — code, comments, identifiers,
  docs including Markdown files, test output, commit messages — in English.
- Graphics: WebGPU only. `?webgl` exists only for debugging in environments without WebGPU.

## Tips

- A WebGPU canvas does not show up in headless screenshots. Use `?webgl` to verify the scene visually.
- On slow computers the frame time is capped at 50 ms, so the simulation then runs in slow motion.

## Next steps (phase 1)

Phase 1 is done: the spline stage (`src/physics/stage.ts`), timing (`src/physics/timing.ts`), the ghost (`src/physics/ghost.ts`), dust (`src/render/dust.ts`), pace notes (`src/physics/pacenotes.ts`) and the engine sound.
Main and pause menus exist (`src/menu.ts`). Account and record sync exist (`src/account/`, `sync/`). Career with wallet, garage, car dealer and championships exists (`src/career/`). Tyres are chosen before the start (`src/tyreMenu.ts`). Class 2 (three faster cars, its own parts and championships) unlocks once class 1 is won. All stages are real roads from Rally Sweden and Royal Rally of Scandinavia, split into parts per championship (see README). Next: see README.
