# Knowledge Workshop final review

Independent review of the frozen implementation in `/private/tmp/learning-goal3`, against `docs/design/knowledge-publication-contract.md` and the user goal. I inspected `workshop/{store,publish,http,sources,llm,processing,evidence,jobs}.py`, `workshop/web/workshop.js`, the Workshop tests, and the current pack schema. I did not invoke a subscription CLI or mutate source or live Workshop state; verification used mocked CLIs and isolated temporary state.

## Resolved during review

### Malformed successful CLI responses no longer poison retries

The reviewed implementation reused sibling `stdout.json` whenever the prompt matched and the prior CLI exit code was zero. It did not require full stage validation, and its cache identity omitted the model and command. A malformed draft or assessment could therefore fail forever on retry, including after a model change.

`workshop/llm.py` now marks a response cacheable only after complete validation for its stage. Draft candidate shape is checked before eligibility; an assessment becomes eligible only after its judgment IDs and verdicts match the draft. The cache key and match include exact prompt, model, and effective command. Failed raw attempts remain unchanged and inspectable, while a valid draft can still be reused when only its assessment failed.

Validation: `python3 -m unittest workshop.tests.test_sources_llm` passed 7/7, including fresh retry after invalid JSON, fresh assessment with valid-draft reuse after an invalid judgment ID, and model-change invalidation.

### Later publications now consume the complete current base pack

The reviewed implementation originally started later releases from the previous generated pack and merged only current base facts and encounters. This silently retained stale base metadata, quests, NPCs, and metaphor maps while recording the new base checksum.

`workshop/publish.py:204-219` now replaces every non-reference-bearing top-level field with the current base value, while carrying forward only prior Workshop source metadata that still backs preserved Workshop facts. Base facts and encounters retain the existing collision checks.

Validation: `workshop/tests/test_publication.py:72-97` changes current base metadata after a prior publication and verifies that the next validated pack uses it.

### The final outline-only item can now be withdrawn

The reviewed implementation originally rejected every empty publication, which made it impossible to replace an outline containing only a now-rejected note or outline-only claim.

`workshop/publish.py:161-163` now permits an empty replacement when a prior publication exists; the prior-game-item reconciliation gate still prevents unsupported game-fact removal. `workshop/web/workshop.js:252-258` enables that operation and explains its effect when the preview is empty.

Validation: `workshop/tests/test_publication.py:55-70` publishes a sole note, rejects it, publishes an empty outline, verifies the old immutable release, and confirms the repeated empty release is idempotent.

### Topic correction now requires fresh review after any prior decision

The reviewed implementation reset an approved proposition to pending after a topic change, but left a rejected proposition rejected under its new topic. That attached a decision made against the old assignment to the corrected assignment and hid it from the pending-review queue.

`workshop/store.py:1182-1208` now preserves an exact same-node request as a no-op and resets either decided state to pending on an actual topic change. The assignment audit continues to retain the complete prior review.

Validation: `workshop/tests/test_core.py:141-169` covers rejected reassignment, the same-node no-op, reset attribution/timestamp fields, and unsupported confidence pending renewed review.

### Identical review retries are now idempotent

The reviewed implementation replaced review timestamps and appended an audit event for an identical retry. A lost HTTP response could therefore create a second decision and make otherwise unchanged approved content produce a new publication identity.

`workshop/store.py:891-906` and `workshop/store.py:1318-1339` now return the existing proposition or note when status, reviewer, note, and method all match. Review timestamps, note `updated_at`, audit history, confidence, publication annotations, and the persisted document remain unchanged.

Validation: `workshop/tests/test_core.py:171-203` compares the entire durable state before and after identical proposition and note retries. `workshop/tests/test_publication.py:132-163` repeats both approved reviews after publication and confirms that the next publish is the same publication rather than a new release.

### Notes now require resolvable topics and complete attribution

The reviewed API accepted a non-empty arbitrary node ID and incomplete attribution. Such a note could be approved and emitted as an orphaned or unattributed outline record.

`workshop/http.py:159-162` now checks note destinations against the same atlas catalog used for proposition assignments. `workshop/store.py:1265-1305` requires non-blank string node/text fields and an attribution object with non-blank string `creator` and `layer_id`, normalizing required attribution values at creation. Approval rechecks this contract, and `workshop/publish.py:53-58`, `workshop/publish.py:139`, and `workshop/publish.py:160` enforce it again for approved persisted records at preview and publication.

Validation: `workshop/tests/test_http.py:178-205` covers missing catalog nodes, incomplete attribution, and a valid note through HTTP. `workshop/tests/test_core.py:205-218` covers malformed core inputs. `workshop/tests/test_publication.py:109-130` injects a malformed approved legacy record and verifies that both preview and publication reject it.

## Final validation

The final integrated command `python3 -m unittest discover -s workshop/tests -p 'test_*.py'` passed 54/54 in 62.682 seconds. The five HTTP tests passed separately with loopback access, and the 14 publication tests passed through the real pack validator. No external subscription CLI was invoked.

## Examined guarantees

Stable proposition IDs, additive evidence, immutable snapshot checksum verification, correction-as-new-proposition behavior, preservation of accepted chunk outputs, crash recovery, exact-quote revalidation at publication, proposed/confirmed conflict gating, and preservation of base fact/encounter IDs all have direct enforcement in the inspected paths. No unresolved findings remain within the examined boundaries.
