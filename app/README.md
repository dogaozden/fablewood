# Fablewood — engine + shell

Vite + React + TS shell hosting a Phaser 3 canvas. The engine is pack-agnostic:
domain knowledge lives in `packs/`, never in `app/`, and the engine builds with none installed.

**Layout:** `app/src/game` (Phaser scenes + registry), `app/src/packs` (pack schema + `validatePack`),
`app/src/bridge` (dev-server plugin + typed client), `app/src/App.tsx` (Dashboard / Game / Library tabs).

**Commands (from repo root):** `npm run dev` · `npm run build` · `npm test` · `npm run e2e` ·
`npm run check:zero-packs` · `node scripts/shot.mjs '/?scene=boot' screenshots/boot.png`

**Scene harness (dev):** `?scene=<key>&seed=<n>` boots any registered scene through the normal path
(default `boot`). Scenes register in `app/src/game/scenes/index.ts` and call `markReady()` at the end
of `create()` — that sets `window.__FABLEWOOD_READY`, which the screenshot + e2e harnesses wait on.

**Bridge API (dev only):** `GET /api/packs` → `{ packs: [{ id, dir, pack }] }` (reads `PACKS_DIR`,
default `./packs`; missing dir → empty). `GET|PUT /api/state/<name>` → JSON under `STATE_DIR`
(default `./state`; PUT is an atomic tmp+rename). A static build has no bridge; the client falls back to empty.
