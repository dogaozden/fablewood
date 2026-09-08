# Knowledge Workshop

The Workshop imports local source material, keeps exact evidence beside proposed
knowledge, and publishes reviewed content into the Living Outline and an existing
Fablewood pack. Its working data is separate from game saves.

The verified main session is available at [Workshop](http://127.0.0.1:5416/workshop/)
and [Living Outline](http://127.0.0.1:5416/app/).

## Start the integrated app

From the repository root, with the Goal 2 Living Outline changes installed:

```sh
STATE_DIR="$PWD/.state-outline" JUDGE_MODE=stub \
  WORKSHOP_DIR="$PWD/.workshop" python3 secreg/serve.py --port 5412
```

Open `http://127.0.0.1:5412/workshop/` for ingestion and review, or
`http://127.0.0.1:5412/app/` for the reader. The server binds to loopback. Use
`--workshop-read-only` for browsing without mutations. A fresh working directory
starts empty; the reader can display the checked-in reviewed demonstration release.
The local main checkout is seeded from the verified seven-source campaign when
`workshop-evidence/integration/main-workspace-copy.json` is present. Its existing
agent review decisions and three releases remain available for inspection.

For the Workshop alone:

```sh
python3 -m workshop --port 5413
```

The standalone server provides ingestion, review, evidence, and publications. Reader
navigation requires the integrated server above. Scratch servers use ports 5400+;
5173, 5175, and 5219 are reserved by the project.

## Use it

1. Choose a registered statute, casebook excerpt, or canon lecture, or enter the path
   of a UTF-8 Markdown/plain-text book excerpt, outline, or document. Imports snapshot
   selected text and checksum the original. Source kind, attribution, and edition
   date remain separate from legal currency.
2. Start extraction in the arrival card. Public document processing uses the locally
   authenticated Claude subscription CLI, followed by an independent assessment.
   No API keys are used. Sign in to the CLI in a terminal if a job reports missing
   authentication, then resume. Jobs retain raw responses and completed chunks.
3. Inspect a statement to see exact quotes, original locations, source versions,
   advisory assessments, and review history. Approve or reject with attribution;
   use a proposed correction to preserve the original while refining a claim.
   Relationship suggestions remain tentative until reviewed.
   **Existing game knowledge** compares likely base-pack matches. Confirm only when
   the claim and existing fact have the same conditions and scope, or dismiss the
   suggestion with a reason. The reviewer and method are recorded explicitly.
4. Capture an observation in the personal-note form. It stays an attributed personal
   layer and never becomes legal authority or a game fact. In the reader, enable a
   newly introduced personal layer from **Layers**; new layers start off so existing
   reading preferences are preserved.
5. Preview and publish. The reader receives the approved envelope. The game artifact
   merges compatible additions into the existing securities pack and passes the real
   pack validator before the current publication changes.

Lecture processing reuses already indexed canon clips locally. It rechecks original
transcript hashes, segment IDs, quote text, and timestamps. It does not send private
lecture text to a model. These attributed excerpts enter the outline only; they are
not newly synthesized lecture analysis or game teaching material.

## Durability and maintenance

`WORKSHOP_DIR/workshop.json` is the durable source/job/review ledger. `receipts/`
contains the actual CLI or local-processing receipts. `publications/` holds immutable
validated releases. Keep this directory to resume your work. It is local working
data, not a game save and not intended for automatic source-control inclusion.

Repeated identical imports reuse their source version and job. Changed original
bytes produce a new source version. Identical propositions gain supporting evidence
without losing IDs or prior reviews. A changed statement receives its own ID and an
explicit proposed relationship. Unsupported quotes cannot be approved as supported
knowledge. Contradictory sources remain inspectable together.

Confirmed game matches publish the new source evidence to the outline while reusing
the existing game fact and schedule. A duplicate already published by the Workshop
keeps its fact/encounter IDs and history but leaves practice. A changed claim or
canonical fact requires renewed review. Matching is advisory and can miss paraphrases.

Each new release records its predecessor and artifact checksums. Returning to an
earlier selection creates a new immutable release; immediate retries reuse the
current one. A release installed just before an interrupted ledger write can be
recovered on retry. Historical releases and their source snapshots are never overwritten.

Confirmed supersessions use the game's existing amendment mechanism. The old fact
and encounter remain addressable, but old practice is retired. The successor becomes
available after the game's amendment witness step; existing learning history is not
copied, reset, or migrated. A proposed relationship alone does not settle a conflict.

The CLI and HTTP server share the same processing boundary. Only one subscription
CLI invocation runs at a time per local user; different jobs can wait without
discarding progress. After a terminated process, unfinished jobs show as interrupted
and resume from completed chunks. Failed and retried attempts remain in the ledger.

Publishing never installs a pack into a live game or changes learning history.
Review the generated pack before a separate installation. Existing source files,
parked staging content, fact/encounter identities, and live save directories are
protected. Currency stays unverified unless separately established; a matching
checksum proves which source edition was used.

## Terminal operations

```sh
python3 -m workshop --status
python3 -m workshop --import-catalog atlas:rule.506c
python3 -m workshop --run-job job.REPLACE_WITH_RETURNED_ID
python3 -m unittest discover -s workshop/tests
npx vitest run --config workshop/vitest.config.ts
node workshop/tests/browser.mjs
```

Use `--storage /absolute/dedicated/directory` for isolated experiments. Never select
`state/` or the native app's live data. The shared data and HTTP contract is in
`docs/design/knowledge-publication-contract.md`; verification receipts and limits are
documented alongside this file.
