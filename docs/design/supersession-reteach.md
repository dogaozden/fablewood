# The Ledger Amended — Supersession Re-teach Event

**Status: DESIGN FINAL (Fable, 2026-08-01). Execute-ready. Builder ASSIGNED 2026-08-01: Opus 5 (freeze lifted after in-session verification — alias serves claude-opus-5[1m]).**
Closes knowledge-platform-vision.md §9 item 3 (the schema/validator half shipped at `faeb11f`; this is the game-event half).

## 1. What exists, what's missing

Shipped: `Fact.supersedes` / `Fact.superseded_by` (packs/types.ts:53-66, additive metadata, "no selection/SRS/scene logic" yet) with validator invariants (pipeline/validate_pack.mjs:14-35): pairs must point at each other perfectly, one-for-one v1 (a fact superseded by at most one fact), superseding `as_of` ≥ superseded `as_of`, and live encounters may not target a superseded fact.

Missing: the engine honors none of it. A superseded fact keeps drawing forever; the new truth arrives as just another stranger. This doc specifies the game event that makes an amendment a *moment* — and the selection/SRS rules behind it.

## 2. The event

**"The Ledger Amended"** happens at the **Records Office** — where else would the Realm's record change?

- **Trigger:** on pack load, collect `amendedPending` = facts with `superseded_by` whose superseding fact has no SRS history yet (never taught). Non-empty → the Records Office **pulses** (soft lantern glow on the map location; hover line: *"The Clerk has amendments."*).
- **Visit:** entering the Records Office with amendments pending presents the amendment card(s) before normal conversation. **Batch cap: 3 per visit** — overflow waits for the next visit (an amendment is a beat, not a dump).
- **No combat interruption, ever.** Amendments never surface mid-vault, mid-battle, or at the Wellspring.

## 3. The card (overlay register, parchment — pattern: `presentNightLedger`)

Title: **The Ledger Amended**
Clerk opening line: *"The Realm moved. The Ledger moves with it."*
Body: the old truth rendered **struck through**, the new truth beneath it, then the new fact's source quote + citation (verbatim `source_ref`, same treatment as free_recall's earned page).
Caption under the strike: *"What was true is not unwritten. It is amended. Both lines stay."*
Confirm button: **"Read and witnessed ▸"**
Sign-off (after last card of the batch): *"So amended. What the Ledger keeps, it keeps honestly."*

The witness beat is **teach-only**: no question, no grade, no SRS record, no HP, no Glow. All player-facing strings above are Fable-written and FINAL — builder transcribes verbatim, invents nothing.

## 4. Selection rules (engine) — AMENDED 2026-08-01 after the choke-point survey

The first draft had the old fact drawing normally until witnessed. The survey killed that clause: the validator invariants (pipeline/validate_pack.mjs) already forbid a live encounter from targeting a superseded fact, so the pack update that supersedes a fact necessarily retargets its encounters — post-update, the old fact **cannot** be drilled through any encounter. Keeping it "active" would leave it stuck due forever, polluting the queue while drills silently serve other facts. Amended rule — **the amendment suspends BOTH truths until witnessed:**

- **From pack load:** the SUPERSEDED fact retires from every draw/scheduling surface (dueQueue, combat candidates, Wellspring recompute, due badges, Dashboard forecast/weakest/mastery aggregates). This is not a silent swap — the Records Office pulses immediately, and the amendment card is where the change is honored. The SUPERSEDING fact is likewise gated out of play while its amendment is unwitnessed (otherwise it would surface as an ordinary unseen fact, teaching the new truth with no ceremony).
- **After witness:** the NEW fact enters play as a normal new fact (new = due immediately, box 1) — no schedule seeding, no history migration. The old fact stays retired, permanently.
- **Canonical filter site:** the `services.srs.dueQueue` wrapper (srs/register.ts) filters its factIds input through ONE exported predicate module — that single site covers combat dueFactIds, snapshotDueSet, the Wellspring recompute, and the hamlet due badge. `pick()`/engine.ts is deliberately NOT modified: a valid pack cannot contain encounters teaching superseded facts (validator invariant), so encounter-level runtime filtering would be dead code guarding an impossible state.
- **Display surfaces, ruled individually:** dungeon teachingFacts filters superseded facts OUT (an outdated truth must never be re-taught as current); the Library keeps them visible with the ⟳ marker (both lines stay); Dashboard forecast/weakest/mastery exclude them per §6.

Witness state persists in `state/` (a small `amendments.json` or equivalent: factId → witnessed-at ISO date; merge-write discipline like every other store; corrupt-file backup rule applies).

## 5. Grading gentleness (the one mercy rule)

The player *mastered* the old truth. The world changed — their diligence didn't fail. So:

- The superseding fact's **first graded appearance** carries `amended: true`. A miss on it deals **0 HP** and shows the Clerk line: *"The Realm moved, not you. Read it again."* (banner slot, composes after base copy).
- SRS stays **honest**: the miss records quality 0 as normal (it arms redemption normally — a later reclaim rings the bell, and *"Lost once. Kept now."* lands perfectly on an amended fact).
- Second and later appearances: full teeth. One free read-again, no more.

## 6. State & stats

- Old fact's SRS rows: preserved forever, never migrated, never copied (state/ is sacred).
- Dashboard: superseded facts drop out of the due forecast, weakest-bindings, and mastery aggregates **from pack load** (per amended §4); history views keep them with an **amended marker** (provisional glyph `⟳` — the author one-worder pending). Minimal change: filter + marker only.

## 7. Non-goals (v1)

No supersession chains UI (validator enforces one-for-one). No cross-pack supersession. No un-supersede. No mid-run amendment beats. No SRS history migration. No bulk "witness all" button.

## 8. Build plan (single phase, playable after)

EDIT: hamlet scene (Records pulse + entry hook), overlay.ts (`presentAmendment`, `NightLedger`-style), the draw choke points (builder maps the real sites: combat pick, Wellspring due-first recompute, gate draws, `services.srs.dueQueue` — one exclusion predicate, unit-tested per site), CombatScene/kinds (amended-first-miss 0-HP rule at the damage seam), contracts.ts (minimal: expose witnessed set + amendedPending), new small state store (witness persistence, isolated-STATE_DIR test discipline).
Test fixture: a tiny fixture pack carrying one superseded pair — vc-law needs **zero content changes** for this feature.

## 9. Verification

- Unit red→green: superseded fact retired from every scheduling surface from load; superseding fact gated until witnessed, active after; gentleness (first miss 0 HP + line, second miss normal); batch cap 3; witness persistence across store reload; NaN/absent-field tolerance (`superseded_by` optional everywhere; zero-packs green).
- e2e (fixture pack, stub judge, scratch port, expect.poll everywhere, settled screenshots): hamlet entry → pulse visible → Records visit → card register (strike-through + quote + lines verbatim) → witness → new fact appears in next Wellspring drill → old fact never drawn across N drills → reload mid-batch → remaining amendments still pending.
- Full battery ×2 at the merge gate, as always.

## 10. Defaulted calls (veto anytime)

1. Gentleness window = first graded appearance only (not first day). 2. Batch cap = 3. 3. Old fact draws until witnessed. 4. Dashboard marker `⟳` pending the author's one-worder. 5. Witness store is its own small file, not a new field in srs.json (keeps the sacred file untouched).
