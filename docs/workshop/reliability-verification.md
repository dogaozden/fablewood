# Workshop reliability verification

Verified 2026-09-07. Fixture tests use temporary directories and neutral text;
no live saves or original sources are changed. Actual source processing is
separately evidenced below.

## Durable processing

The HTTP recovery test launches a real child process, completes chunk 0, attaches
an approved review, and terminates the process during chunk 1. Reopening derives
interrupted status with progress 1/2. Resume runs only chunk 1 and retains the
review. HTTP tests also cover asynchronous failure/resume, evidence lookup,
read-only mutations, loopback host/origin checks, JSON boundaries, protected
storage, and public responses that omit snapshot text. Tests bind an OS-assigned
ephemeral loopback port (5400+), requiring loopback permission in the test sandbox.

Source tests cover original-container and selected-text hashes, composite version
identity, source-date retention, repeated import and worktree relocation, exact
quote offsets, unsupported/ambiguous evidence quarantine, contradictory-source
handling, duplicate relationships, inspectable corrections, and supersession cycles.
Publication tests cover stable original records, immutable releases, source hash
revalidation, portable citations, conservative game eligibility, safe supersession,
current base metadata, and withdrawal of the last outline-only item.

CLI caching accepts only fully validated completed output whose prompt, model,
and effective command match. Draft candidate shape and complete assessment IDs /
verdicts must validate before reuse. A failed assessment retries freshly while a
valid draft can be reused. Invalid drafts do not become permanent poisoned caches.
Historical raw failed receipts remain unchanged.

## Real source campaign

`workshop-evidence/source-campaign/ledger-evidence.json` archives seven sources,
seven completed jobs, 41 propositions, six confirmed correction relations, and
one attributed note. Twenty propositions are approved and 21 rejected. The latest
release has 20 outline propositions, one personal note, and 19 game additions.

The six public documents used the authenticated Claude subscription CLI for draft
extraction and independent assessment. Copied raw receipts include 14 completed
CLI stages and one historical failed stage. The failed stage had delivered valid
stdout but an earlier parser rejected its envelope; an earlier retry reused that
response. That historical receipt predates the stricter validated-cache policy
and is preserved as evidence, not presented as the current retry rule.

The seventh source is an existing canon lecture clip, processed entirely locally.
Its receipt records `backend: local-canon-clip` and `network_used: false`; original
transcript SHA, segment IDs, quote and timestamps were rechecked. Initial approval
review rejected a mixed public/private outbound batch. The public-only retry was
allowed; lecture text was never sent. Local canon reuse is a supported source
adapter, not a claim that model extraction ran on private lectures.

## Real interface and integration

On Goal2's integrated server, §2(a)(11) was imported, started through the actual
interface, extracted by the subscription CLI, reviewed through four agent-attributed
UI decisions, and published with an attributed observation. Receipts are under
`workshop-evidence/integration/`. Goal2 independently passed eight reader check
groups against the actual final publication with zero browser errors. Exact source
versions, quotes, cases, corrections, note attribution and search were exercised.

The final direct Workshop screenshots, retry proof and suite results are recorded
in `workshop-evidence/verification/final-checks.json` and accompanying logs once
final acceptance is frozen. See `final-review.md` for findings and repairs.

## Repository regression baseline

Recorded in `workshop-evidence/verification/repository-checks.json`:

- Root Vitest: 75 files / 1075 tests passed.
- Production build: passed, with the existing bundle-size advisory.
- Zero-packs: build and 1075 tests passed.
- Node pipeline: 152 tests passed.
- Python pipeline: 90 pytest tests passed. An initial unittest invocation found
  zero tests and was corrected; it is not counted as verification.

Full checked-in Playwright: **199 passed, 4 failed in 35.6 minutes**. A focused
rerun passed boss-victory and inventory-pane-reopen, but reproduced boss-reforged
(strictly increasing start-time page errors) and trim-the-lantern (zero observed
spend/refund writes). This is not an all-green suite. Exact errors/screenshots
remain in `playwright-first-pass/` and `playwright-focused-recheck/`. Goal1 owns
baseline engine/browser triage for final integration. Workshop changed no tracked
engine, pipeline, or browser-suite code. Generated tracked screenshots were
archived and then restored.
