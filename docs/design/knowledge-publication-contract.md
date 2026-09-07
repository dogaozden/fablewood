# Knowledge Workshop → Living Outline → Fablewood

Version 1 · 2026-09-07 · designated editor: Goal 3 (Knowledge Workshop).

Goal 2 owns `secreg/app/`, `secreg/serve.py`, reader navigation and presentation.
Goal 3 owns `workshop/`, its ingestion/review/publication interface, and this document.
Goal 1 owns the game and the existing Pack contract. Interface changes are communicated
between these tasks before implementation. Existing atlas, fact and encounter IDs remain
unchanged. No publisher writes learning state or parked staging files.

## Transport and persistence

The reader consumes `GET /workshop/published/outline.json`. A checked-in, provenance-backed
demonstration snapshot lives at `secreg/workshop/published/outline.json` for static use.
The integrated local server delegates `/api/workshop/*`, `/workshop/`, and the live
publication URL to `workshop.http.handle_request(handler) -> bool` before static routing.
`WORKSHOP_DIR` selects a separate durable working directory (default `.workshop` under
the repository, never `state/`). The handler reads `handler.server.repo_root` and
`handler.server.workshop_dir` (both Paths); `workshop_read_only` optionally disables mutations.
A standalone `python3 -m workshop --port 5413` uses the same handlers.

Mutations are local-only and reject foreign Origin headers. Source imports read registered
local files; processing never edits originals. Writes use locked atomic transactions.
Sources have immutable content snapshots and jobs retain accepted outputs on retry.

## Publication envelope

```json
{
  "schema_version": 1,
  "publication_id": "publication.<content-sha256-prefix>",
  "generated_at": "2026-09-07T00:00:00Z",
  "sources": [],
  "propositions": [],
  "relations": [],
  "notes": []
}
```

Identifiers are opaque strings, not labels. Existing atlas `node_id` strings are reused.
Source IDs are stable over versions; source-version IDs are `sha256:<digest>` over the
versioned original-container checksum plus selected-snapshot checksum. `version.sha256`
is the selected-text checksum; `original_sha256` identifies the original container. A
changed container creates a new version even when the selected words stay the same. Proposition
IDs are assigned once from normalized statement + node ID and retained forever. Identical
propositions may gain evidence from additional sources without changing IDs or review.
A changed statement creates a new proposition and an explicit relation, never a silent edit.
Personal note IDs are durable IDs independent of their wording.

Source records: `{id, title, kind, uri, identity_uri?, attribution, authority, versions}`. `kind` is
`statute|case|lecture|book|outline|observation|document`. `uri` is the original local path
or original URL, never a fabricated URL. `attribution` is `{creator, layer_id}`; `authority`
is `{level, label}` with levels `primary|case|lecture|personal|secondary|unknown`.
Authority is descriptive source classification, not a claim about current controlling law.
For repository-owned originals, `identity_uri` can be a stable logical `repo:` URI so
moving between checkouts does not mint another source. `uri` retains the actual import
location. Existing identities remain stable when this logical identity is first added.

Each `versions[]` entry: `{id, sha256, imported_at, as_of, source_ref, currency}`.
`as_of` is source date or null, never silently replaced by ingestion date. `source_ref`
preserves original locators (for example `corpus.json#s-77d/(a)(2)`). `currency` is
`{status: "unverified"|"historical"|"verified", note: string}`; import defaults to
unverified. A checksum proves which text was used, not that it is current law.

Proposition records: `{id, node_id, statement, kind, evidence, confidence, review,
publication, created_at}`. `kind` is `supported_proposition|interpretation`.
`confidence` is `{support: "source_supported"|"unsupported"|"contested", explanation}`.
The extraction model supplies candidates; deterministic evidence checks and recorded
review determine eligibility. Source-supported does not mean legally authoritative.

Evidence records: `{id, source_id, source_version, quote, status, locator, context,
validation}`. `status` is `exact|unsupported|ambiguous|unavailable`. Exact validation
requires the quote to occur in the registered source-version snapshot at its locator.
`locator` carries available `line_start`, `line_end` (one-based inclusive), `char_start`,
`char_end` (Unicode code-point offsets within the snapshot, half-open), `section`,
`original_line_start` and `original_char_start` where a snapshot is an excerpt, and for lectures
`segment_ids`, `t_start`, `t_end` (seconds), `media_uri`. Missing fields are omitted.
`context` is surrounding source text. `validation` is `{method, checked_at, reason}`.
Lecture imports must validate canon hashes and exclude contested/unadjudicated segments.

`review` is `{status: "pending"|"approved"|"rejected", by, at, note, method}`.
`method` identifies `human` or `agent`; an agent review is never labeled human approval.
Identical review retries (same status, reviewer, note, and method) return the existing
decision without changing timestamps or audit history. A real topic reassignment resets
any decided review to pending and retains the prior decision in the audit.
Review history remains in the Workshop audit log. `publication` is
`{status: "draft"|"published"|"withdrawn", publication_id?}`.
Publication requires approved review and at least one exact, resolvable supporting
evidence record; additional non-exact records remain explicitly labeled history and
must not be presented as supporting context. Unsupported evidence cannot
be approved into a supported proposition. Reviewed interpretation stays labeled as such.

Relations: `{id, from_id, to_id, type, status, note, by}`. Types are
`contradicts|supersedes|refines|related|duplicate_of`; status is `proposed|confirmed|dismissed`.
Published relations may add `from_summary` and `to_summary`, each containing
`{id,node_id,statement,review}`. This makes an unapproved original inspectable without
placing it in the approved proposition list. Potential conflict detection never chooses a winner. A confirmed contradiction marks
both claims contested; they remain visible with both sources and are excluded from new
game output until reviewed resolution. Supersession retains historical references.

Notes: `{id, node_id, text, attribution, created_at, updated_at, review, publication}`.
The HTTP creation route requires an existing catalog node. Creator and layer ID must
be non-blank strings; malformed attributed notes are rejected before approval/publication.
Notes are personal layers, never promoted into controlling text by an extractor. They
can be published as attributed notes; they do not require or pretend external authority.

## Workshop API (JSON request and response bodies)

- `GET /api/workshop`: `{sources, jobs, propositions, relations, notes, publications}`.
- `GET /api/workshop/catalog`: `{nodes:[{id,title}], sources:[{key,title,kind,...}]}`.
- `POST /api/workshop/import`: `{path?, catalog_key?, title?, kind?, node_id?, as_of?,
  attribution?, source_ref?}` → `{source, job, duplicate}`. Same bytes + source + selection
  reuse the prior job. Catalog imports pin exact original-source locators.
- `POST /api/workshop/jobs/<id>/run`: starts/resumes background extraction; returns job.
- `GET /api/workshop/jobs/<id>`: status/progress/error and immutable attempt receipts.
- `POST /api/workshop/propositions/<id>/review`: `{status, by, note, method}`.
- `POST /api/workshop/propositions/<id>/assign`: `{node_id,by,note}` corrects topic
  assignment without changing the proposition ID; a changed topic requires fresh review.
- `POST /api/workshop/propositions/<id>/revise`: `{statement,quote,evidence_id,by,note,
  method,node_id?,relation_type?,detail?,proposition_type?}` returns
  `{original_id,proposed_id,proposition,relation,duplicate}`. The quote is revalidated
  against an existing source version. A changed claim is a separately reviewed proposal;
  the original, failed evidence, and prior decision remain unchanged. Relations point
  from the correction to the original; `relation_type` is `refines` or `supersedes`.
- `GET /api/workshop/preview`: selected outline propositions/notes, eligible game
  proposition IDs, and counts including game exclusions before publishing.
- `POST /api/workshop/relations`: `{from_id,to_id,type,status,note,by}`.
- `POST /api/workshop/notes`: `{node_id,text,attribution}`; initial personal draft.
- `POST /api/workshop/notes/<id>/review`: `{status,by,note,method}`.
- `POST /api/workshop/publish`: `{by}` → `{publication, outline_url, pack_url, counts}`.
- `GET /api/workshop/evidence/<id>`: immutable source snapshot excerpt and validation.
- `GET /workshop/published/pack.json`: latest validated compatible game pack.

Requests return clear JSON errors with non-2xx status, not fabricated successful jobs.
Jobs are `queued|running|interrupted|failed|completed`; retries retain review decisions
and checkpoints. Real extraction uses subscription CLIs only. A bounded CLI run records
the actual command/model, input checksum, raw output, duration and validation results.
CLI and HTTP share one dispatcher and a per-user process lock for subscription calls.
Canon lectures reuse existing exact attributed clips locally with `network_used:false`
receipts; they are not sent for new model interpretation and remain outline-only.

## Game publication

Use the existing `app/src/packs/pack.schema.json` with no schema changes. Only approved,
exactly supported, uncontested propositions with crate-eligible sources enter game output.
The supplemental case file is reference-only; personal notes and lecture statements do
not become statutory authority. Teaching prompts/rubrics are separate derived content.
`source_ref` is rebuilt by the publisher from verified evidence, never trusted from a model.
Fact IDs `workshop.<proposition-id>` and encounter IDs remain stable between publications.
Existing-pack merge previews append additions; never replace existing facts, encounters,
their `kind` or `fact_ids`, or existing learning histories. No implicit pack installation.
The game's mandatory `as_of` uses the supplied source date; if unavailable it uses the
import date with an explicit fallback statement in `detail`. The outline source date
remains null in that case. Neither value establishes current law.

Confirmed supersession uses the existing pack's paired `supersedes`/`superseded_by`
fields, preserves old fact and encounter IDs, and retains old source snapshots. A
proposed supersession holds both endpoints out of new practice. Confirmed duplicate
relations permit the canonical endpoint; retiring a previously published duplicate
without a supported supersession remains blocked because the pack has no distinct
duplicate-retirement contract. Failed reconciliation leaves the prior release active.

## Acceptance shared by Goals 2 and 3

Take an existing real source through import, a real subscription-CLI extraction,
deterministic quote verification, attributed review, and publication. Inspect its
proposition and exact source in the running outline; consume the generated game pack
with the real validator and engine or consumer harness. Verify duplicate imports,
interrupted recovery, unsupported evidence quarantine, contradictory-source handling,
stable IDs after expansion, and unchanged isolated learning-history fixtures.
