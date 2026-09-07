# Workshop game consumer verification

Verified 2026-09-07 against baseline e9567f8 and the actual publication
`publication.fdd97cd96fc9ec450e6fad3e`.

## Published content

The original securities pack has 271 facts and 290 encounters. The published pack
has 290 facts and 309 encounters: 19 reviewed Workshop additions. All original
fact and encounter records compare equal. The real pack validator passes.

`workshop/tests/published-consumer.test.ts` loads that actual artifact through the
engine validator and registers its real SRS and draw services. It discovers every
fact, draws a new Workshop fact, resolves its free-recall encounter, records a
correct answer, and draws it at its new three-day due time. The existing seeded
record, two history entries, and per-fact/top-level reference metadata remain
unchanged. Registration and drawing make no state writes; grading writes only
the isolated in-memory SRS bridge.

## Maintenance

`workshop/tests/consumer.test.ts` separately creates a neutral source, publishes an
original proposition, then publishes a confirmed successor through the real
publisher and validator. The actual engine excludes the old fact, gates the
successor until the existing amendment-witness step, and keeps the old and new
learning histories intact. Two cases cover an overdue old record and an already
due successor with no old record.

## Result and boundary

`npx vitest run --config workshop/vitest.config.ts`: **2 files, 3 tests passed**.
An earlier one-test report described the initial 272-fact release. The current
harness restores actual-publication coverage alongside the two maintenance tests;
only these current results describe the final 290-fact artifact.

This is a real consumer-service harness with an isolated persistence bridge. It
uses engine schema validation, registration, indexing, draw, amendment, grading,
and SRS merge code. It does not launch the 3D game, render an encounter, invoke
the game judge, or validate native storage. Publication is a compatible local
artifact; it is not installed into the player's live game.
