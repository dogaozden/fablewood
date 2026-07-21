# Difficulty & Rewards — Design Handoff (execute-ready)

> Provenance: authored by a Sonnet design agent against the orchestrator's binding 8-point
> architecture brief, 2026-07-21, against master HEAD `f735e18` — after full recon of
> `docs/design/magic-combat-depth.md` (sibling/parent: Five Arts, Glow, Keeper's Rank —
> **Phases 1-2 MERGED** at `7d4e9bd`/`7ac4ef3`, so the spellbook numbers below are shipped, not
> proposed; **Phase 3 — Warden reforged — has NOT started**, §10 flags a real collision with
> it), `contracts.ts`, `combat/{spells,arts,status,damage,boss}.ts`, `encounters/{engine,
> register}.ts`, `packs/types.ts` + `pack.schema.json`, `packs/vc-law/pack.json` (49 real
> encounters, **zero currently carry a difficulty field**), `pipeline/expand_pack.mjs` (the
> merged `expand` verb), and `docs/crucible/v1-findings.md` V1-8/V1-19. Re-verify anchors
> before editing.
>
> The orchestrator's architecture is BINDING — this doc expands and stress-tests it, never
> redesigns it. Every underdetermined choice gets a specified default AND a §13 flag.

## 0. AMENDMENTS TO magic-combat-depth.md

1. Two more flagged, additive `contracts.ts` fields (same exception process as that doc's
   `flair`/`companion`/`boon`): `EncounterRequest.spellTier`, `EncounterResult.difficulty` (§2).
2. Content-side schema: `Encounter.difficulty?: 1|2|3` + `PackMeta.difficultyClassified?:
   boolean` — additive; neither touches the pre-existing `Fact.difficulty` (§1.1 flags the
   collision).
3. New pure functions riding the SAME files: `engine.ts` gains `difficultyOf`/
   `difficultyEligible` + a `pick()` filter stage; `arts.ts` gains `riderBonus`; `spells.ts`/
   `status.ts` gain one more boolean each, folded exactly like `weld`. No new modules.
4. Rollout slots into the sibling doc's existing Phase 1/2/3 shape (§10) — one real scheduling
   hazard against its own not-yet-started Phase 3.
5. §8's pipeline is additive to the already-merged `expand_pack.mjs`, not a new script.
6. One plumbing gap surfaces here that isn't mine alone: the sibling doc's §5.5 weld bonus
   specifies its own banner text that is **never actually shown** today (`castGatedSpell` only
   ever displays the ONE banner op `resolveSpell` pushes — the base spell's, confirmed dead per
   handoff.md's own "weld banner override" TODO). The rider needs the identical capability;
   §4.2 fixes both with one mechanism.

## 1. OVERVIEW — THE THREE TIERS

| Tier | Name | Glyph | Color (existing token) |
|---|---|---|---|
| 1 | Ember | `▫` | `P.ember` `0xd2792c` |
| 2 | Lantern | `◧` | `P.lanternGold` `0xf7ce6b` |
| 3 | Beacon | `■` | `P.glowCore` `0xfff1c6` |

One field, `Encounter.difficulty?: 1|2|3`. **Unmarked = Lantern(2)** — all 49 vc-law encounters
are unmarked today, so all 49 read as Lantern until §8 runs. Read through exactly one function
(`difficultyOf`, §2), mirroring `computeRank`/`wardenAbsorbs`'s single-choke-point idiom.

Glyphs: an ascending open→half→full square avoids all 8 status-chip shapes (`▲⌗◗◈✎↑↓✱`) and
flair's `✦` — a half-circle was the obvious first choice but sits one visual step from
Dimmed's `◗`, so squares were picked instead. Colors reuse existing tokens; Ember/Lantern
double up with Kindled's chip and the Glow pips (different UI surfaces, flagged in §13 in case
a playtest disagrees) — Beacon's `glowCore` was unclaimed.

### 1.1 Naming collision — flagged, not resolved
`packs/types.ts:39` already has `Fact.difficulty: number // 1..5` (authoring metadata, validated
on load, read by **zero engine code**). `Encounter.difficulty` (1-3) puts two same-named,
differently-scaled fields on sibling objects in the same `pack.json` — a legibility risk, not a
type-safety one (TS keeps `fact.` vs `encounter.` distinct). Default: keep both names (renaming
either is a bigger unrelated migration); every UI surface pairs the number with its in-world
name, never a bare digit. §8 turns `Fact.difficulty` into this feature's first real consumer.

## 2. SCHEMAS (exact types)

```ts
// ---- packs/types.ts (additive) ----
export type EncounterDifficulty = 1 | 2 | 3; // Ember | Lantern | Beacon

export interface Encounter {
  /** optional; absent = Lantern (2). NOT Fact.difficulty's axis (§1.1). */
  difficulty?: EncounterDifficulty;
}
export interface PackMeta {
  /** true once every encounter has passed the §8 pipeline. Gates riderBonus() (§4) — an
   *  explicit flag rather than inferred "spread," see §5 for why. Absent/false = the rider is
   *  fully dormant: never fires, banner never claims it (§6's honesty principle). */
  difficultyClassified?: boolean;
}
```
`pack.schema.json` (additive, optional, never required): `"difficulty": {"type":"integer",
"enum":[1,2,3]}`.

```ts
// ---- contracts.ts (additive, FLAGGED orchestrator-owned edit) ----
export interface EncounterRequest {
  /** casting spell's tier — biases pick() (§3). Absent (Strike/Satchel) = no filtering. */
  spellTier?: 1 | 2 | 3;
}
export interface EncounterResult {
  /** drawn encounter's resolved difficulty. Optional only for the empty-archive edge case;
   *  callers read `result.difficulty ?? 2` defensively. */
  difficulty?: EncounterDifficulty;
}

// ---- encounters/engine.ts (additive) ----
export function difficultyOf(e: Encounter): EncounterDifficulty {
  return (e.difficulty as EncounterDifficulty | undefined) ?? 2;
}
// tier 3 is a PREFERENCE (only 3 counts eligible); tiers 1-2 are FLOORS (>= tier). Both
// fall back on empty (§3, §6).
function difficultyEligible(e: Encounter, tier: 1 | 2 | 3): boolean {
  return tier === 3 ? difficultyOf(e) === 3 : difficultyOf(e) >= tier;
}

// ---- combat/arts.ts (additive) ----
/** §4 the rider: q1 on a draw harder than your tier's own number grants +1 primary damage.
 *  tierFloor === tier by construction (Ember=1↔T1 … Beacon=3↔T3), which is why T3's rider is
 *  arithmetically impossible (§5). packReady gates the whole mechanic pre-classification —
 *  not decorative, see §5's dominance proof. */
export function riderBonus(spellTier: 1 | 2 | 3, drawnDifficulty: 1 | 2 | 3, packReady: boolean): 0 | 1 {
  return packReady && drawnDifficulty > spellTier ? 1 : 0;
}
```

`spells.ts`/`status.ts`: `ResolveSpellOpts` gains `rider?: boolean`; `primaryAmount()` folds it
in beside `overglow`/`weld`; `ComputeHitInput` gains a 6th flag. `computeHit`'s formula becomes
`base + emboldened(+1) − weakened(−1) + flank(+1) + overglow(+1) + weld(+1) + rider(+1)` →
floor 0 → `+ inked` → Warded absorbs → HP. One more additive term, same family, no reordering.

## 3. BINDING TO SPELL TIERS — THE PICKER

| Tier | Filter | Rule | Empty-pool fallback |
|---|---|---|---|
| 1 | none (no-op) | `difficulty >= 1`, always true | n/a |
| 2 | hard floor | `difficulty >= 2` | widen to kind-only |
| 3 | soft preference | `difficulty == 3` only | widen to kind-only |

`pick()` (`encounters/engine.ts:43-64`) today: filter by kind, walk `req.factIds` (due-order)
and return the first kind-matching encounter teaching that fact — first hit wins, no scanning
ahead. Extension:
```ts
export function pick(req: EncounterRequest, packs: Pack[]): Encounter | null {
  // ...unchanged: pack lookup, forced encounterId branch...
  let candidates = all.filter(kindMatches);
  if (req.spellTier) {
    const narrowed = candidates.filter((e) => difficultyEligible(e, req.spellTier!));
    if (narrowed.length) candidates = narrowed;   // else honest fallback: keep the wider pool
  }
  // ...unchanged: due-order walk over `candidates`, unchanged tail fallbacks...
}
```
Filter-THEN-due-walk (not skip-to-a-different-fact-on-mismatch) is the literal reading of
skeleton rule 2's parenthetical — *"due-ness still leads within the eligible pool... never
overrides due-first."* Building the pool first and running the unchanged walk inside it is the
only reading where difficulty can't promote a less-due fact over a more-due one. Resolved by
close reading, not flagged.

**Composition contract with the in-flight session-recency partition** (not yet landed): any
narrowing stage must (a) filter `candidates`, never reorder the due-walk, and (b) fall back to
the wider pool on empty — identical idiom to the difficulty stage. Under that contract the two
stages commute, so landing order between this doc and recency-picker-sonnet's work needs no
pre-agreement, only shared adherence to "narrow-but-fall-back."

**Grounding**: all 49 vc-law encounters are unmarked → `difficultyOf` returns 2 uniformly → T1
is a no-op (always was), T2's floor is trivially met, T3's preference matches zero candidates
so it falls back on every cast until §8 runs. Harmless for the picker; §5 shows it is NOT
harmless for the rider.

## 4. THE REWARD RIDER — EXACT MATH & WIRING

**Wiring** (file:line against merged HEAD): `CombatScene.ts:1199-1201`
(`castGatedSpell`'s `runEncounter` call) adds `spellTier: spell.tier`. `CombatScene.ts:~1230`
(beside the existing `weld = weldBonus(...)===1`) adds `const rider = quality===1 &&
riderBonus(spell.tier, result.difficulty ?? 2, this.packDifficultyClassified) === 1;`, passed
into `opts` alongside `weld`. `packDifficultyClassified`: new private field, cached once in
`loadContent()` where `pack.meta` is already in scope (`CombatScene.ts:527`) —
`this.packDifficultyClassified = pack.meta.difficultyClassified ?? false;`. **Trap-1**: this
field joins the create()-time zero-reset block like `rankInfo`/`oaSpent` (reused scene
instance). Because `rider` folds through `primaryAmount()`/`computeHit` exactly where `weld`
does, it inherits weld/overglow's existing primary-only scope for free — no new exclusion code.

### 4.1 Where it can and cannot fire — the 8/15 finding
`primaryAmount()` only runs when a slot's `effect.hits > 0`; T3's arithmetic
(`drawnDifficulty > 3` is impossible) excludes itself regardless of shape:

| Reachable (7) | q1 base → +rider | Dead — arithmetic (T3, all 5) | Dead — zero q1 damage (3) |
|---|---|---|---|
| Smite (T1) | 3 → 4 | Lanternfall *(also shape-excluded: burst1)* | Attested Ward (T2, status) |
| Weave (T1) | 2 → 3 | Lattice | Parley (T1, status) |
| Sequence (T1) | 2 → 3 | Rite of Sealing | Heartening Word (T2, status) |
| Cast (T1) | 6 → 7 | Verbatim Decree | |
| Cinder-Rebuke (T2) | 2 → 3 | Injunction | |
| Snare-Knot (T2) | 1 → 2 | | |
| Processional (T2) | 2 → 3 | | |

**8 of 15 spells (53%) can never display the rider** under the literal "+1 damage" framing —
falls straight out of the skeleton's own wording plus the shipped spellbook's real numbers, not
a wiring bug. §13.6 flags the resolution (ship as specified vs. extend to a status-magnitude
bump — bigger scope, since Bound/Staggered have no magnitude concept at all today).

### 4.2 Banner — the shared plumbing gap
Rider copy (universal, q1 only, no per-Art variants): `"The truth burns brighter. (+1)"`. This
needs banner-composition plumbing that doesn't exist — `resolveSpell` pushes exactly ONE
banner op, and weld's own specified text has the identical unmet need (§0.6). Fix serving both:
`resolveSpell` pushes banner ops as an ORDERED LIST (base text, then weld's if fired, then the
rider's if fired); `CombatScene` changes its single `.find(...banner)` to `.filter(...)`,
stacking whatever returns as HUD lines. Flagged because it touches shipped Phase-2 code.

### 4.3 Boss-shield interaction — inherits V1-19, doesn't fix it
V1-19: a shielded Warden absorbs damage while the success banner plays anyway — pre-existing,
Sev 2, affecting every pre-shield-check modifier (overglow, weld, now the rider identically,
since all three fold in upstream of `wardenAbsorbs`). Not fixed here. Implementers: key the
rider's banner off whatever V1-19's eventual fix uses to suppress a shield-absorbed success
banner — don't hardcode a rider-specific special case.

## 5. NO DOMINATED STRATEGIES — THE PROOF

**Claim A — draw-difficulty dominance** (rule 4's literal text: *"fail/partial on a hard draw
costs exactly what it costs on an easy draw"*): true by construction. `SpellDef.effects[slot]`
is a pure function of (spell, quality) alone; the rider is the only difficulty-dependent term,
strictly additive, gated to q1 only. Smite: q0=0 and q0.5=1 at any draw; q1=3 at draw 1, 4 at
draw 2-3 — monotone non-decreasing, every slot, generalizing to all 15 by the same argument.

**Claim B — tier-choice dominance** (does a higher, Glow-costing tier ever lose to a lower one
at equal quality?): **not true by construction — the real find.**

*Regime "today"* (`packDifficultyClassified=false`, vc-law's actual state — all 49 unmarked,
`difficultyOf` returns 2 uniformly):

| Action | Cost | q1 draw | Rider? | Total |
|---|---|---|---|---|
| Smite (T1) | free | 2 | yes (2>1) | **4** |
| Cinder-Rebuke (T2) +Overglow | 1 glow + 1 glow | 2 | no (2 is not >2) | **3** (+push) |

A free action strictly out-damages a paid T2 action even after spending both its cost and an
Overglow pip — a real violation, a direct consequence of stacking "unmarked = Lantern" (rule 1)
under "harder than required" (rule 3) literally, not a tuning slip.

*Regime "post-classification"* (`packDifficultyClassified=true`, §8's heuristic ran — mcq →
Ember(1) baseline):

| Action | Cost | q1 draw | Rider? | Total |
|---|---|---|---|---|
| Smite (T1) | free | 1 | no (needs >1) | **3** |
| Cinder-Rebuke (T2) +Overglow | 1 glow + 1 glow | 1 | no (needs >2) | **3** (+push) |

Same raw number, T2 additionally offers the push/control the sibling doc's own §7 preamble
says T2 should trade for — the gate doesn't just patch the violation, it restores the sibling
doc's stated intent. This is why `packDifficultyClassified` is a hard flag rather than an
inferred "has spread" heuristic: simpler, auditable, flipped once by the pipeline (§8). New
machinery the skeleton didn't specify — flagged in §13 as the fix for a violation the
skeleton's own rules would otherwise produce.

## 6. HONEST FALLBACK (rule 5 + extension)

Rule 5, verbatim scope: no Beacon content → T3 draws hardest available, rider doesn't fire,
banner never claims it. Extended identically to T2's hard floor (§3) — a due fact whose only
teaching encounter sits below a tier's floor must still be taught (due-first is absolute); the
floor loosens, never the fact selection. The difficulty glyph (§7) always shows the ACTUAL
drawn difficulty, never the tier's nominal floor — a T2 cast that fell back to Ember content
visibly shows `▫ Ember`, not a Lantern glyph it didn't earn.

## 7. UX SPEC

- **Overlay eyebrow**: a third, independent optional param (not folded into `flair` — flair
  says which spell, this says which difficulty), e.g. `✦ Cinder-Rebuke · Multiple Choice · ◧
  Lantern`. **Shows at every rank, T1 included** — flagged (§13.9): new information about drawn
  content, distinct from the sibling doc's "zero regression at Rank 1" (scoped to action-bar
  mechanics, not this line), but touches T1's overlay pixels for the first time.
- **Tier flyout row** (Rank 2+): not the drawn difficulty (unknowable pre-cast) — a floor/
  preference glyph per row, e.g. `[2] Cinder-Rebuke · ◈1 · ◧+` ("draws Lantern-or-up"). The
  flyout shows the POLICY, the eyebrow shows the ACTUAL draw — necessarily different things at
  different times, resolving an apparent tension in skeleton rule 6.
- **Rider banner**, q1 only: `"The truth burns brighter. (+1)"` — universal across all 7
  reachable spells, no per-Art variants.
- **Tooltip copy** (T3-voice, hover/Records-Office context — kept out of the tight HUD strings
  per V1-11's overflow lesson): Ember *"A quick spark of a question — kindling for the
  newly-lit."* Lantern *"A question with real weight — the steady light most of the Ledger
  burns by."* Beacon *"A question that tests deep — the blazing signal-fire, lit only for what
  truly matters."*

## 8. PIPELINE FOR EXISTING CONTENT

**Heuristic** (by kind): `mcq→Ember(1)`, `scenario_branch|order|match→Lantern(2)`,
`free_recall→Beacon(3)`. Nicely aligns Kindling's/Attestation's own T1/T3 with their home
kind's floor/ceiling — but **flagged asymmetry**: only `free_recall` ever maps to Beacon, so
Binding/Ritecraft/Courtcraft's T2 spells can never earn their rider from the heuristic alone
(only an LLM promotion could); if that pass is skipped, those three Arts' T2 riders are
permanently dead while their T1 riders fire commonly. **Recommended enhancement** (flagged,
not built): let the heuristic consult the already-authored, currently-unused `Fact.difficulty`
(§1.1) as a tie-break — e.g. a match/order/scenario_branch encounter whose facts average ≥4
promotes to Beacon. Would be `Fact.difficulty`'s first real engine consumer.

**Optional LLM pass**: reuses `pipeline/expand_pack.mjs`'s proven shape (subscription CLI,
MCP-stripped, sonnet, ≤1 retry) — input: prompt + kind + fact statement + `trap_notes`; output:
1-3 + one-line rationale, written into the same `staging/difficulty/<run>/` → `--check` gate
pattern `expand` already established.

**Human-override**: not a schema field — a pipeline-internal provenance sidecar,
`packs/<id>/difficulty.provenance.json` (`encounterId → 'heuristic'|'llm'|'human'`), never read
by the engine, never in `pack.schema.json` (same category as `proposal.json`). Automated passes
only ever write a NON-`'human'` entry; a human edit marked `'human'` is permanent.

`PackMeta.difficultyClassified` flips `true` once every encounter has a provenance entry —
set by the pipeline's final compile step.

## 9. FRICTION ECONOMICS (the author, 2026-07-21, verbatim: *"too much friction... the more friction you introduce, the less fun it is. the less fun it is, the less often i play"*)

### 9.1 The governing principle
Friction is a spendable budget, not a free resource the engine can tax at will — and typing is
the single most expensive input in the game (a click/hotkey costs nothing; a typed answer costs
attention, phrasing effort, and the Clerk's 9-15s warm-judge wait). Everything below applies
this principle to the difficulty/rider system already specified in §1-8 — it is not a new
mechanic layered on top.

### 9.2 Rarity by design — Beacon reserved for deliberate top-tier moments
the author's own example — *"Cast from memory: define pre-money and post-money valuation, and state
the formula for the investor's ownership"* — **is a T1 Attestation cast** (Cast From Memory,
always-available, 0 Glow). It's the one place in the spellbook where "low-tier spell" and
"highest-friction form" collide by construction: Attestation is bound to `free_recall` at ALL
three tiers (kind-to-Art binding is fixed, sibling doc §1 — not this doc's to touch), so
free_recall can't be restricted to T3 casts by KIND. It CAN be restricted by DIFFICULTY, which
is this doc's actual lever: **§8's heuristic amends from "free_recall → Beacon, uniformly" to
"free_recall → Lantern by default; Beacon only for prompts genuinely requiring multi-concept
synthesis (a minority, by design)."** Single-demand, numeric/short-answer free_recall — the
baseline the parallel de-compounding pass is establishing right now (§9.4) — settles at Lantern;
only the rare, deliberately-hard prompt earns Beacon. §3's existing "T3 prefers Beacon" rule
then does the concentrating for free: whatever Beacon-tagged free_recall exists gravitates
toward Verbatim Decree (T3), while Cast From Memory (T1) typically draws the now-common
Lantern-tier, single-demand content. No picker change needed — only the §8 classification shifts.

### 9.3 Form-mix governance — where the lever actually exists
Verified against all 5 `runEncounter` call sites in the codebase: `CombatScene.ts:1118` (T1
direct-cast), `:1199` (`castGatedSpell`, the flyout path), `:1648` (boss branch) each pass a
single, pre-determined `kinds` array — the KIND is fixed by which Art the player cast before
`pick()` ever runs, so there is no multi-kind candidate set inside combat for a "space out
free_recall" filter to act on. `DungeonScene.ts:431` (`runGate`) forces a specific
`encounterId` — also no live kind choice. **`HamletScene.ts:617` (the Wellspring 3-drill burst,
`context:'drill'`) passes no `kinds` filter at all — every encounter in the pack is kind-eligible
there.** This is the ONLY real lever in the codebase. Specified here: `pick()` gains a
`recentKinds?: EncounterKind[]` param (caller-supplied, most-recent-first, mirroring
`spellTier`'s shape) — when the head of `recentKinds` is `'free_recall'` (already served this
burst), candidates narrow to exclude `free_recall`, falling back to the wider pool on empty
(identical idiom to §3). Wellspring's 3-iteration loop threads its own served-kinds list through
this param — implements "cap 1, never back-to-back" exactly where the architecture allows it.
**Flagged, not built**: a literal per-battle cap on casting Attestation ITSELF (inside
CombatScene) would need either blocking the cast — tension with soul S2's "never cap
questions" — or silently substituting a different kind mid-Art, a materially bigger change than
a content filter. If a hard in-combat cap is wanted, that's a separate action-economy design
pass, not this doc's mechanism.

### 9.4 Content-shape rules (amends §8's pipeline)
Treat as the **already-established baseline**, not future work (a parallel agent is
de-compounding vc-law's 10 free_recall prompts right now): **one demand per cast** — "define A
and B, and state C" is banned; the pipeline splits into separate atomic encounters or keeps the
single most load-bearing demand. Prefer numeric/short-answer shapes over essay-style "define X"
wherever the fact allows — the author's own example rewrites cleanly as *"$2M raised at a $6M
pre-money valuation — what fraction does the investor own?"* (one demand, one number). Target:
the ideal typed answer is one short sentence or a number, never a multi-clause definition.
Rubrics move in lockstep with any split — never grade a de-compounded answer against the OLD
compound rubric.

### 9.5 Scarcity legitimizes the reward
Free recall being rarest AND hardest is exactly why it carries Attestation's apex numbers (the
sibling doc's §7) and why this doc's own rider is structurally almost-never available at T3
(§5: nothing exceeds Beacon). That's not a gap to patch — §9.2's reserved-Beacon design and
§5's `packDifficultyClassified` gate both already point the same direction: the top reward tier
stays legible BECAUSE the hardest form stays rare. Making free_recall common or compound-by-
default would have cheapened the exact reward structure §5 already argues for.

## 10. PHASED ROLLOUT

**P1 — pure logic** (shippable alone, zero UX change): §2 schemas, §3 picker filter, §4 rider
math + wiring (single-line banner until P2), gate defaulting `false` (rider dormant until P3).
Files: `packs/types.ts`, `pack.schema.json`, `contracts.ts`, `encounters/engine.ts`, `combat/
{arts,spells,status,CombatScene}.ts`. Verify: `riderBonus` truth table (3×3×2),
`difficultyEligible` per tier incl. fallback, Claim A's monotonicity across all 15 spells, §5's
regime numbers as literal tests (gate=false must reproduce the 4-vs-3 violation exactly).

**P2 — UX + banner plumbing**: §4.2's banner-list fix (touches shipped code — flagged), §7
glyphs/copy. Files: `encounters/overlay.ts`, `combat/hud.ts`, `combat/CombatScene.ts`. Verify:
e2e asserting the rider line on a rigged q1-harder-than-tier cast and never on the 8 dead
spells or a shielded-boss hit; weld's own banner finally visible (closes a pre-existing gap).

**P3 — pipeline + vc-law pass**: §8 in full, `difficultyClassified: true` flip for vc-law.
**Scheduling flag**: the sibling doc's own Phase 3 also touches `packs/vc-law/*`
(moveLabels/metaphor_map) around the same time — sequence rather than run as parallel
worktrees against the same JSON; orchestrator's call, not this doc's.

## 11. NAMED TRAPS & CROSS-REFERENCES

1. **V1-8** (Overglow eligibility from a cached tier, not the actually-cast spell) — the rider
   is structurally immune (computed post-hoc from `spell.tier` actually cast); still verify no
   cached value leaks in during P2.
2. **V1-19** — inherited, not fixed (§4.3).
3. **Weld's shipped quality gate is looser than its own spec text** — `castGatedSpell` computes
   `weldBonus` unconditionally, relying on most q0/q0.5 slots having `hits:0` to make it moot
   (not universally true — e.g. Smite q0.5=1). Found incidentally, not fixed here; the rider
   specifies an explicit `quality===1` check instead of inheriting the ambiguity.
4. **Trap-1**: `packDifficultyClassified` joins the create()-time zero-reset block.
5. **§1.1's collision**: check which object (`fact.` vs `encounter.`) before assuming meaning.
6. **Kind is Art-locked upstream at every combat call site** (§9.3) — verified across all 5
   `runEncounter` call sites: the 3 in `CombatScene.ts` pass a single predetermined kind, the
   `DungeonScene` gate is forced-`encounterId` (kind vestigial); only `HamletScene`'s Wellspring
   drill passes no kind filter at all. Any future "which kind should this draw" mechanic only
   has real teeth at that one site.

## 12. NON-GOALS

1. No player-facing difficulty choice — the picker decides; no "pick your question" menu.
2. No effect on SRS grading/recorded quality (S3) — difficulty is board-only, like the 8 statuses.
3. No retroactive re-classification touching existing due/box state.
4. No status-magnitude rider extension this pass — the 8 dead spells (§4.1) stay dead.
5. No Glow refund on the rider — ruled out by the skeleton itself (avoids double-dipping §5).
6. No hard per-battle cap on casting Attestation itself (§9.3) — would either violate soul S2
   ("never cap questions") or require substituting a different kind mid-Art; not invented here
   without an explicit ask.

## 13. DIRECTOR VETO & FLAGGED GAPS

Team-lead-named (all defaulted keep — nothing blocks P1):
1. **Tier names** Ember/Lantern/Beacon.
2. **Default = Lantern(2)** for unmarked content.
3. **Rider size = +1**.
4. **`free_recall = Beacon` heuristic** — **superseded by §9.2**: default is now "free_recall →
   Lantern, Beacon reserved for a genuine minority" (the author's friction feedback); the §8
   `Fact.difficulty` tie-break stays a recommended, not required, follow-up on top of that.

Discovered during expansion:
5. **`packDifficultyClassified` hard gate** (§5) — default ON; vetoing ships the §5 violation.
6. **Rider dead on 8/15 spells** (§4.1) — default ship as specified; status-magnitude
   extension is real but bigger scope, flagged not designed.
7. **T2 hard-floor-with-fallback** (§3) — default as specified via close reading; low-risk.
8. **`Encounter.difficulty`/`Fact.difficulty` naming collision** (§1.1) — default keep both
   names, rely on UI pairing.
9. **Difficulty glyph at T1/Rank-1** (§7) — default show always, separate param from `flair`.
10. **Provenance sidecar vs. in-schema tracking** (§8) — default sidecar, keeps `pack.json` clean.
11. **Banner-composition fix** (§4.2) — default build now (unblocks weld's pending gap too);
    touches shipped Phase-2 code, flagged for sign-off.
12. **P3 vs. sibling-doc-Phase-3 scheduling collision** (§10) — coordination call, not a design one.
13. **Free_recall's default shifts to majority-Lantern** (§9.2) — default adopt: this is a real,
    the author-driven revision of item 4 above, not a hypothetical.
14. **Form-mix cap lives at Wellspring's drill burst, not inside CombatScene battles** (§9.3) —
    default: build where the architecture has a real, S2-safe lever; a literal in-combat
    Attestation-cast limit is §12.6's flagged non-goal, not built here.
