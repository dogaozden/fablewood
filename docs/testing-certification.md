# Wave certification protocol

The battery every wave runs before its final review and merge. Distilled from Waves 1–3's certifications (W1 Task 10, W2 Task 9, W3 Task 7) so it never has to be reconstructed from dead workspace docs again. The wave plan's certification task cites this file; wave-specific additions (new specs, new census entries) live in that task's brief.

## The battery (in order; frozen tree throughout)

1. **Full unit suite** (`npm test` from the repo/worktree ROOT — the vitest config lives there, not in `app/`).
2. **Both typechecks** (`npm run typecheck` — the repo's real script; do not invent per-project tsc invocations).
3. **`npm run check:zero-packs`** (the engine must build with zero packs installed).
4. **Main config e2e ×2** (port 5175).
5. **Amendments config e2e ×2.**
6. **Interleave config e2e ×2** — **delete `.state-e2e-interleave/` before run 1** (hermetic-green law; run 2 then runs warm as its own datapoint). Never trust a green that might be inherited from leftover scratch state — that exact accident hid a rig bug from W1's certification until W2's.

## The laws

- **Frozen tree:** zero edits while any leg runs. Tidies and spec tightenings land as commits BEFORE the battery starts, each proven harmless with one targeted run.
- **Greens auto-chain; any red STOPS the battery** — no further legs, full stop-state report.
- **Three-prong flake policy** — a red may be called flake ONLY with all three: (1) 3/3 green in isolation reruns, (2) a traced non-wave mechanism, (3) documented pre-wave history. Same-test-red-in-both-legs is NEVER flake. A deterministic red gets root-caused (W2 precedent: an Opus debug dispatch with reproduce-capture + a control-arm run on master), never a timeout bump on vibes.
- **Snapshot `test-results/` before isolation reruns** (the reruns overwrite the evidence of the original failure).
- **`git checkout -- screenshots/` after every e2e leg** (committed reference screenshots are curated deliberately, at pin-creation or certification — not battery churn).
- **Serialized batteries across concurrent waves** — one battery anywhere at a time (ports, state dirs, machine load).
- **No silent caps:** every leg's exact counts and timings go in the report; anything skipped is listed as skipped.

## The census

`grep -rn "services\.draw\.\(due\|fresh\)" app/src` — every production draw consumer must visibly carry its exhaustion ladder (due → fresh → seededShuffle fallback; teaching's two-tier fresh→scripted variant is the one W1-certified deliberate exception). The consumer list grows with waves — the certifying task's brief states the expected count; a surprise entry is a finding.

## Conventions

- Cert commit: `chore(<wave-scope>): wave N certification` (empty attestation commit is fine — W1 precedent), standing co-author trailer.
- The certification report lives in the wave's SDD workspace and its durable summary goes into `handoff.md` at wave close-out (workspaces are deleted; handoff survives).
- e2e state isolation: the suites use their own STATE_DIRs. **`~/Library/Application Support/realm.ledger.fablewood` is never touched.**
- Save-write assertions in specs: the passive `page.on('request')` write-log idiom (W3, `trim-the-lantern.spec.ts`) is endorsed where the page has no background writer to the file — safe in `vaults` (no autosave); in `hamlet` the 10s persist accumulator writes `save.json` unprompted, so any port there needs a registration-window argument.
