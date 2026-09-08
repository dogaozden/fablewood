# Resumed Workshop maintenance

The resumed original goal audit found that duplicate detection stopped at the
Workshop ledger. The current publication adds paraphrases of existing game facts,
including the private-offering exemption and the all-accredited-purchasers condition.
This falls short of enriching existing knowledge while preserving learning history.

## Agreed direction

Expose candidate matches against the selected base pack. Matching is advisory;
an attributed review must confirm a proposition-to-canonical-fact link. Record the
canonical fact fingerprint so a changed base fact requires renewed review. An
unreviewed match never silently chooses a target or changes existing knowledge.

A confirmed link publishes source evidence to the outline while reusing the existing
game fact. If a prior release already minted a Workshop fact, preserve that fact and
its encounter IDs as a declared duplicate instead of deleting them or calling the
relationship supersession. Optional `Fact.duplicate_of` names a direct same-pack
canonical target. Missing/self/chained/cyclic targets and mixed supersession metadata
are rejected. Aliases and encounters requiring them leave practice selection; all
history and raw content remain addressable. No history merge or migration.

Goal 1 authorized the core extension and retains game3d ownership. Goal 3 owns
Workshop, the contract, and the narrowly named packs/SRS/draw validation paths.
Normal-speed Luna owns the engine implementation. The orchestrator owns matching,
review, publication and integration; a Sol reviewer independently audits historical
release immutability. No live workspace or installed pack is changed during fixtures.

## Acceptance still required

- Real existing duplicates identified and explicitly reviewed with evidence.
- Repeated matching/review/publication preserves IDs and decisions.
- Changed canonical content invalidates its stale match review.
- Old published IDs, encounters and both canonical/alias SRS records preserved.
- Aliases excluded from fresh/due/revisit and multi-fact encounter selection.
- Actual interface and integrated reader remain usable; no silent data replacement.
- Independent tests, repository checks, consumer proof and protected-file checks.

Working tree: `/private/tmp/learning-workshop-maintenance`, branch
`codex/workshop-maintenance`, baseline main `39a46a3`. No pushes requested.

## Implementation and independent acceptance

Engine contract commit: `20dfcdb`. A normal-speed Luna implemented the bounded
packs/SRS/draw contract; the orchestrator inspected the diff and independently ran
root, pipeline, actual-pack consumer and checked-in browser checks. No additional
workers were added. Goal 1 received the reviewed commit and owns 3D integration.

The orchestrator implemented `workshop/game_links.py`, the comparison/review UI,
publication linking, and release lineage. Candidate matching is read-only and takes
0.322 seconds on the current 41-proposition / 271-base-fact input. The two real
matches are explicitly reviewed as agent decisions, with reasons preserving scope.
The final isolated UI release is `publication.d9bdfb0ba7d630824ef0b191`: 20 outline
propositions, one note, 17 Workshop practice propositions, two canonical reuses,
290 retained facts and 309 retained encounters. `browser.json` records the run.
All original16 protected-file hashes still match the initial mission baseline.

A separate Sol review reproduced the old A→B→A artifact overwrite and independently
verified the repair: distinct release IDs preserve cumulative B-era game references;
adjacent retries leave bytes/audit unchanged; tampered artifacts fail closed; a crash
between installation and ledger commit is recoverable without rewriting the release;
conflicting orphan lineage cannot be adopted. The reviewer found one further defect:
a link that never minted a Workshop fact was incorrectly treated as published game
content when withdrawn. The publication now tracks only active generated IDs in that
retirement gate; a regression verifies outline withdrawal leaves canonical facts intact.
The orchestrator also verified that a reviewed duplicate can later choose a different
canonical target while retaining its old fact/encounter IDs and historical SRS bytes.

The real browser run found a CSP-blocked inline progress width and a cramped mobile
inspector. Native `<progress>` and a single scrolling mobile inspector repair them.
Desktop and390px screenshots were inspected; the comparison shows both claim wordings,
the canonical source quote, and attributed decision. Browser console/page errors:0.

Evidence and exact check outputs are under `workshop-evidence/maintenance/`.
The initial real subscription extraction receipts remain under
`workshop-evidence/source-campaign/receipts/`; no extra model call was needed for this
deterministic maintenance change. Original CLI failures and review corrections remain
preserved. New manifested releases must not be relocated with the legacy one-time seed
script: publish in the target storage or make an explicitly derived portable export.

## Completed main integration

Engine20dfcdb and publisher18caf79 are integrated as main12025e3/3c33880.
Goal1 added three actual registered-service 3D consumer checks (9ab35a2); all passed.
Combined main build+zero-packs passed80 files/1155 tests. Main Workshop63/63 and
actual portable-pack consumer3/3 passed again after publication.

The two reviewed links were applied through main code, without replacing the ledger.
Current main publication: `publication.7529d876eb8820b7b84e4899`.
It preserves all290 fact IDs/309 encounter records, with17 Workshop practice propositions,
two canonical reuses,20 outline propositions and one attributed note. The portable
export under `secreg/workshop/published/` passes the real validator.

Main source/jobs/relations/evidence/proposition-review/note records are unchanged except
publication annotations and the two explicit link decisions. Historical release bytes
and canonical fact records are unchanged. Adjacent retry leaves the ledger identical.
The main reader and Workshop were exercised read-only, including source inspectors,
correction history and mobile layout; no page errors or mutation requests. Main ledger
SHA-256 before/after browser checks: `a57bee3a94f148a6a22e63d2a3f87c258e3af20dc0bfa2d3ef4e9c4525b0d191`.
All16 protected original/spec/staging/live/native file hashes remain unchanged.

Final receipts: `workshop-evidence/maintenance/main-publication.json`,
`main-interface.json`, `main-reader/receipt.json`, and `protected-main-final.json`.
The complete original-goal audit is `docs/workshop/requirement-audit.md`.
Main server remains http://127.0.0.1:5416/workshop/ and /app/, owned by Goal1.
No game-pack installation, live-state write, push, or native-app replacement occurred.
Goal1's wider visual/native work remains its separate active mission.
