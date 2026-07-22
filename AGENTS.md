# FABLEWOOD — Rules for Codex agents

Knowledge-retention RPG (cozy high fantasy, the Ledger Realms). You are implementing against binding specs written by the design team. **Source of truth: `Fable_SPEC.md`** (decisions final). `SPEC.md` is the founder's brain dump — NEVER edit it. `handoff.md` = live status ledger (read for context; the orchestrator writes it). Design docs in `docs/design/` are binding when your brief names them.

## Hard rules
- **NO API KEYS, EVER.** All LLM calls in this repo go through subscription CLIs. Never add a key, an env var for a key, or a paid-API dependency.
- **Engine/content split:** `app/` never contains domain knowledge (no VC/law/pack-subject text, not even in tests — invent neutral fixtures); `packs/` never contains code. `npm run check:zero-packs` must stay green: the engine builds and passes its full test suite with zero packs installed.
- **`state/` is precious** (SRS history, saves, grades): never write, migrate, or delete it. Same for `~/Library/Application Support/realm.ledger.fablewood/` (the native app's live data — the founder is often mid-playthrough). Tests and dev servers use an isolated `STATE_DIR` (e2e uses gitignored `.state-e2e`).
- **Pack stability:** never change fact IDs, encounter IDs, `kind`, or `fact_ids` on existing content — player SRS state references them. `*.staging.json` files are parked expansions awaiting the founder's decision: don't touch.
- **Ports 5173, 5175, 5219 are reserved.** 5175 belongs to the playwright suite's own webServer (use it only by running the checked-in config; if busy, wait — never kill the holder). Ad-hoc/scratch servers go on 5400+ with their own `STATE_DIR` and `JUDGE_MODE=stub`. Never kill processes you didn't start.
- **Priority: the game actually working and looking good** beats breadth, elegance, and cleverness.

## Verification culture
- "It should work" ≠ "it works." Run the real thing: `npx vitest run` (repo root), `npm run build`, `npm run check:zero-packs`, `node pipeline/validate_pack.mjs packs/vc-law/pack.json` after any schema change, `npx playwright test` for player-visible changes. Report actual numbers, never summaries of intentions.
- Tests accompany changes. If a binding doc specifies test cases (truth tables, literal regime numbers), implement them exactly as written.
- Honest failure beats confident fabrication: if a tool call or generation fails, say so and stop — never substitute hand-rolled lookalike output for real results. (This has been caught here before; logs get read.)

## Layout
`app/` engine (Phaser + TS) · `packs/` content JSON · `pipeline/` content tooling · `e2e/` playwright · `src-tauri/` native shell (Rust) · `docs/` design + art history. Conventional commits (`feat:`/`fix:`/`content:`/`docs:`…). Match surrounding code style; touch only what your brief names.
