# Funnel report — compile-run-1 (pack compile)

**Pack:** `vc-law` → `packs/vc-law/pack.json` · **Goal 2**
**Stage:** compile-pack (Fable_SPEC §5) · **Date:** 2026-07-19

## Inputs (staying source-of-truth)
- `packs/vc-law/facts.staging.json` — 42 citation-validated facts (never clobbered)
- `packs/vc-law/content.staging.json` — meta + encounters + quests + npcs + metaphor_map

`pipeline/compile_pack.py` merges them into `pack.json` (keys in schema order:
meta, facts, encounters, quests, npcs, metaphor_map; unicode preserved).

## Output — `packs/vc-law/pack.json`
- **facts:** 42 (≥30 required)
- **encounters:** 46 (≥40 required) — mcq 17, free_recall 10, scenario_branch 9, match 5, order 5 (all 5 kinds)
- **quests:** 6 (Threshold Ledger → Stacked-Shield Waterfall → Option-Pool Shuffle → Anti-Dilution Wraiths → Pay-to-Play Gauntlet → the Vault-Warden's Term Sheet)
- **npcs:** 4 (the Laconic Clerk, Seraphine the merchant-princess companion, the Vault-Warden boss, Archivist Mendel the teaching mentor)
- **metaphor_map:** 12 game↔real entries (array form with notes) — keeps the fantasy honest per §3

## Encounter design
- **Fact coverage:** 42/42 facts referenced by ≥1 encounter (nothing orphaned).
- **Kind → combat action** (per `docs/design/slice-blueprint.md`): mcq=Strike, match=Binding Weave (AoE), order=Ritual Sequence, free_recall=Cast From Memory (Clerk-judged), scenario_branch=Parley. All five are combat-meaningful.
- **Rubrics:** every free_recall carries a string rubric with full/partial credit criteria, shaped for the `Judge({prompt, answer, rubric})` contract in `app/src/game/contracts.ts`.
- **Distractors + trap_notes:** every mcq documents why each wrong option is tempting (pre/post confusion, head-fake conversion, additive-cap misread, stacked-vs-blended swap).
- **Numeric answers verified against the book:** nonparticipating $5M/20%/$100M → $20M (converts); fully participating → $24M; 3× cap over 1× pref = incremental 2×; stacked $5M A/$20M B on a $15M sale → B takes all; blended → $3M/$12M; 18-month vest → 37.5%.
- **Reskin:** 8 encounters carry `template_vars` (deal/founder/investor names, deal figures) for the engine's `reskin(encounter, seed)` surface randomization. Answer-determining numbers are kept static so substitution never breaks correctness.

## Validation (all green)
- **Schema (ajv, engine schema + same options as `validatePack.ts`):** `node pipeline/validate_pack.mjs` → PASS. Beyond JSON Schema it cross-checks: unique ids; every `encounter.fact_ids` and `quest.encounter_ids` resolves; mcq `answer` ∈ options; order `answer` is a permutation of options; match pairs drawn from the two columns; free_recall has a rubric; scenario_branch has a correct branch; every `{{var}}` in a prompt is defined; ≥30 facts / ≥40 encounters / all 5 kinds.
- **Engine schema-gate (vitest):** `npm test -- src/packs/__tests__/validatePack.test.ts` → 7/7 PASS.
- **Citation gate (100%):** `python3 pipeline/validate_quotes.py packs/vc-law/pack.json` → 42/42 quotes verbatim.

## Reproduce
```
python3 pipeline/compile_pack.py
node   pipeline/validate_pack.mjs
python3 pipeline/validate_quotes.py packs/vc-law/pack.json
npm test -- src/packs/__tests__/validatePack.test.ts
```

## Note for the dungeon/combat author
Encounter ids are stable and readable (`enc.<kind>.<slug>`) for `DungeonSpec` gates and boss phases. The boss quest `q.vaults.warden` already groups the negotiation set: `enc.sb.liquidation-event` / `enc.sb.competition` / `enc.sb.convdebt-acquisition` (parley branches) plus `enc.fr.dec-doriot` / `enc.fr.convdebt` (cast-from-memory strikes) — a ready spine for the three-shield Vault-Warden fight (`BossPhase.branchEncounterId` + `recallTags`).
