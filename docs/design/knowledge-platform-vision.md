# The Ledger Beyond the Game — Generalizing the Knowledge System

> Provenance: Fable orchestrator, inline, 2026-07-22 (~01:00), on the author's brief: *"think about
> generalizing the knowledge system that underlies the game. it's meant to be the place where i
> will store a lifetime's worth of knowledge. mostly for myself, but also for my AIs. how could
> it be better?"* Grounded against the real substrate at HEAD `5cf8596`: `app/src/packs/types.ts`,
> `pipeline/` (epub_to_md → compile_pack → validate_{pack,dungeon,quotes} → expand_pack),
> `state/srs.json` (Leitner 5-box, full graded history per fact). This is a VISION MEMO for
> discussion — nothing here is scheduled. §9 is the only part proposed for near-term action.

## 1. The reframe: the store is the product; the game is one client

Today FABLEWOOD is "a game with a knowledge base inside." A lifetime store inverts that: **the
Ledger (packs + SRS state) is the durable asset; the game is its first and best client** — the
one that keeps the human returning. Other clients then attach to the same substrate:

- **the author-direct**: query, browse, export ("what do I know about liquidation preferences, how
  well, since when, per which source?").
- **the author's AIs**: read his vetted knowledge instead of guessing; know what he *doesn't* know;
  propose additions through a ratification gate.
- **The game**: unchanged — provinces, encounters, the Clerk. The engine/content split we
  already enforce (`check:zero-packs`) is exactly the seam that makes multi-client possible:
  the engine never knew the content was VC law in the first place.

What makes this store different from every notes app and wiki: **it knows the difference
between what you've *collected* and what you *know*.** Each fact carries a live mastery state
(box, due date, full graded history with timestamps and encounter provenance). Nothing on the
market has that dimension. "Personal epistemic state as an API" is the moat.

## 2. What the current bones already get right (keep, never dilute)

1. **Provenance with teeth**: every fact carries `source_ref {file, loc, quote}` and
   `validate_quotes.py` enforces the quote VERBATIM against the actual source. A lifetime
   store lives or dies on trust in its own entries; this rule is the foundation. Never admit
   an unquoted external claim to canon.
2. **Temporal anchoring**: `as_of` + `source_version` on every fact. Knowledge rots; the
   schema already admits it.
3. **Typed facts** (`rule/concept/advice/do/dont/number/story`) — types are load-bearing for
   decay policy (§5) and encounter generation.
4. **Prereq DAG** — the seed of a real knowledge graph.
5. **The ratification gate**: `expand_pack.mjs`'s staged→check→human-apply shape. LLMs
   propose, the human canonizes. This is the correct constitution for AI-assisted ingestion
   and must generalize unchanged.
6. **`state/` as sacred, append-only history** — the SRS record is the irreplaceable part
   (packs can be regenerated; your learning history cannot).

## 3. The gaps a lifetime actually exposes

**3a. Self-originated knowledge has no home.** Every fact requires an external `source_ref`.
But a lifetime's knowledge includes things the author *concluded* — judgments, syntheses, lessons
from lived experience ("never take a pre-money quote at face value in a call — I got burned in
X"). Proposal: a `provenance` variant — `source_ref` (external, quote-validated) OR
`origin: 'self'` with a dated note and optional links to the facts/experiences it derives
from. Type `insight` joins the FactType union. Self-facts skip quote validation but get a
stricter ratification bar (they ARE the human speaking; the pipeline can never draft them
unprompted).

**3b. Knowledge changes, and today the schema can only be wrong quietly.** `as_of` records
when a fact was true; nothing handles a fact *ceasing* to be true (law amends, numbers move,
advice ages). Proposal: a **supersession protocol** — `supersedes: factId` on the new fact;
the old fact keeps its ID, SRS history, and a `superseded_by` back-pointer (state stability
preserved — IDs are never reused or deleted). The game turns this into a native event: **"the
Ledger has been amended"** — a re-teach encounter where the player's old, well-drilled answer
is now the *trap*, graded gently the first time. Unlearning-as-content is something no
flashcard app has ever done well, and our fiction (the world changed; the Fade didn't take it
— the truth moved) supports it perfectly.

**3c. Relations beyond prereqs.** `contradicts`, `refines`, `applies_to`, `example_of`. Not a
full ontology crusade — just enough edges that (a) encounter generation can build genuinely
cross-cutting scenario questions, and (b) an AI can walk from a question to the neighborhood
of what the author knows about it. The provinces map already IS the coarse ontology (domain = pack =
province); keep that as the navigation metaphor rather than inventing an abstract taxonomy.

**3d. The Leitner tail is too short for decades.** Box 5 caps at 30-day intervals — fine for
a game season, absurd for year-ten knowledge (it would demand ~12 reviews/year/fact forever;
at 10k facts that's a full-time job). Proposal: extend the ladder (60/180/365d boxes or an
FSRS-style scheduler behind the same `record()` seam — `leitner.ts` is already the single
choke point), and make decay **type-aware**: a `number` from a 2026 statute decays fast; a
`concept` like "economics and control" barely decays at all. `FactType` + `as_of` already
carry the needed signal.

**3e. "Used in life" should count as review.** If the author applies pay-to-play knowledge in a real
negotiation, that's a stronger proof than any drill. Cheapest honest version: a manual
attestation ("I used this today") recorded as a normal SRS event with its own quality tier —
via CLI/app, one keystroke. No surveillance, no integrations — self-report is fine for n=1.

## 4. For the AIs — the second client class

The brief says *"mostly for myself, but also for my AIs."* Concretely, in priority order:

1. **Read API (MCP server)** over packs + state: `lookup(query) → facts + mastery + provenance`,
   `mastery(topic) → what he knows/doesn't/when-last-proven`, `due() → what's rotting`.
   Subscription-auth, local-first, no keys (house rule). This is small — both stores are JSON
   on disk with stable schemas — and it's the single highest-leverage build in this memo: every
   Claude session the author runs could then ground itself in *his* vetted knowledge and calibrate
   its explanations to *his* actual mastery (skip what's box-5, scaffold what's box-1). An AI
   that knows what you know is a different tool from an AI that knows things.
2. **Write path = staging inbox only.** AIs (and pipeline runs) may file *candidate* facts —
   drafted statement, proposed quote+loc, suggested type/tags — into `staging/inbox/`. Nothing
   reaches a pack without the author's ratification (the §2.5 constitution). The Records Office
   becomes the in-game surface for this later: the Clerk "has drafts awaiting your seal."
3. **Export bundles**: `ledger export vc-law --level box3+` → a compact context file of what
   he reliably knows on a topic, for pasting into any AI session. Trivial to build, immediately
   useful, and it makes the store's value visible outside the game.

Access rules worth writing down now: AIs read everything, write only to staging, and **never
read raw SRS history wholesale** (mastery summaries suffice — the graded history is the most
personal data in the system; expose derived state, not the diary).

## 5. Ingestion at lifetime scale — the funnel is the bottleneck

vc-law took a full pipeline run on one book. A lifetime needs the marginal fact to cost
minutes, not sessions:

- **Capture**: a dumb, fast inbox (highlight, URL, one-line note → `staging/inbox/`). No
  structure demanded at capture time — structure is the pipeline's job.
- **Compile-assist**: the existing `expand_pack` shape generalized — LLM drafts the fact
  (statement, quote candidate, loc, type, difficulty, tags, prereq guesses), validators check
  the quote verbatim, the draft waits.
- **Ratify**: the author approves in batches (the proven `--check` → apply flow; later, an in-game
  Records Office desk). **Ratification is the identity of the system** — it is what makes this
  a store of *his* knowledge rather than a scraped pile.
- **Encounter generation** stays a second, separable pass (facts can live in canon before any
  game content exists for them — the store leads, the game follows).

## 6. What the game gains back (this isn't charity toward the store)

- Supersession events (§3b) = a genuinely novel mechanic (the amended Ledger).
- `insight`-type facts give the fiction its best material — the player's OWN rulings entering
  the canon is peak "what is kept, keeps."
- Cross-relation edges (§3c) upgrade scenario_branch generation from single-fact quizzes
  toward real synthesis questions — exactly what the difficulty system's Beacon tier wants.
- Long-tail scheduling (§3d) is what makes "return to the hamlet after six months away" a
  designed experience instead of an avalanche of 400 due cards.

## 7. What NOT to build (anti-goals, so generality doesn't eat the game)

- **No database UI in the game.** The game stays a game; browsing/admin lives in CLI/desktop
  surfaces. The Records Office may *theme* ratification, never expose raw JSON.
- **No auto-ingestion.** No pipeline, agent, or integration ever writes canon directly. Ever.
- **No ontology maximalism.** Edges from §3c only where they earn encounters or AI answers;
  a lifetime store that demands taxonomic gardening dies of chores.
- **No cloud dependency.** Local JSON + git remains the storage layer until it actually
  hurts; the moat is the mastery dimension, not infrastructure.
- **No SRS rewrites that touch history.** Schedulers may reinterpret history; they never
  migrate or discard it. (`state/` rules already say this; re-affirmed for scheduler work.)

## 8. Honest tensions to decide eventually (not now)

1. **Game pacing vs. store completeness**: a lifetime store wants thousands of facts; a fun
   province wants ~40-60 curated ones. Resolution direction: packs become *curated views* over
   a larger canon (the store holds everything ratified; a province compiles a playable subset).
   That's a real architectural step — canon/view split — and should wait until the second or
   third domain actually exists.
2. **Rubric ownership**: rubrics are game-content today but they encode *what counts as
   knowing* — arguably store-level. Defer until encounter generation is revisited.
3. **Multi-user never?** The brief says personal. Everything above assumes n=1 (self-report
   attestation, single ratifier). Multi-user would change the constitution — don't design for
   it speculatively.

## 9. Smallest real steps (each independently shippable, none scheduled)

1. **`ledger` MCP server, read-only** (§4.1): lookup/mastery/due over existing JSON. Small,
   no schema changes, immediately makes every AI session smarter about the author. ~Sol-sized.
2. **Staging inbox + compile-assist** (§5): generalize `expand_pack`'s existing machinery from
   "expand this pack" to "compile these captures." Mostly plumbing reuse.
3. **Supersession protocol** (§3b): schema fields + validator rules + the amended-Ledger
   re-teach encounter. Needs a short design pass on grading gentleness; the state-stability
   rules already dictate the hard constraints.
4. **Extended ladder / type-aware decay** (§3d): behind `leitner.ts`'s existing seam,
   red→green provable against synthetic histories.

Everything else in this memo is direction, not backlog.
