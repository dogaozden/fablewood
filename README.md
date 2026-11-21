# Fablewood

A knowledge-retention RPG engine (the "Ledger Realms"): spaced repetition (Leitner boxes) wrapped in a Phaser/Three.js game, with a React shell and an optional Tauri desktop wrapper. Engine only; domain knowledge lives in **packs** (`packs/<id>/pack.json`, validated against `app/src/packs/pack.schema.json`).

This repository ships code only. A tiny made-up demo deck (`packs/demo`, tea basics) lets the app start. **Bring your own material**: write your own pack, point `PACKS_DIR` at it, and your learning state stays local in `state/` (git-ignored).

```
npm ci
npm run dev        # http://localhost:5173
npm run build
npm test
npm run check:zero-packs   # engine builds and passes with no packs at all
```

See `Fable_SPEC.md` and `SPEC.md` for the design, and `AGENTS.md` for how the code base is organised.
