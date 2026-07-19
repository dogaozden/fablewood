# FABLEWOOD — Vertical Slice Blueprint (binding for the beach run)

Orchestrator-authored 2026-07-19. This is the SHARED CONTRACT for all wave-2 agents. Where Fable_SPEC.md
is silent on mechanics, this document decides. Deviations require updating this file first.

## 1. Scenes & flow

Phaser scene keys (registered via the scaffold's SceneRegistry; jumpable via `?scene=<key>`):

| key | class | purpose |
|---|---|---|
| `boot` | BootScene | loads packs via bridge, builds textures from sprite data, sets `window.__FABLEWOOD_READY` |
| `hamlet` | HamletScene | walkable home hub (the Fablewood clearing) |
| `vaults` | DungeonScene | dungeon exploration (configured by a dungeon spec JSON from the pack) |
| `combat` | CombatScene | grid-tactics battle, launched with a payload, resolves back to caller |
| `ui` | UIScene | persistent overlay: dialogue boxes, encounter modals, HUD, toasts |

Flow: boot → hamlet ⇄ vaults; vaults rooms launch combat; combat resolves → vaults (or retreat → hamlet).
React shell wraps the canvas: top bar = FABLEWOOD wordmark, Dashboard/Game/Library tabs, mute toggle.

## 2. Module contracts (engine, all in app/src/)

- `packs/` (scaffold-owned): `loadPacks(): Promise<Pack[]>` via GET /api/packs; `validatePack`.
- `srs/leitner.ts`: `BOX_INTERVALS = {1:1, 2:3, 3:7, 4:14, 5:30}` (days). `record(state, factId, correct, now)` →
  correct: box+1 (cap 5); miss: box 1; sets next_due = now + interval. `dueQueue(state, factIds, now)` →
  due factIds sorted (overdue first, then lowest box); facts never seen = "new", appended in prereq order.
- `state/store.ts`: typed wrappers over the bridge — `state/srs.json` `{[factId]: {box, next_due, history: [{ts, correct, encounter_id}]}}`;
  `state/save.json` `{scene, pos, dungeon: {roomIndex, clearedRooms[]}, hp, streak, lastPlayed}`;
  `state/settings.json` `{muted}`. All writes go through PUT /api/state/<name> (atomic).
- `encounters/engine.ts`: `pick(due: string[], packs, opts)` → chooses encounter whose fact_ids overlap due
  (fallback: new facts in prereq order); `reskin(encounter, seed)` → substitutes template_vars + shuffles
  option order deterministically by seed. `encounters/ui/` renders the 5 kinds inside UIScene:
  mcq (4 options), free_recall (text input → judge), scenario_branch (dialogue choices), match (pair the
  columns), order (arrange steps). Each resolves `{quality: 0|0.5|1, factIds, kind}`.
- `judge/client.ts`: `judge({prompt, answer, rubric}): Promise<{verdict: 'pass'|'partial'|'fail', line: string}>`
  → POST /api/judge. Server plugin (`app/vite-judge-plugin.ts`) shells `claude -p` with the Laconic Clerk
  system prompt, `--output-format json`, model default (sonnet-class OK), 45s timeout. `JUDGE_MODE=stub`
  env → deterministic rubric-keyword heuristic (for e2e + offline). The Clerk's voice: verdict + ONE dry line.
- `music/`: adapted from staging/music — `music.play('hamlet'|'battle')`, `music.setMuted(b)`,
  `music.resumeContext()` (call on first user gesture). Mute state persists to settings.
- `art/`: palette.ts (generated from docs/art/palette.json), sprite data as palette-indexed string grids
  (per style contract), `buildTextures(scene)` at boot.

Cross-scene events via `game.events`: `encounter:result`, `srs:updated`, `combat:resolved`, `dialogue:open/close`.

## 3. Combat ↔ knowledge (the core loop)

Grid: 12×8 tiles (16px, 3× zoom), terrain from combat map spec: floor, wall (blocks), gold-heap
(difficult: costs 2 move), lantern (standing here = +1 answer-quality grace once/battle). Initiative:
speed-sorted queue, shown top bar. Party: the Keeper (player) + companion Mira the Factor (mastery-bound:
her ATK scales with province mastery = avg box of province facts).

Player turn = move (range 4) + one action:
- **Strike** (mcq) — standard attack. quality 1 → full dmg; 0.5 → half; 0 → whiff + take 1 chip dmg (teeth).
- **Binding Weave** (match) — AoE: each correct pair = one hit on each enemy in a cross.
- **Ritual Sequence** (order) — chain lance in a line; dmg scales with longest correct prefix.
- **Cast From Memory** (free_recall) — the big one: Clerk-judged. pass = 3× crit; partial = 1×; fail = 0 and
  the Fade counterattacks (2 dmg). Shows "the Clerk deliberates…" while judging (async, combat pauses).
- **Parley** (scenario_branch) — only vs. parley-flagged enemies/doors/boss phases: branch outcomes apply
  effects (good: enemy weakened/skips; bad: player HP loss).
Enemy turn: move toward nearest party member, melee 2 dmg (wraith: ranged line 1 dmg). Enemies die at 0 HP
(2-4 HP each). Encounter selection per action: due-queue facts first (goal: due queue DRIVES selection).

Teeth-but-fair: party HP pool (Keeper 10, Mira 6). Wipe → "The Fade closes in — you wake at the hamlet
camp": return to hamlet, dungeon roomIndex preserved (no story loss), loot roll forfeited, SRS results
still recorded (learning is never lost). Victory: loot toast + streak++.

## 4. The Preference Vaults (dungeon spec, pack-owned content)

Spec file: `packs/vc-law/assets/preference-vaults.dungeon.json` (engine reads it generically —
rooms[], each `{id, name, blurb, enemies: [{archetype, tags[], kinds[]}], parley?, teaching?: fact_ids[]}`).
Engine archetypes (domain-free): `wisp` (weak, tutorial), `wraith` (ranged), `construct` (tanky),
`warden` (boss). Teaching moments: entering a room shows its `teaching` facts as discovered documents
(teach-and-test: mentor text BEFORE drills — verbatim statement + detail + citation).

Rooms: 1 **Antechamber** (wisp ×2, mcq, teaching: liq-pref basics) → 2 **Waterfall Gallery** (wraith ×2 +
construct, match/mcq, participating vs non) → 3 **The Pool Below** (construct ×2, order/number, option pool)
→ 4 **Ratchet Corridor** (wraith ×3, free_recall gate door, antidilution) → 5 **The Warden's Vault** (BOSS).
Camp node at entrance: heal + save.

**Boss — the Vault-Warden** (term-sheet negotiation, 3 phases): each phase opens with a scenario_branch
(the Warden proposes a term — e.g. "2× participating preference, full-ratchet, 25% pool pre-money"; choices =
accept/counter/cite-the-rule with branch-specific consequences), then one free_recall "cite your authority"
strike. Good choices break the Warden's shields (3); bad ones = party HP loss + Warden heals 1. Victory =
the vault opens (quest reward + big streak bonus + return to hamlet with fanfare toast).

## 5. The hamlet (engine-owned world chrome; Ledger Realms lore is fine in app/)

Tilemap ~20×14, walk with arrows/WASD, E/Space to interact. Five locations (goal needs ≥4):
1. **Keeper's Cottage** — save/continue, later trophies.
2. **The Gilded Acorn** (tavern) — tavernkeep **Berry Bramblemaid**; rumors point at due topics ("folk say
   the Waterfall Gallery groans again…" when liq-pref facts are due); hearth flame size = streak.
3. **The Records Office** — the **Laconic Clerk**: shows due queue count, last verdicts, "the Ledger
   remembers" board (SRS state made diegetic).
4. **The Wellspring** — bounty runs: quick 3-encounter due-queue drill (no grid, rapid-fire modal), rewards
   a small loot roll. This is the 5-minute loop.
5. **The South Gate** — province select (from pack meta; provinces = installed packs) → the Venture Coast
   → the Preference Vaults. With zero packs: gate warden says the roads are quiet (engine-safe empty state).
NPCs: Clerk (terse, dry), Berry (warm, chatty), Gatewarden Alder (formal). Dialogue = simple tree data in
app/src/game/hamlet/dialogue.ts. Pack npcs[] appear IN the dungeon/province, not the hamlet.

## 6. Evidence & verification conventions (all agents)

- Screenshots → `screenshots/` (committed). Art critique archives → `docs/art-reviews/<slug>.md`.
- e2e uses `STATE_DIR=.state-e2e` + `JUDGE_MODE=stub`. Real-judge proof = one recorded transcript in
  handoff.md evidence (run manually once combat judge works).
- Playtest = drive the real dev server via Playwright (or shot.mjs), Read the PNGs, critique, fix, commit.
- Agents do NOT commit; the orchestrator reviews, commits, pushes per unit.
