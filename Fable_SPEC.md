# RETAINER
### a knowledge-retention RPG · the door into the Ledger Realms

> *Retainer* (n.) — 1. the fee that keeps counsel at your side. 2. one who retains.
> 3. a companion sworn to a lord's retinue. All three are this app.

**Provenance:** `SPEC.md` is the author's founding brain-dump (2026-07-09, preserved untouched, by request). This document is the compiled spec — the brain dump refined through the design proposal (`docs/superpowers/specs/2026-07-09-knowledge-platform-architecture-design.md`) and the full interview (2026-07-12 → 2026-07-19). Every decision below is **final** unless the author reopens it. Where the two documents disagree, this one wins.

---

## 1. North star

the author reads books, attends lectures, collects gems — and forgets them. Retainer is where knowledge goes to be *kept*: ingested from real sources into knowledge packs, then drilled through a genuinely good game until it welds into memory. Not a chatbot's knowledge base — **a knowledge base for a human**, where the retrieval practice is the fun part.

**The success bar (the author's explicit choice — "addiction only"):** at ~90 days (mid-October 2026), the experiment worked if he still opens Retainer voluntarily, repeatedly, without forcing himself. Retention is not the official metric — the bet is that if the pull is real, retention follows. *(Recorded risk: fun ≠ learning. Mitigation costs nothing: the SRS data computes retention stats anyway; the dashboard will quietly show them.)*

**The addiction mandate (his words: "i play whenever i want to. your job is to get me addicted"):** no prescribed session shape. Two interlocking loops — 5–15 min **bounty runs** (due-queue patrols, ghost-hunts) and long **dungeon crawls** (story arcs, setpiece bosses). Instant load, save anywhere, always-one-more-thing, streaks, cliffhangers, daily hooks.

## 2. Decision ledger (all FINAL)

| Area | Decision |
|---|---|
| Architecture | ONE engine, many **knowledge packs**; new domain = new pack, never new code. CI enforces: engine must build with zero packs installed |
| Pack #1 | **VC law**, seeded from *Venture Deals* (Feld/Mendelson) + **NVCA model documents** |
| Depth | **~300 facts v1**, with *expansion* as a first-class pipeline verb — new sources merge into a live pack without disturbing fact IDs or SRS history |
| LLM access | **No API keys, ever.** Runtime intelligence = headless `claude -p` / Agent SDK (Claude or Codex) on the author's subscriptions |
| World | **High fantasy: the Ledger Realms.** VC law = the Venture Coast |
| Combat | **Full grid tactics** — Fire Emblem/BG3-style movement, terrain, AoE, initiative |
| Stakes | **Teeth, but fair** — wrong answers cost HP/resources; wipes = retreat to camp (lose the loot roll, never story progress) |
| Pedagogy | **Teach AND test** — self-contained: mentor NPCs and discovered documents (verbatim source excerpts, cited) introduce facts; drills follow |
| Party | **Mastery-bound allies** — each province's companions scale with the author's mastery of that domain; neglect shows |
| Judge | **The Laconic Clerk** — verdict + one line, nothing more. Near-live via `claude -p` mid-combat ("the Clerk deliberates…"). Miss-pattern coaching lives on the dashboard, not in his mouth |
| Anti-staleness | **Reskin on repeat** — engine randomizes surface variables (names/numbers/option order) per showing; periodic agent rewrites of high-exposure wording. Facts + rubrics stay stable |
| Freshness | **Stamps now, sweeps later** — every fact carries `as_of` + source version from day one; automated supersession sweeps arrive with the maintainer agent |
| Quoting | **Verbatim + citation** (private personal use; repo private) |
| SRS | Leitner port from Bar repo: boxes 1–5, intervals 1/3/7/14/30 days; correct → box+1, miss → box 1 |
| Stack | Phaser 3 + TypeScript (game) inside Vite + React + TS shell; Python scaffolding + Claude-skills pipeline; Tone.js music-as-code; Claude-drawn pixel art via render→screenshot→critique→revise loop |
| Machines | One primary Mac. State = plain JSON, append-friendly formats so multi-machine can come later |
| Priorities | **Main quest = game/frontend + ingestion pipeline** ("that's the hard part"). the maintainer agent ops, phone capture, reader integration, MCP serving: parked |
| First dungeon | **Term sheet economics** — liquidation preferences, anti-dilution, option pools, pay-to-play |

## 3. The world (bible seed)

**The Ledger Realms** — a high-fantasy realm bound together by the Laws. the author is a **Retainer of the Great Ledger**, sworn to keep knowledge alive against **the Fade** — the creeping force that unwrites what is not renewed. Faded facts return as ghosts and monsters; renewing them (recall) drives them back.

- **The Venture Coast** (province #1): merchant-princes fund expeditions for a share of the spoils; their treaties are term sheets in all but name. A **dragon hoards unvested equity**. The Crown's Inquisitors enforce the Old Statutes — the '33 and '34 Codices.
- **The Laconic Clerk**: the Ledger's assessor. Appears when you cast from memory. Verdict, one line, gone.
- **Companions**: your retinue — each province contributes candidates whose power mirrors your mastery of their domain. The Venture Coast merchant-princess grows as your VC law solidifies; neglect a domain and watch its champion dim.
- **First dungeon:** *The Preference Vaults* — term sheet economics. Stacked-shield liquidation waterfalls, anti-dilution wraiths, an option-pool shuffle, and a pay-to-play gauntlet. Boss: a full term-sheet negotiation.
- New pack = new province (Tax: a bureaucracy-labyrinth; Semiconductors: a fab-forge across the sea). The metaphor layer is maintained deliberately — every game concept maps to a real mechanic, documented in the pack.

## 4. Knowledge packs (the contract)

`packs/<domain>/pack.json` + `assets/`:

- **meta**: id, title, version, sources[] (bibliographic + file paths into `raw/`)
- **facts[]**: `{id, type: rule|concept|advice|do|dont|number|story, statement, detail, source_ref {file, loc, quote}, as_of, source_version, tags[], difficulty 1–5, prereqs[]}`
- **encounters[]**: `{id, fact_ids[], kind: mcq|free_recall|scenario_branch|match|order, template_vars (parametric reskin slots), prompt, options/branches, answer, rubric, trap_notes}`
- **quests[]**: `{id, title, region, encounter_ids[], dialogue[], reward}` · **npcs[]**: pack-flavored characters
- **metaphor_map**: game-concept ↔ real-mechanic glossary (keeps the fantasy honest)

Hard rules (Culture-Wiki lessons): source_refs are **Python-validated against source text, never LLM-trusted**; facts that fail validation are skipped, not shipped. SRS state (`state/`) references fact IDs and lives outside packs — regeneration and expansion never touch learning history.

## 5. Pipeline (ingestion — main quest, part 1)

Deterministic Python + Claude-skill stages, per the design doc §4: `chunk` → **extract-facts** → validate → **merge-dedup** → **compile-pack** (scenarios, distractors, rubrics, quest dialogue — the creative stage) → `index` (schema-validate, funnel report). Plus the interview's addition:

- **`expand`**: ingest new source → extract → merge into the *existing* pack — stable fact IDs, SRS untouched, funnel report shows what's new vs merged. Growing a province never resets it.

Cerebras-post adoptions (ideas, not infra): distill-then-index (structured facts, never raw-text soup), burst-extraction for messy captures (every gem atomic, no session summaries), `as_of` freshness stamps, and — later, for MCP — narrow LLM-free tools with the calling agent as orchestrator. Explicitly rejected: embeddings/RAG infrastructure at this scale (Karpathy principle, proven by Culture-Wiki).

## 6. Game (main quest, part 2)

Engine systems (pack-agnostic, Phaser 3 + TS): overworld provinces + tilemap exploration; **grid-tactics combat** (movement, terrain, AoE, initiative); dialogue trees; retinue management; inventory/loot; XP/leveling; save/load to `state/`.

Knowledge ↔ mechanics: abilities fire by answering — answer quality sets damage/crit; enemy weaknesses by fact-type; `free_recall` = "cast from memory" (highest damage, Clerk-judged live); `scenario_branch` = dialogue encounters with consequences. **Mastery = progression**: a fact's Leitner box is its weld strength; quest gates need province mastery; Faded facts respawn as wandering ghosts; streaks feed lives/armor/damage (SPEC's ask).

**Vertical slice** (the build target): the Preference Vaults — ~30 facts, all five encounter kinds, grid combat v1, one companion, term-sheet-negotiation boss, one leitmotif, original sprites. Polished until *actually fun* — the only test that counts.

Art: Claude-drawn pixel sprite sheets via the Bar repo's critique loop (16px tiles, fixed palette, style contract; CC0 placeholders allowed only on dev branches). Music: leitmotifs as note-sequence data through Tone.js.

## 7. Shell

Vite + React + TS, local-first on the primary Mac. Panes: **Dashboard** (due queue, streaks, province mastery map, retinue status, miss-pattern coaching — the Clerk's silence lives here), **Game** (Phaser canvas), **Library** (pack/fact browser; reader-integration slot reserved). A small Vite plugin serves packs read-only and read/writes `state/` (SRS, saves, pending grades); the judge bridge shells out to `claude -p`.

## 8. Build order

0. Scaffold: repo layout, pack JSON Schema, CI (schema gate + engine-builds-empty) → *toy pack validates*
1. Pipeline MVP on NVCA model docs (public, fetched) → *golden-file tests + valid pack v0*
2. **the author drops Venture Deals into `raw/vc-law/book/`** (+ any posts) → full 300-fact compile → *funnel report + citation spot-check*
3. Vertical slice: the Preference Vaults → *the author plays it and it's fun*
4. Shell/dashboard around it → *due queue drives a session end-to-end*
5. Judge bridge (`claude -p`) live in combat → *free recall graded mid-fight*
6. Expansion run proves `expand` → *new source merges, SRS intact*

**Parked** (revisit on the author's word): the maintainer agent standing ops (mandate already chosen: nightly small + weekly deep, behind PRs), phone capture (likely text-the maintainer agent; `inbox/` contract exists now), supplement-reader integration, MCP serving, freshness sweeps, 3D/VR.

## 9. What Retainer needs from the author

1. Drop *Venture Deals* (digital copy) into `raw/vc-law/book/` — the only blocking input.
2. Optionally: named blog posts/memos into `raw/vc-law/posts/`.
3. Play the slice when it lands, and say when anything doesn't feel right — "that's the development process."
