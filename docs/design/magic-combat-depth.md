# The Five Arts & Combat Depth — Design Handoff (execute-ready)

> Provenance: authored by the Fable systems designer, 2026-07-20, against master HEAD `1e92753`, after full recon of `Fable_SPEC.md`, `docs/design/inventory-handoff.md` (this doc's form model), `app/src/game/combat/**`, `app/src/game/encounters/**`, `app/src/srs/**`, `app/src/inventory/**`, `packs/vc-law/pack.json`, and `handoff.md`. the author's mandate: "i want it [magic] to be complex, you know?" + "this combat system isn't exactly bg3 hahah!". All file:line refs are against `1e92753` — re-verify anchors before editing. Isolation rules apply in full: agent worktrees, never port 5173, never `state/`, never `.state-e2e/`; own dev server 5178+ with `STATE_DIR=<scratch> JUDGE_MODE=stub`.
>
> `raw/dnd/` did not exist at design time — mechanics below borrow at the IDEAS level from tactical-RPG tradition (spell schools, conditions, reactions, forced movement, saving-throw-like counters), with zero verbatim text and zero D&D product identity; every mechanic is re-expressed in the Ledger Realms register.

## 0. SOUL GUARANTEES (binding on every section below)

FABLEWOOD is a knowledge-retention game. The friction economy (the author-approved, `Fable_SPEC.md` + damage.ts:4-18) DEEPENS here; it never dissolves. Every implementer and reviewer runs this checklist against any change:

- **S1 — No question-avoidant optimum.** There must be no build or line of play where avoiding encounters is optimal. (§5.4 carries the DPS math proving Strike-only play stays strictly worse.)
- **S2 — Never cap questions.** No mechanic may limit or discourage answering MORE questions. Tier-1 spells stay resource-free forever; Glow (§5) gates only the NEW power, on top of — never instead of — the question.
- **S3 — Grades are never faked.** No item, status, tile, or mercy mechanic may alter the recorded SRS quality. The lantern-grace pattern (CombatScene.ts:627-632 — soften DAMAGE, record honest quality) is the template for every mercy mechanic here. Statuses/Glow/weld read SRS state; they never write it.
- **S4 — A correct answer always pays.** No enemy mechanic may void the payoff of a correctly answered question. The Warden's Objection (§9) counters only FREE actions, by design — knowledge always lands.
- **S5 — Engine/content split is law.** Spell definitions are content-agnostic engine data (damage, shapes, conditions, encounter KINDS — no fact ids, no tags, no domain strings). Packs contribute only optional flavor labels and terrain/boss counts (§13). The engine must still build and fight with zero packs.
- **S6 — Clerk latency law.** free_recall (Clerk-judged, 9–15s warm per handoff.md) rides only player-opt-in casts on the player's turn — never forced per-turn checks, never enemy-turn interrupts.
- **S7 — `state/` is precious.** All save/pack changes are additive and optional; no fact ID, encounter ID, or existing save key changes meaning. §14 is the compatibility proof.

## 1. OVERVIEW — THE FIVE ARTS

The load-bearing design move: **a school of magic IS an encounter kind.** The five shipped actions become the tier-1 spells of five Arts; higher tiers are new spells cast through the SAME kind. To grow an Art you grow your knowledge (§6); to cast you still answer. Nothing shipped changes behavior at Rank 1 — a fresh player sees today's exact combat.

| Art | Encounter kind | Shape identity | Register | T1 (shipped, unchanged) |
|---|---|---|---|---|
| **Kindling** | mcq | single target, pushes, fire | the quick art — one true spark among false lights | Smite |
| **Binding** | match | cross AoE, snares | threads and true pairings; knots that hold | Binding Weave |
| **Ritecraft** | order | lines, sweeps | proper sequence; the procession that must not break | Ritual Sequence |
| **Attestation** | free_recall | single, wards, the apex | sworn testimony before the Clerk; verbatim authority | Cast From Memory |
| **Courtcraft** | scenario_branch | judgment, buffs/hexes | the merchant court; words that move people | Parley |

New systems, each paying rent in retention-mechanics or tactical texture:
- **Conditions** (§3): 8 statuses with clear counters — the BG3 texture layer.
- **Board & action economy** (§4): flanking, opportunity strikes, careful step, forced movement, 2 new tiles.
- **Glow** (§5): a small per-battle resource built by free actions AND by renewing due facts — the SRS due queue literally powers the greater castings.
- **Keeper's Rank** (§6): Leitner box distribution unlocks spell tiers — review is the XP system.
- **Spellbook** (§7): 15 spells (5 Arts × 3 tiers).
- **Enemy kits & AI** (§8), **the Warden reforged** (§9), **companions** (§10), **inventory intersection** (§11).

## 2. SCHEMAS (exact types)

New pure modules in `app/src/game/combat/`: `status.ts`, `spells.ts`, `arts.ts`. All Phaser-free, fully unit-tested, mirroring damage.ts/boss.ts/ai.ts's pattern (scene = thin driver).

```ts
// ---- status.ts ----
export type StatusId =
  | 'kindled'     // 1 dmg at owner's turn start; ticks then decrements
  | 'bound'       // move = 0 (may still act — Bound is not Silenced)
  | 'dimmed'      // move −1 (floor 1)
  | 'warded'      // damage-absorb pool (magnitude); no duration — spent by absorption or battle end
  | 'inked'       // takes +1 damage from every hit
  | 'emboldened'  // deals +1 on every damaging hit
  | 'weakened'    // deals −1 on every damaging hit (floor 0)
  | 'staggered';  // skips its next turn (migrates UnitState.skipNextTurn)

export interface StatusInstance { id: StatusId; turnsLeft: number; magnitude: number; }
// turnsLeft counts the OWNER's turn-ends. warded: turnsLeft = -1 (battle-long), magnitude = absorb pool.
// staggered: turnsLeft = 1 always; consumed at turn start.

export interface StatusDef {
  id: StatusId; label: string; glyph: string; tint: number;   // HUD chip (§12)
  stack: 'refresh';                                            // ONE rule for all: re-apply = max(turnsLeft), never additive
  tickStart?: (u: UnitState) => TickOp[];                      // kindled's dmg lives here
}
export type TickOp = { op: 'damage'; amount: number } | { op: 'consume' };

// applyStatus / clearStatus / hasStatus / statusMagnitude / tickTurnStart / decayTurnEnd — all pure.

// ---- types.ts additions ----
export interface UnitState /* extends existing */ {
  statuses: StatusInstance[];   // NEW — always [] at spawn; replaces skipNextTurn + Parley's permanent attack-1
  oaSpent: boolean;             // NEW — one opportunity strike per unit per round (§4.2)
  uniqueSpent: boolean;         // NEW — companion signature action, once per battle (§10)
}
// skipNextTurn: KEEP the field one release for save-less migration ease, but all reads/writes move to
// hasStatus(u,'staggered'). Delete the field in Phase 3.
export type TileType = 'floor' | 'wall' | 'gold' | 'lantern' | 'brazier' | 'mist';  // +2 (§4.4)

// ---- spells.ts ----
export type ArtId = 'kindling' | 'binding' | 'ritecraft' | 'attestation' | 'courtcraft';
export type SpellId =
  | 'smite' | 'cinder-rebuke' | 'lanternfall'
  | 'weave' | 'snare-knot' | 'lattice'
  | 'sequence' | 'processional' | 'rite-of-sealing'
  | 'cast' | 'attested-ward' | 'verbatim-decree'
  | 'parley' | 'heartening-word' | 'injunction';

export interface SpellDef {
  id: SpellId; art: ArtId; tier: 1 | 2 | 3;
  label: string; blurb: string;                    // parchment register, see §7 tables
  glowCost: 0 | 1 | 2;                             // tier 1 is ALWAYS 0 (soul S2)
  range: number;
  shape: 'single' | 'cross' | 'line' | 'self' | 'burst1' | 'ally';
  // burst1 = the caster's 4 orthogonal neighbours (crossTiles minus centre). ally = self or ally within range.
  effects: Record<'q1' | 'q05' | 'q0', SpellEffect>;
  bossRider?: 'strip-shield';                      // replaces wardenAbsorbs' string-match on 'cast' (§9, trap #10)
  banner: Record<'q1' | 'q05' | 'q0', string>;
}
export interface SpellEffect {
  hits: number;                 // primary-target damage (line: first tile; cross: centre)
  aoeHit: number;               // damage to each additional shape tile
  lineDepth: number;            // ritecraft only
  push: 0 | 1;                  // forced movement away from caster along the hit line (§4.3)
  status?: { id: StatusId; turns: number; magnitude?: number; where: 'primary' | 'all-hit' | 'party' | 'enemies' | 'target-ally' };
  fade: number;                 // party-pool backlash (Attestation misses only — the existing teeth)
  weaken?: boolean;             // legacy Parley plumbing; T1 parley only
  partyHit: number;             // Courtcraft 'bad' backlash
  heal?: { target: 'primary'; amount: number };    // Injunction-bad's enemy mend
}
// resolveSpell(def: SpellDef, quality: Quality, opts: ResolveOpts) → BoardOp[]  — the ONE dispatch.
// BoardOp = {op:'damage',targetId,amount} | {op:'status',targetId,id,turns,magnitude} | {op:'push',targetId,dir}
//         | {op:'fade',amount} | {op:'heal',targetId,amount} | {op:'banner',text} — the scene applies primitives
// in order. This retires the applyOutcome if/else chain (CombatScene.ts:653-680) and the per-action switch
// trap class (§16 trap 4). damage.ts's resolveAction remains as a thin adapter over resolveSpell for the five
// T1 ids so the shipped combat tests keep meaning; new tests target resolveSpell.

// ---- arts.ts ----
export interface ArtRanks { rank: 1 | 2 | 3; welded3: number; welded4: number; }  // one global Keeper's Rank (§6)
export function computeRank(boxOf: (id: string) => number, factIds: string[]): ArtRanks;
export const RANK2_NEED = 8;   // facts at box ≥ 3
export const RANK3_NEED = 8;   // facts at box ≥ 4

export interface GlowState { pips: number; }        // party-shared, 0..GLOW_CAP
export const GLOW_CAP = 3;
// glowGain(state, source) / glowSpend(state, cost) — pure, clamped, unit-tested.
```

Contract edits (`contracts.ts` is ORCHESTRATOR-OWNED — additive-only, one flagged block, same exception process the inventory got, contracts.ts:1-6):

```ts
// ---- arts (additive) ----
export interface SaveData { /* existing */ companion?: 'mira' | 'alder'; boon?: string | null; }
// BOTH new fields are primitives on purpose — SaveApi merges shallowly ({...base,...patch}, srs/store.ts:186);
// a nested object here would clobber on partial writes (§16 trap 3). Absent = 'mira' / null.
export interface EncounterRequest { /* existing */ flair?: string; }
// Optional spell title for the overlay eyebrow ("✦ Cinder-Rebuke · Multiple Choice") — §12.4.
```

No other contract changes. `CombatLaunch`, `CombatOutcome`, `SrsApi`, `InventoryApi` are untouched — rank/weld/due reads all ride the existing synchronous `services.srs.boxOf` / `dueQueue` / `masteryAvg` (contracts.ts:107-117; register.ts:36-54 backs them with in-memory cache after `ready()`).

## 3. CONDITIONS (the eight)

| Status | Effect (exact) | Turns | Applied by | Counter / relief | Chip |
|---|---|---|---|---|---|
| Kindled | 1 dmg at owner's turn START, then decrement | 2 | Lanternfall | wait it out; it cannot stack | ember `#d2792c` ▲ |
| Bound | `move = 0`; acting unaffected | 1–2 | Snare-Knot, Lattice, Injunction, Warden's Crown Injunction | constructs immune (§8); expires | orchid `#9a6ec8` ⌗ |
| Dimmed | `move −1`, floor 1 | 1 | wraith's Dimming Bolt | expires; stay out of LoF | dusk-violet ◗ |
| Warded | absorb pool: incoming damage consumes magnitude before HP | until spent | Attested Ward, Alder | none — spend it or keep it | water-blue `#4c6c96` ◈ |
| Inked | takes +1 damage from EVERY hit | 1–2 | Rite of Sealing, Mira's Appraise | expires | ink `#241a14` ✎ |
| Emboldened | deals +1 on every damaging hit | 1–2 | Heartening Word (either team!), Mira capstone | expires | moss `#7c9c46` ↑ |
| Weakened | deals −1 (floor 0) | 2 | Parley-good, Injunction | expires | stone-grey ↓ |
| Staggered | skips its next turn | 1 | Parley-good, Warden concession (boss.ts:21) | consumed on skip | dusk-peach ✱ |

**Rules (all of them, no exceptions):**
1. **Stacking:** re-applying a status REFRESHES `turnsLeft` to `max(old, new)`; magnitudes never add (except Warded, where re-applying sets `magnitude = max(old, new)` — a bigger ward replaces a smaller, never sums). One instance per StatusId per unit.
2. **Tick order at a unit's turn start:** (a) Kindled damage (may kill — death handled by the existing `damageUnit` choke point CombatScene.ts:972-989, statuses cleared on death, aura tweens killed like the danger pulse, trap 11); (b) Staggered check — consume and end the turn (replaces the skipNextTurn block CombatScene.ts:424-429, same banner voice).
3. **Decay at the OWNER's turn end:** decrement every duration status. Warded never decays.
4. **Damage pipeline on every hit (one function, `computeHit`, in status.ts — the only place modifiers stack):** `base + emboldened(+1) − weakened(−1) + flank(+1, §4.1) + overglow(+1, §5.3) + weld(+1, §5.5)` → floor 0 → `+ inked(+1)` if >0 → Warded absorbs → HP. Inked amplifies only real hits (a 0 stays 0).
5. **Round boundary** (`newRound` from `nextInOrder`, initiative.ts:25-39): reset every unit's `oaSpent`; reset the Warden's Objection (§9).
6. **Migration:** Parley-good currently sets `skipNextTurn + attack −= 1` PERMANENTLY (CombatScene.ts:676). It becomes `Staggered(1) + Weakened(2)`. Write a regression test proving attack no longer drifts downward across multiple parleys.
7. Statuses never touch encounter quality or SRS (soul S3). They are board-only.

## 4. BOARD & ACTION-ECONOMY DEPTH

### 4.1 Flanking (melee only)
When a range-1 attack (Strike, enemy melee, opportunity strikes) hits target T from attacker A, and the tile directly OPPOSITE the attacker (`O = T + (T − A)`) holds a living unit of A's team → **+1 damage**. Applies to both teams (wisps become real threats in pairs; the party's two units get a pincer game). Spells never flank — flanking is steel, answers are answers; spell math stays stable and legible. Preview: when targeting a Strike that would flank, the target tile gets a second inner outline in moss.

### 4.2 Opportunity strikes + Careful Step
- When a unit MOVES OUT of a tile orthogonally adjacent to a living opposing unit P, P immediately deals **1 damage** to it (flat, flank-eligible, no question — free-lane symmetry with Strike). Constraints: P must be alive, not Staggered; **max one opportunity strike DEALT per unit per round** (`oaSpent`); triggered at move time, resolved before the move animation completes (damage floats mid-path).
- **Careful Step:** while choosing a move, holding the modifier (or pressing `c` to toggle, §12.2) moves at **half move (floor, min 1)** and provokes nothing. The disengage decision lives AT move time, fitting the shipped move-then-act flow (CombatScene.ts:443-454) with zero new phases.
- Symmetric on purpose (teeth-but-fair): the party gets zoning; enemies punish sloppy repositioning. AI uses Careful Step too (§8).

### 4.3 Forced movement (push/pull)
`push 1` moves the target one tile directly away from the caster along the attack line (line spells: along the line's direction). Resolution, exact:
- Destination in-bounds, non-wall, unoccupied → target moves there (terrain entered normally; landing on gold costs nothing extra — cost is a movement concept).
- Destination is a wall, out of bounds, or occupied → target stays and takes **+1 bump damage**. **No domino pushes** — occupied means bump, never a chain.
- Pushes never trigger opportunity strikes (the mover didn't choose it).
- Pull (reserved for future spells) = same rules toward the caster. Implement `forceMove(unit, dir, board): {moved: boolean, bump: boolean}` in grid.ts beside crossTiles/lineTiles.

### 4.4 Two new tiles (extend the board language, don't replace it)
- **Brazier** (unlit lantern): blocking like a wall? NO — passable, cost 1. Any party unit ADJACENT to a brazier may light it with a free interact (`e` key on the active unit's turn, once per brazier): the tile becomes a **lantern** for the rest of the battle and the party gains **+1 Glow** immediately. A positioning objective that manufactures the lantern-grace/Glow geography mid-fight.
- **Mist**: passable, cost 1, but **blocks line-of-fire** (wraith LoF, `hasLineOfFire` grid.ts:181-191 treats it as blocking) and blocks Ritecraft lines the same way — for BOTH teams. Soft cover as terrain: two mist tiles make a lane the wraith cannot shoot across, and that your own Sequence cannot lance through. This is the whole cover system (§17 non-goal 4) at a fraction of the cost.
- Generation (grid.ts `buildLayout`, seeded, after gold/lanterns): braziers 0–1, mist patch 0–1 (patch = 2 contiguous interior tiles), never in spawn zones, never reducing lanterns below 1. Dungeon packs may pin counts via the additive room field `terrain?: { braziers?: number; mist?: number }` (clamped 0–2 / 0–3, §13).
- `tileCost` unchanged for both (1); `isBlocking` unchanged (wall only); LoF check gains `blocksSight(t) = t === 'wall' || t === 'mist'`.

### 4.5 Turn structure (formalized, unchanged skeleton)
Move (optional, with Careful Step choice) → Action (Strike / one spell / unique / Satchel / Wait) → passive reactions (opportunity strikes) happen on enemy turns. No bonus-action currency (§17 non-goal 7). Wait keeps its slot and gains no secret powers — Careful Step, not Wait, is the disengage.

## 5. GLOW — THE RESOURCE

One party-shared meter, 0–3 pips, per-battle, reset in `create()` (trap 1). Glow gates tiers 2–3 ON TOP of their questions; it never gates tier 1 (soul S2).

### 5.1 Sources
| Source | Glow | Rationale |
|---|---|---|
| A Strike that deals damage | +1 | free actions build toward greater castings — Strike stops being the boring floor |
| Party unit starts its turn on a lantern tile | +1 | positioning rent; makes lanterns contested ground beyond grace |
| Lighting a brazier | +1 | objective play |
| **Renewing a due fact**: an encounter resolves q1 AND ≥1 of its factIds was in the due queue at cast time | +1 | **the SRS loop is the mana engine** — the Keeper's oath (renewal drives back the Fade) made mechanical; a stocked due queue is fuel, so wanting to review is wanting to power up |
| Trimmed Wick boon (§11.3) | start at 1 | yesterday's Wellspring drills power today's crawl |
| Wick-Tallow / Lantern-Brand items (§11.1) | +1 / +2 | gold buys convenience, never answers (costs the turn via Satchel) |

### 5.2 Sinks
Tier 2 spell = 1 pip. Tier 3 spell = 2 pips. Overglow (§5.3) = 1 pip. Nothing else. Insufficient Glow greys the flyout row with reason `needs N glow` (ActionItem.reason plumbing, hud.ts:21-25).

### 5.3 Overglow (the upcast, Rank 2+)
Before confirming any spell with a damage component, the player may spend +1 Glow for **+1 primary damage** (max +1 per cast; toggle in the flyout, §12.2). One knob, real endgame decisions ("dump the wick before the room falls"), no second currency.

### 5.4 Anti-soul math (S1 proof obligation)
Strike ceiling: 1 base +1 flank +0 (no overglow without spells) = 2/turn, building 1 Glow/turn with nothing to spend it on. Gated floor at Rank 1: Smite q1 = 3 at range 2, Weave q1 = up to 6 across the cross, Cast q1 = 6. Enemy pressure answers back every round (attrition teeth, damage.ts:14-16) and kits (§8) raise round-cost further. The Warden remains literally unbeatable without Attestation (§9). Verify with a unit test on the tables: `max strike-turn damage < min(q1 tier-1 spell primary damage)` stays true after any tuning.

### 5.5 The weld edge (continuous mastery payoff)
If EVERY factId of the resolved encounter had `boxOf ≥ 4` **captured at cast time, before `record()` mutates boxes** (trap 14), a q1 cast deals **+1 primary damage** — banner: `The welded truth strikes true.` High-box facts rarely surface (the due queue prefers low/overdue — leitner.ts:113-150), so this is a mastery dividend you cannot farm: as the whole pack welds, everything hits harder. Never affects recorded quality (S3).

## 6. KEEPER'S RANK (spell learning)

**One global rank per active pack, derived from Leitner box distribution:**
- Rank 1 — always. The five shipped spells.
- Rank 2 — `≥ 8` facts at box ≥ 3. Unlocks all five T2 spells + Overglow.
- Rank 3 — `≥ 8` facts at box ≥ 4. Unlocks all five T3 spells.

Computation: pure `computeRank(boxOf, factIds)` over the battle's `allFactIds` (already built, CombatScene.ts:390-397), using the synchronous `services.srs.boxOf` (contracts.ts:114) — a 42-fact loop, zero contract changes, computed once in `loadContent()` and cached per battle (reset in create(), trap 1). Harness override `?rank=2|3` beside `?demo=1` (CombatScene.ts:104-105) — e2e/dev must not need a seeded SRS to test tiers.

Why ONE rank, not five per-Art ladders: per-Art ranks keyed to per-kind answer history would reward whichever kinds the engine happened to deal, not deliberate mastery (the due queue picks facts; the ACTION picks the kind) — illegible and grindable. One rank off box counts makes the promise exact: **review facts → clear boxes → the Greater Arts open.** The dashboard/HUD copy says it in one line (§12.5).

Pacing check against the author's live state (~6 runs in; live srs.json shows box-3s in a 42-fact pack): Rank 2 lands within days of normal due-clearing; Rank 3 is a deliberate multi-week weld — the box-4 interval is 14 days, so R3 is inherently a "you kept it alive" badge. Thresholds are tuning knobs (§18) — ship at 8/8.

## 7. THE SPELLBOOK (15 spells — exact numbers)

Numbers philosophy: T2/T3 lean CONTROL and riders over raw damage — enemy HP is small (wisp 2 / wraith 3 / construct 5 / warden 12, §8-9); big damage jumps would delete the tactics layer. Every spell's q0 wastes the turn (existing teeth); only Attestation carries Fade backlash (the apex risks more — shipped rule, damage.ts:10).

### Kindling (mcq) — the quick art
| Spell | Tier/Glow | Range/Shape | q1 | q0.5 | q0 |
|---|---|---|---|---|---|
| Smite | 1 / 0 | 2 / single | 3 | 1 | 0 |
| **Cinder-Rebuke** | 2 / 1 | 2 / single | 2 + push 1 (bump +1) | 1, no push | 0 |
| **Lanternfall** | 3 / 2 | self / burst1 | 3 to each adjacent enemy + Kindled(2) | 1 to each | 0 |

Blurbs: Cinder-Rebuke `A written ember that shoves. (multiple choice)` · Lanternfall `All the lantern's light at once. (multiple choice)`. Rationale: Kindling owns tempo — push into walls/heaps, burst when surrounded; mcq is the fastest overlay so it carries the highest cast cadence.

### Binding (match) — threads and true pairings
| Spell | Tier/Glow | Range/Shape | q1 | q0.5 | q0 |
|---|---|---|---|---|---|
| Binding Weave | 1 / 0 | 2 / cross | 2 centre + 2 arms | 2 centre only | 0 |
| **Snare-Knot** | 2 / 1 | 3 / single | 1 + Bound(2) | Bound(1), no dmg | 0 |
| **Lattice of True Names** | 3 / 2 | 2 / cross | 2 all + Bound(1) all | 2 centre + Bound(1) centre | 0 |

Blurbs: Snare-Knot `A knot of its own true name — it cannot step. (match)` · Lattice `Every name in the room, tied at once. (match)`. Constructs shrug Bound off (banner `Nothing in it to bind.`) — the counter that makes target choice matter.

### Ritecraft (order) — the procession
| Spell | Tier/Glow | Range/Shape | q1 | q0.5 | q0 |
|---|---|---|---|---|---|
| Ritual Sequence | 1 / 0 | 3 / line | 2 per tile, depth = q×3 | depth 1 | 0 |
| **Processional** | 2 / 1 | 3 / line depth 3 | 2 per tile + push 1 along the line (bump +1) | 1 per tile, no push | 0 |
| **Rite of Sealing** | 3 / 2 | 4 / line depth 4 | 2 per tile + Inked(2) each | 2 per tile, depth 2, Inked(1) first | 0 |

Blurbs: Processional `The rite sweeps them along its path. (put in order)` · Rite of Sealing `Struck through in the Ledger — marked things are struck true. (put in order)`. Mist blocks lines (§4.4); the push can shove a rank of enemies into a wall for bump damage — the formation-breaker.

### Attestation (free_recall) — sworn testimony, the apex
| Spell | Tier/Glow | Range/Shape | q1 | q0.5 | q0 |
|---|---|---|---|---|---|
| Cast From Memory | 1 / 0 | 3 / single | 6 (+strip shield vs boss) | 2 | 0 + Fade 2 |
| **Attested Ward** | 2 / 1 | 2 / ally | Warded(4) | Warded(2) | Fade 1 |
| **Verbatim Decree** | 3 / 2 | 3 / single | 8 — vs boss: 6 + strip shield | 3 | 0 + Fade 2 |

Blurbs: Attested Ward `Sworn protection, entered into the record. (recall — the Clerk judges)` · Verbatim Decree `The book's own words, cited to the letter. (recall — the Clerk judges)`. Both carry `bossRider: 'strip-shield'` on q1 like Cast — and §9 moves the shield gate from string-matching `'cast'` to this flag (trap 10). Latency: the deliberating veil (CombatScene.ts:611/623, kinds.ts:153-162) wraps all three; the Ward makes the 9–15s wait buy safety instead of damage, which reads fine at once-per-battle cadence.

### Courtcraft (scenario_branch) — the merchant court
| Spell | Tier/Glow | Range/Shape | good | bad | neutral |
|---|---|---|---|---|---|
| Parley | 1 / 0 | 1 / single (parleyable) | Staggered + Weakened(2) *(was: skip + permanent atk−1 — §3.6 migration)* | party −2 | nothing |
| **Heartening Word** | 2 / 1 | self / party | party Emboldened(2) | ENEMIES Emboldened(1) | nothing |
| **Injunction** | 3 / 2 | 2 / single | Bound(2) + Weakened(2) + Staggered | party −2, target mends 2 | Weakened(1) |

Blurbs: Heartening Word `The right word at the right moment — the retinue stands taller. (a branching choice)` · Injunction `A writ that stops them where they stand. (a branching choice)`. Heartening Word's bad branch handing ENEMIES Emboldened is the teeth — a botched speech rallies the wrong side. Courtcraft is the only Art whose outcomes ride branchTag, not quality (kinds.ts:221-223 — shipped semantics kept).

## 8. ENEMY KITS & AI DIRECTIVES

Stat changes: construct hp 4 → **5** (units.ts:21 — the bruiser must survive one full Weave to do its job). Everything else keeps shipped stats (units.ts:18-23).

| Archetype | Kit (new) | AI directive (decideEnemy v2, ai.ts) |
|---|---|---|
| **Wisp** (2hp, atk1, spd3) | none — wisps ARE the flanking rule in numbers | seek flank tiles: among attack-reachable tiles, prefer one whose opposite tile holds another enemy; else swarm softest target (shipped behavior) |
| **Wraith** (3hp, atk1, r3 LoF, spd4) | **Dimming Bolt** — its hit applies Dimmed(1): the kite that slows pursuit | keep range ≥ 2: if adjacent to a party unit, Careful Step away; move to tiles WITH clear LoF (mist-aware); never end adjacent if avoidable |
| **Construct** (5hp, atk2, spd2) | **Vault-Slam** — its melee hit pushes 1 (bump +1); **Bond-proof** — immune to Bound | guard: prefer tiles adjacent to a wraith or between the party and the wraith (interpose); slam direction chooses walls/heaps when tied |
| **Warden** | §9 | §9 |

Implementation: keep `decideEnemy` pure; add an `archetype` directive branch that reorders tile scoring (flank bonus −2 score for wisps, LoF+distance term for wraiths, interpose term for constructs) and a `carefulStep: boolean` on `AiIntent`. On-hit riders (Dimmed, push) resolve through the same `BoardOp` primitives as spells — `enemyStrike` (CombatScene.ts:921-936) emits ops instead of raw `damageUnit`.

## 9. THE WARDEN, REFORGED

Shipped skeleton kept: 3 shields; each phase opens with a forced scenario_branch (boss.ts:5-9, CombatScene.ts:780-821); branch-good −1 shield + stagger, branch-bad party −2 + mend (boss.ts:19-27); q1 Attestation strips an extra shield; shields 0 → vault opens (syncBoss, CombatScene.ts:880-887). New:

1. **hp 8 → 12** (units.ts:22 via makeBoss). Why: Verbatim Decree (6 vs boss ×2 casts = 12) must not out-race the negotiation — the fallback HP kill still requires two apex q1 answers, exactly the shipped bar. Phases stay the primary path.
2. **Shield gate generalizes** (trap 10): `wardenAbsorbs(action,...)` (boss.ts:44-46) becomes `wardenAbsorbs(spell: SpellDef | null, ...)` → absorbs while shielded unless `spell?.bossRider === 'strip-shield'` (Cast + Attested-anything damaging + Decree). Free actions and non-Attestation arts still bounce (`shielded`) — mandatory-questions invariant preserved and now type-safe.
3. **Objection!** (passive, resets each round): the FIRST free-lane hit (Strike or opportunity strike) against the Warden each round is negated and answered with a 1-damage riposte — banner `"Overruled."` Never triggers on any Art spell (soul S4 — knowledge always lands; only free steel gets lawyered). Matters most post-shields, when the party tries to brute the HP fallback.
4. **Phase script** (deterministic per phaseIndex; his normal turns between branches):
   - Phase 1 active: **Writ of Seizure** — melee attack with push 1 (bump +1). His base kit.
   - Phase 2+: every OTHER Warden turn, **Crown Injunction** — Bound(1) on the highest-HP party unit (r3, no LoF needed). Movement denial in a positioning fight; you can still act while Bound (§3), so no question is ever denied (S2/S4).
   - Phase 3+: once per battle, **Call the Clause** — spawn 1 wisp at a free enemy-spawn tile (max 1 clause-wisp alive at a time). Requires the small spawn machinery: `spawnReinforcement(spec, at)` creates unit + view mid-battle and appends its id to `order` (it acts from the NEXT round — appending to the initiative array is wrap-safe with nextInOrder, initiative.ts:25-39).
5. Labels are engine-generic ("Crown Injunction", "Writ of Seizure", "Call the Clause" — fantasy, zero domain strings); packs may relabel via `boss.moveLabels?: Record<'seizure'|'injunction'|'summon', string>` (additive, optional, §13) and should mirror them in `metaphor_map`.

## 10. COMPANIONS (mastery-bound retinue)

**Party stays TWO units — the Keeper plus ONE chosen companion.** The pooled-HP invariant (16 = 10 + 6) is hardcoded in ≥7 places with no shared const (trap 7); a 3-unit party would change `save.hp` semantics and touch every one. Instead: a pre-dungeon CHOICE with real buildcraft. Both companions use the 6-HP slot (applyPoolHp's split math CombatScene.ts:264-284 unchanged).

- **Choice flow:** the South Gate conversation (Alder's province select, HamletScene doGate pattern) gains one page: "Who rides with you?" → Mira / Alder → `services.save.save({ companion: chosen })` (primitive field, §2). CombatScene spawns `makeMira` or `makeAlder` off `save.get().companion ?? 'mira'` (spawnUnits, CombatScene.ts:233-251). Party unit ids stay literal `'keeper'|'mira'` +new `'alder'` (trap 9 — extend the literals, don't refactor the roster this pass).
- **Companions cast all five Arts at the Keeper's Rank** — it is the author's knowledge either way; the retinue mirrors the Keeper (spec: mastery-bound allies). Each companion adds ONE signature free action on the `e` hotkey (the hamlet's interact key — same language), once per battle (`uniqueSpent`).

**Mira the Factor** (shipped unit, units.ts:58-63) — the appraising blade:
| masteryAvg (pack) | Effect |
|---|---|
| < 1.5 | **dimmed by neglect**: speed 4→3, no signature, no bonus — the spec's "neglect shows," visibly |
| ≥ 1.5 | baseline + signature **Appraise** (free, r2, once/battle): Inked(1) — `"She names the true price of its hide."` |
| ≥ 2.5 | existing +1 primary-hit bonus (MIRA_MASTERY_GATE, units.ts:29 — kept exactly); Appraise → Inked(2) |
| ≥ 4.5 | capstone: enemies felled while Inked pay **+2 gold** each (through `services.inventory.addGold` at resolveBattle, victory only) |

**Alder the Gatewarden** (new unit kind `'alder'`; hamlet sprite `char.alder` exists) — the wall:
| Stat | hp 6 · move 3 · speed 2 · attack — (party units attack via actions) |
|---|---|
| masteryAvg < 1.5 | dimmed: speed 2→1, no signature |
| ≥ 1.5 | signature **Hold the Gate** (free, self, once/battle): self Warded(2), each adjacent ally Warded(1), and **Gatestand(2)** — a 9th, Alder-only status: while active, enemy AI target-scoring prefers Alder when he is attack-reachable (a taunt the AI honors, not a hard rule) |
| ≥ 2.5 | Hold the Gate → self Warded(3), adjacent allies Warded(2) |
| ≥ 4.5 | capstone: the party starts every battle Warded(1) |

Slow speed is his identity: he moves LAST (initiative.ts sorts speed-desc), so his wards land after the enemy's round opens — placing him is the skill. Balance note: Alder trades Mira's damage bonus for mitigation; both must clear the same fights (verify by demo-piloting both through the fixture rooms).

## 11. INVENTORY INTERSECTION (items aid, never answer)

### 11.1 Two new catalog items (additive; ids are state-referenced once shipped — never rename)
```
wick-tallow     · common · consumable · {kind:'glow', amount:1} · value 25 · use:'combat' · sellable:false
                  "Render of old lantern-tallow — the wick drinks it greedily."
lantern-brand   · rare   · consumable · {kind:'glow', amount:2} · value 70 · use:'combat' · sellable:false
                  "A splint from the First Lantern's own fire, banked in wax."
```
- `ItemEffect` union gains `{kind:'glow'; amount:number}`; `use` union gains `'combat'` (catalog.ts:12-17). The field pane greys them (`title="Only in battle"`); Mira's shop stocks wick-tallow (+lantern-brand at shop tier if desired — knob).
- Combat Satchel: `usableSatchelItems` (combat/satchel.ts:29-34) widens its filter to `heal | glow`; a glow use adds pips (clamped at GLOW_CAP — at cap it refuses like a full-vigor heal: `ok:false, "The wick is already bright."`), consumes the item through the same `services.inventory.useItem` choke point, and **spends the turn** (existing satchel flow CombatScene.ts:743-776). consume.ts's field-side `useItem` returns `{ok:false,'Only usable in battle.'}` for glow — mirror of the trial-tool line (consume.ts:14-35).
- Soul check: a turn + gold for ≈ a Strike's worth of Glow — convenience, never power, never answers (S3).

### 11.2 Aid tools (reveal_option / retry_cast / streak_shield)
Still DEFERRED, unchanged — they touch the encounter surface and carry their own hard wall (inventory-handoff §10, satchel.ts:8-15 header). This design does not collide with or consume that scope. Do not implement them here.

### 11.3 Trimmed Wick (the Wellspring boon — ritual casting's payoff)
Completing a Wellspring bounty session (the existing 3-drill loop, HamletScene) sets `save.boon = 'trimmed-wick'` (toast: `"The wick is trimmed — tomorrow's lantern lights easier."`). The next battle consumes it at create(): start at Glow 1, then `save.save({ boon: null })`. Cap: one boon held; re-earning refreshes, never stacks. Out-of-combat review now hands tomorrow's crawl a visible head start — the daily-hook loop (spec §1) gains a mechanical tooth.

## 12. UX SPEC

### 12.1 Action bar (unchanged at Rank 1 — zero regression)
The 8-button bar stays (hud.ts:150-190, ACTIONS keys types.ts:63-102): `[1] Strike · [2] Smite · [3] Binding Weave · [4] Ritual Sequence · [5] Cast From Memory · [6] Parley · [q] Satchel · [7] Wait`, plus `[e] <Signature>` shown only on a companion's turn with one unspent. Hotkey language 1-7/q/e/c preserved.

### 12.2 The tier flyout (Rank 2+)
Pressing/clicking an Art with rank ≥ 2 opens a small vertical flyout above that button: one row per unlocked tier — `[1] Smite · free`, `[2] Cinder-Rebuke · ◈1`, `[3] Lanternfall · ◈2` — plus, when a damaging tier is highlighted and Glow allows, an Overglow toggle row `[o] Overglow +1 · ◈1`. Keys 1/2/3 pick tier, `o` toggles, Esc closes (back to menu). Rows grey with reasons: `needs Rank 3`, `needs 2 glow`, `no target in range` (ActionItem.reason plumbing). At Rank 1 no flyout ever appears — press = cast T1, today's exact flow. Phaser-drawn (containers like showActionMenu), NOT a DOM pane — it must not quiet the keyboard.

### 12.3 Meters & chips
- **Glow pips**: 3 diamond pips beside the streak in the party strip (updateParty, hud.ts:198-218), lantern-gold filled / shadow-plum empty, +pulse on gain. PartyStatus gains `glow: number` (additive).
- **Rank line**: under the room name — `Keeper's Rank II` and, pre-rank-3, a quiet carrot: `5/8 welded toward Rank III` (welded4 count). This one line is the retention hook rendered visible.
- **Status chips**: up to 3 six-px glyph chips (colors §3) directly under a unit's HP bar (drawHpBar, CombatScene.ts:328-354), overflow `+`. Hovering a unit shows a one-line banner: `Bound 1 · Inked 2` (pointer-move handler exists, CombatScene.ts:1070-1088).
- **Warded** renders as a thin water-blue underline beneath the HP bar sized by remaining pool.

### 12.4 Overlay flair
T2/T3 casts pass `flair: spell.label` through `EncounterRequest` (§2) → `presentEncounter` → `setHeader` (overlay.ts:122-134) renders the flair in the eyebrow's action slot: `✦ Cinder-Rebuke · Multiple Choice`. T1 casts pass nothing — shipped eyebrows (dom.ts:36-43) unchanged. Do not touch the two same-named ACTIONS exports beyond this (trap 5).

### 12.5 Hamlet surface (Phase 4, light)
The Records Office conversation gains one page: the Clerk states your Rank and welded counts in his voice (`"Rank II. Eleven truths hold at weld. He does not elaborate."`). No new pane this pass — the full spellbook browser is a named stretch (§17 non-goal 9).

## 13. ENGINE/CONTENT SPLIT & PACK ADDITIONS

**Where spells live — the decision:** spells, statuses, ranks, Glow are ENGINE data in `app/src/game/combat/` — they reference encounter KINDS only, never facts/tags/domains (S5). Packs need ZERO changes for the entire system to function (the vc-law pack as-is powers all 15 spells through its existing 49 encounters). The engine keeps building with zero packs; fixtures stay mosslore-generic (fixtures.ts:2-5).

Optional additive pack/dungeon-spec fields (validator: accept-if-absent, clamp ranges, never required):
```
DungeonRoom.terrain?: { braziers?: number (0-2); mist?: number (0-3) }
BossSpec.moveLabels?: { seizure?: string; injunction?: string; summon?: string }
```
vc-law Phase-3 content (additive, no fact/encounter ID touches): `moveLabels` in the Vault-Warden's spec dungeon file (e.g. seizure `"Writ of Seizure"`, injunction `"Injunction of the '33 Codex"`, summon `"Call the Clause"`), + `metaphor_map` entries mapping each to its real-mechanic meaning. `EnemySpec.kinds` stays dead (trap 12) — do not build on it.

Reskin-on-repeat: untouched — reskin operates on encounters (engine.ts:90-131); spells are engine surface, not reskin surface.

## 14. STATE & PERSISTENCE (compatibility proof)

- **No fact IDs, encounter IDs, or item IDs are renamed or removed.** New item ids (§11.1) are new state references — immutable once shipped.
- **save.json**: two new OPTIONAL primitive fields (`companion`, `boon`). Absent-field defaults (`'mira'`, `null`) mean every existing save loads and plays identically. Primitives survive the shallow one-level merge (srs/store.ts:186) by construction; writers still send whole values. NOTHING else in SaveData changes; pooled `hp` semantics (0-16) unchanged.
- **srs.json**: read-only to this feature (boxOf/dueQueue/masteryAvg reads). No writes beyond the existing honest `record()` path.
- **inventory.json**: unchanged shape; two new stackable ids appear only when granted/bought.
- **Per-battle state** (statuses, Glow, rank cache, oaSpent/uniqueSpent, brazier/mist board state, spawned reinforcements, Objection flag) is NEVER persisted — all of it joins the create() reset block (trap 1).
- Playwright/e2e always run `STATE_DIR=.state-e2e JUDGE_MODE=stub` on their own port; the manual server uses a scratch STATE_DIR. `state/` is never created or touched by any test (shipped discipline, handoff.md).

## 15. PHASED ROLLOUT (each phase leaves the game fully playable)

Sequencing logic: the board gets deep first (enemy threat rises), then the player's power answers it (Arts), then the apex + boss, then the retinue. Each phase = own worktree branch, merged only on its verification bar. Within a phase, sections split across parallel Sonnets as listed (pure modules are parallel-safe; CombatScene wiring is ONE owner per phase — it is the merge-conflict magnet).

### Phase 1 — Conditions & the living board (shippable alone)
Scope: §3 status system (status.ts + UnitState.statuses + migration of skipNextTurn/parley-weaken), §4 complete (flanking, opportunity strikes, Careful Step, forced movement, brazier/mist tiles + generation + LoF), §8 kits + AI v2, construct hp 5, HUD status chips + hover line (§12.3 chips only).
Files: NEW `combat/status.ts`; EDIT `combat/types.ts`, `grid.ts`, `ai.ts`, `units.ts`, `damage.ts` (flank/computeHit), `CombatScene.ts` (ONE owner), `hud.ts`, `textures.ts` (2 tile bakes + 8 status glyphs — every texture through the style-contract §6 critique gate, archive `docs/art-reviews/combat-depth-v1.md`), `fixtures.ts` (+1 kit-showcase mosslore room).
Parallel split: (a) pure logic status.ts+grid+damage+tests · (b) ai.ts+units+tests · (c) textures+art gate · (d) CombatScene+hud wiring (starts after a/b land).
Verify: unit — tick order, refresh-not-stack, bound-still-acts, construct Bound immunity, push bump/no-domino, OA once-per-round, careful-step half-move, flank geometry, parley no-permanent-drift regression, computeHit pipeline order. e2e (stub) — `combat-status.spec`: seeded fixture, snare a wisp → assert it doesn't move; push into wall → bump damage in actionLog; status chip visible. Full battery green (build, vitest ≥ current 247, e2e ≥ 16) + screenshots (chips, mist lane, brazier light-up).

### Phase 2 — The Five Arts & Glow
Scope: §2 spells.ts/arts.ts, §5 Glow (sources incl. due-renewal surge + weld edge + Overglow), §6 ranks + `?rank=` override, §7 T2 spells (all five), §12.1-12.4 (flyout, pips, rank line, overlay flair), §11.1 glow items + satchel widening, `EncounterRequest.flair` + SaveData fields (FLAGGED orchestrator contract edit, additive block).
Files: NEW `combat/spells.ts`, `combat/arts.ts`; EDIT `damage.ts` (adapter), `CombatScene.ts` (flyout flow, glow accounting, dueFactIds → `{ids, dueSet}` so the surge reads cast-time dueness — trap 14), `hud.ts`, `contracts.ts` (flag), `encounters/register.ts`+`overlay.ts`+`dom.ts` (flair pass-through), `inventory/catalog.ts`+`consume.ts`+`combat/satchel.ts`, textures (T2 spell HUD icons? — no: flyout is text rows, no new action icons needed).
Verify: unit — resolveSpell table snapshots (all 15 rows × 3 qualities), glow clamp/sources/sinks, rank thresholds, weld-edge capture-before-record, S1 math test (§5.4), adapter equivalence for T1 (resolveAction === resolveSpell on the five). e2e — `combat-glow.spec` (strike → pip; T2 cast spends it), `combat-rank.spec` (`?rank=2` flyout opens; rank 1 never shows it), satchel glow item in battle. Battery + screenshots (flyout, pips, flair eyebrow).

### Phase 3 — Apex & the Warden reforged
Scope: §7 T3 spells, §9 complete (hp 12, wardenAbsorbs → bossRider flag, Objection, phase script, Call the Clause spawn machinery), §13 vc-law moveLabels + metaphor_map (content-only commit), delete `UnitState.skipNextTurn`.
Files: EDIT `combat/spells.ts`, `boss.ts`, `units.ts`, `CombatScene.ts`, `packs/vc-law/*` (additive; run validate_pack + validate_quotes), validator additive rules in `pipeline/validate_dungeon`/pack schema.
Verify: unit — Objection strike-only (NEVER an Art — S4 test), absorb-flag matrix (each of 15 spells vs shielded Warden), spawn initiative wrap-safety, boss survives 1× Decree q1 (phases stay mandatory). e2e — `boss-reforged.spec` (stub): Objection banner on strike, clause-wisp appears, full negotiation still completes; existing boss e2e stays green. Battery + validators + screenshots.

### Phase 4 — Retinue & ritual
Scope: §10 (Alder unit+art+ladders, Mira ladder incl. Appraise, `e` signature slot, Gatestand AI hook, South Gate companion choice), §11.3 Trimmed Wick, §12.5 Records Office rank line.
Files: EDIT `units.ts`, `combat/status.ts` (gatestand), `ai.ts`, `CombatScene.ts`, `hud.ts`, `textures.ts` (Alder combat sprite — art gate), `scenes/hamlet/HamletScene.ts` + `content.ts` (gate page, wellspring boon, records line).
Verify: unit — ladder thresholds both companions, uniqueSpent, gatestand scoring, capstones, boon consume-once. e2e — `companion-choice.spec` (choose Alder → reload → combat spawns Alder; save shows `companion:'alder'`), `wellspring-boon.spec` (3 drills → boon → next battle opens at Glow 1 → boon null). Battery + screenshots (Alder in battle, gate choice page).

## 16. NAMED TRAPS DIGEST (verify anchors at HEAD before editing)

1. **Scene-reuse reset** — CombatScene is ONE reused instance; create()'s manual zero-block (CombatScene.ts:118-145) is the only leak guard (observed live: duplicated party). EVERY new per-battle field (statuses, glow, rankCache, oaSpent, uniqueSpent, objectionUsed, spawned views, brazier state, dueSet) joins that block. Reviewer checklist item, every phase.
2. **HMR / live tree** — the author plays on 5173; never edit the main tree while his server lives (handoff protocol). Worktrees + announced merges only; the vite-hmr-guard full-reload plugin exists but is not permission to edit live.
3. **Shallow save merge** — `{...base,...patch}` one level deep (srs/store.ts:186). New SaveData fields are PRIMITIVES by design; never add a nested object to save without whole-object writes at every writer.
4. **Silent-default action dispatch** — validTargets `default: return []` (CombatScene.ts:540) and the applyOutcome else-chain (653-680) swallow missed cases silently. Phase 2 RETIRES this class: targeting + application become SpellDef/BoardOp-driven; a missing SPELLBOOK row is a type error, not a silent no-op. Until then (Phase 1), any touched switch gets an exhaustiveness `never` check.
5. **Two same-named ACTIONS exports** — combat/types.ts:63 (ActionKind-keyed) vs encounters/dom.ts:36 (EncounterKind-keyed). Don't create a third; spells.ts exports SPELLBOOK, arts.ts exports ARTS.
6. **Two RNG seed-mix families** — engine.ts's makeRng XORs `0x9e3779b9`; combat/rng.ts + economy.ts seed mulberry32 raw. New board gen (brazier/mist) uses combat's family (`layoutSeed`), stated in a comment.
7. **Pool-16 hardcoded ≥7 sites** (DungeonScene.ts:42, srs/store.ts:30, consume.ts:12, satchel.ts:21, CombatScene.ts:265-284 twice, hud) — the companion-choice design EXISTS to avoid touching them. Do not "fix" the const sprawl in this feature (surgical-change rule); Alder slots into the 6-HP position.
8. **combat:resolved handshake** — the real channel is game-event + registry PENDING_KEY (DungeonScene.ts:39,131-136,307-316); scene.start init-data `combatOutcome` is a decoy. Don't route new outcome data through init data. (Nothing here needs CombatOutcome changes.)
9. **Party ids are literals** — `'keeper'|'mira'` hardcoded (CombatScene.ts:268-269,745-746,1176-1177). Add `'alder'` the same way; a roster refactor is out of scope.
10. **wardenAbsorbs string-matches 'cast'** (boss.ts:44-46) — with tiers this breaks (Decree/Ward must pierce). Phase 3 moves the gate to `SpellDef.bossRider`. Until Phase 3, T2 spells simply don't pierce (correct behavior anyway).
11. **Tween/aura leaks** — status auras/pulses follow the danger-pulse pattern (CombatScene.ts:312-321): kill tweens on death AND on scene shutdown; reviveView precedent (287-292) shows the undo shape.
12. **EnemySpec.kinds is dead** (contracts.ts:53) — never consumed anywhere; don't build on it, don't delete it this pass.
13. **Fixtures stay fantasy-generic** (fixtures.ts:2-5) — new fixture rooms use mosslore ids only; the engine/content CI gate (`check:zero-packs`) must stay green every phase.
14. **Capture SRS reads BEFORE record()** — weld edge (boxOf) and due-surge (dueQueue membership) are decided by cast-time state; `record()` mutates boxes immediately (store.ts:107-126). Snapshot `{dueSet, allWelded}` before awaiting record. A test seeds a box-4 fact, answers q1 (→ box 5), asserts the weld bonus used the PRE-record box.
15. **Overlay teardown leaves promises unresolved by design** (overlay.ts:50-65) — every new await site in CombatScene follows the existing `if (this.destroyed) return;` discipline after any await (pattern at CombatScene.ts:622,719,761,799).
16. **Satchel/aid-tool wall** — the trial tools (reveal/retry/streak) remain out of scope with their SRS-honesty rules intact (inventory-handoff §10). Glow items must not open that door.

## 17. EXPLICIT NON-GOALS (named, with reasons)

1. **No slots / per-battle caps on questions** — capping questions caps retrieval reps; the entire point inverts (S2). Glow gates only surplus power.
2. **No mid-enemy-turn question interrupts** (counterspells, reaction-casts with prompts) — flow death + Clerk latency (S6). All reactions here are free-lane and automatic (OA, Objection).
3. **No concentration subsystem** — exactly one candidate spell (a sustained ward) can't pay for the machinery (break checks, per-caster tracking, UI). Warded-as-pool delivers 80% of the feel. Revisit when 2+ sustained spells exist.
4. **No elevation / facing / true cover** — the board is a flat 12×8 with orthogonal LoF; mist tiles deliver the cover DECISION (deny lanes) at ~1% of the cost. Facing adds bookkeeping the sprite language can't even show.
5. **No per-Art XP ladders** — usage-based or per-kind progression rewards grinding whichever overlays the engine deals, not deliberate mastery; one box-derived Rank keeps the promise legible (§6).
6. **No new enemy archetypes** — four kits deepened beats five kits shallow; new archetypes arrive with province #2's pack, where reskin gives them native names.
7. **No second resource / bonus-action economy** — Glow is the one new currency; a bonus-action lane doubles every menu and halves legibility.
8. **No spell purchasing with gold, no spell scrolls-as-unlocks** — knowledge, not gold, buys power (S1). Gold buys Glow convenience (§11.1) and heals — aid, never answers, never access.
9. **No spellbook browser pane this pass** — rank+welded lines in HUD and the Records Office cover the need; a full pane is Phase-5+ polish (parked, not forgotten).
10. **No changes to encounter kinds, reskin, grading, or the Clerk** — the knowledge spine is load-bearing and shipped; magic wraps around it, never through it.
11. **No 3-unit party** — §10's rationale (pool-16 minefield); companion CHOICE is the buildcraft instead.

## 18. TUNING KNOBS & DEFAULTED QUESTIONS FOR THE AUTHOR

Knobs (all consts, one per module, named here so playtests turn them without design review): `GLOW_CAP=3`, `RANK2_NEED=8`, `RANK3_NEED=8`, OA damage `1`, flank bonus `+1`, bump damage `+1`, weld bonus `+1`, brazier/mist gen counts, construct hp `5`, warden hp `12`, all SpellDef numbers (§7 tables), companion ladder thresholds (`1.5/2.5/4.5`).

Defaulted calls the author may veto (none block Phase 1):
1. **Symmetric opportunity strikes** (enemies punish you too) — defaulted YES for teeth-but-fair; flip to party-only if it feels mean on the small board.
2. **Companion choice-of-one vs 3-unit party** — defaulted choice (save-compat + buildcraft); a 3-unit party is a deliberate future migration, not a tweak.
3. **Rank pacing 8/8** — defaulted; if Rank 2 should land THIS week, drop RANK2_NEED to 6.
4. **Overglow at +1 max** — defaulted conservative; +2 for 2 pips is a one-line knob if the endgame wants bigger dumps.
