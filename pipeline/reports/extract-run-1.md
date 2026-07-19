# Funnel report — extract-run-1

**Pack:** `vc-law` · **Dungeon:** Term Sheet Economics (the Preference Vaults)
**Source:** *Venture Deals* (Feld & Mendelson), epub → `raw/vc-law/book-md/`
**Date:** 2026-07-19 · **Stages:** convert → extract → validate

---

## 1. Convert (`epub_to_md.py`)

Parsed the OPF spine for true reading order and converted every text-bearing
document to clean Markdown (headings, paragraphs, lists, bold/italic,
blockquotes, tables; nav/css/scripts/images/math stripped). **37 documents**
written to `raw/vc-law/book-md/NN-<slug>.md`, numbered in reading order. The
chapter list matches the *Venture Deals* table of contents exactly (Introduction,
Chapters 1–19, Appendices A–D, Glossary, Index, Startup Communities excerpt).

Image-only cover skipped (numbering is contiguous over emitted docs). One cleanup
pass collapses empty `**` / `*` emphasis pairs left by the fill-in-the-blank legal
templates in Appendices A–C; none of the five extraction sources were affected.

### Chapters used for extraction (Term Sheet Economics)

| File | Chapter | Role |
|---|---|---|
| `08-introduction-the-art-of-the-term-sheet.md` | Introduction | economics-vs-control framing; DEC story |
| `12-chapter-4-overview-of-the-term-sheet.md` | Ch. 4 Overview of the Term Sheet | economics vs control; preferred vs common |
| `13-chapter-5-economic-terms-of-the-term-sheet.md` | Ch. 5 Economic Terms | **primary source** — valuation, option pool, liq pref, pay-to-play, vesting, antidilution |
| `16-chapter-8-convertible-debt.md` | Ch. 8 Convertible Debt | adjacent economics — discount, cap, conversion |
| `17-chapter-9-the-capitalization-table.md` | Ch. 9 Capitalization Table | pre/post-money math, pool dilution |

## 2. Extract (`facts.staging.json`)

Read all five sources at full fidelity. Drafted ~60 atomic candidates, then curated
to **42** (target 36–42), weighting toward the four named dungeon topics
(liquidation preference, antidilution, option pool, pay-to-play) and dropping the
weakest/most-adjacent candidates (warrants detail, exercise-period, overhang,
reverse-dilution, SAFE, IPO-debate story, several convertible-debt terms).

**By type** (all 7 present):

| type | n | | type | n |
|---|---|---|---|---|
| concept | 21 | | dont | 3 |
| rule | 5 | | story | 3 |
| number | 4 | | do | 2 |
| advice | 4 | | | |

**By difficulty:** 1→4 · 2→15 · 3→17 · 4→4 · 5→2 (bulk moderate, honest tail of hard ones).

**By topic:** liqpref 13 · valuation 5 · antidilution 5 · paytoplay 4 · convdebt 4 · overview 3 · optionpool 3 · vesting 3 · captable 2.

**By tag:** liq-pref 14 · valuation 12 · negotiation 9 · antidilution 6 · participation 5 · dilution 4 · option-pool 4 · pay-to-play 4 · convertible-debt 4 · conversion 3 · vesting 3 · cap-table 2.

**Prereqs:** 35/42 facts declare ≥1 prereq, forming an acyclic learning order
(e.g. `preference-plus-participation` → `full-participation` → `capped-participation`
→ `participation-cap-multiple-meaning`). Useful for quest gating.

## 3. Validate (`validate_quotes.py`)

```
Validated packs/vc-law/facts.staging.json
Facts: 42 | Passed: 42 | Failed: 0
All checks passed.
```

Every `source_ref.quote` is a verbatim substring of its source file under
whitespace + curly-quote normalization; all ids unique/well-formed, enums valid,
difficulty 1–5, `as_of` well-formed, every prereq resolves, every source file
exists. **Negative test** (planted a non-verbatim quote, a bad enum, an
out-of-range difficulty, a dangling prereq, and a duplicate id) — the validator
flagged all five and exited nonzero, confirming the gate is real, not vacuous.

## 4. Notable judgment calls

- **Reading-order numbering.** `NN` is the contiguous position among text-bearing
  spine docs (cover skipped). Stable and deterministic; `source_ref.file` points at
  the emitted filenames, so validation is independent of the exact scheme.
- **Concept-heavy split (21/42).** Honest for a definitions-dense chapter — pre/post
  money, the three participation varieties, and the antidilution varieties are
  genuinely *concepts*. Facts that are actually operational were labelled `rule`
  (nonparticipating "greater-of" behavior is folded into the concept; full
  participation, the cap-multiple math, pay-to-play's liq-pref reduction, and the
  founders = 100% − VC − pool identity are `rule`) rather than inflating other types.
- **Quote fidelity.** Preserved `×` (U+00D7), curly quotes, and Markdown italic
  asterisks exactly; chose spans that avoid the ambiguous en-dashes in the cap-table
  arithmetic so quotes stay robust.
- **`loc` separator** uses ASCII `>` (`Chapter 5 > Liquidation Preference`).

## 5. For the encounter-author

- **Richest vein = liquidation preference (13 facts).** Chapter 5 also carries
  *worked payout examples not captured as individual facts* — Cases 1–4
  (1× non-part / 2× non-part / 1× full-part / 1× 3×-cap) computed at $5M, $15M,
  $30M, and $100M exits, plus a $50M-raised 60/40 example. These are gold for
  `scenario_branch` encounters and numeric-distractor `mcq`s. Mine C05 for them.
- **Antidilution (5 facts)** maps cleanly to `match`/`order` encounters:
  full-ratchet vs weighted-average vs broad/narrow, harshest→softest.
- **`number` facts** (1×, 10–20% pool, 4yr/1yr cliff, 90-day, 10–30% discount) are
  natural parametric-reskin drills — randomize the figures per showing.
- **Cap-table chapter (C09)** has three convertible-note conversion methods with
  full before/after ownership tables — advanced `scenario_branch` material.
- **Prereq DAG** gives a ready-made teaching sequence for the dungeon's rooms.
