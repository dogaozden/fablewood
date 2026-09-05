import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACEHOLDER, T1_BEATS } from './beats';

/**
 * Beat-prose drift guard — the CARRY item that gives beats.ts what cantos.test.ts
 * already gives cantos.ts. It is deliberately NOT a byte-verbatim check, because the
 * shipped T1 beats are not byte-verbatim: card prose is a CURATED excerpt of the canon
 * chapter, which legitimately (a) drops a clause mid-sentence, (b) substitutes a name
 * for a pronoun so a standalone card reads ("At first light Alder came up the lane",
 * canon `arc-01-the-road-that-waits.md:33` says "he"), and (c) joins two paragraphs
 * with an editorial " — ". Measured on the shipped tree: 6 of 7 T1 strings are not
 * substrings of the canon at all, so a substring assertion would fail on day one.
 *
 * What IS true, and is what this guard pins: curated prose is made of long verbatim
 * RUNS of the canon with short editorial seams between them. So: normalise both sides
 * (curly quotes, italic markers, whitespace), then measure what fraction of a string's
 * words sit inside some run of >= MIN_RUN words found verbatim in the canon.
 *
 * Calibration (measured, not guessed): the seven shipped T1 strings score
 * 1.000 / 0.963 / 1.000 / 0.956 / 0.813 / 0.933 / 0.804 — worst 0.804. A floor of 0.75
 * clears every one with margin. Sensitivity: changing one word scores 0.990 (passes —
 * an honest limit of a lossy-excerpt guard), paraphrasing a third of a page scores
 * 0.650 (FAILS), inventing a page from scratch scores 0.000 (FAILS). This catches
 * paraphrase and invention, which is the drift that actually matters for curated text;
 * it does not catch a single-word typo. Stated, not hidden.
 */
const CANON = readFileSync(
  join(__dirname, '..', '..', '..', 'docs', 'story', 'onward', 'arc-01-the-road-that-waits.md'),
  'utf8',
);

const MIN_RUN = 6;
const MIN_COVERAGE = 0.75;

function normalise(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const DOC = normalise(CANON);

/** Fraction of `text`'s words covered by a >= MIN_RUN-word verbatim run of the canon. */
export function canonCoverage(text: string): number {
  const words = normalise(text).split(' ');
  if (words.length < MIN_RUN) return 1; // too short to measure; titles/margins fall here
  const covered = new Array<boolean>(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    let best = 0;
    for (let len = MIN_RUN; i + len <= words.length; len++) {
      if (DOC.includes(words.slice(i, i + len).join(' '))) best = len;
      else break;
    }
    for (let k = i; k < i + best; k++) covered[k] = true;
  }
  return covered.filter(Boolean).length / words.length;
}

/** Every player-visible string on a beat: its title, its pages, and its margin if any. */
function beatStrings(b: { id: string; title: string; pages: string[]; margin?: string }): string[] {
  return [b.title, ...b.pages, ...(b.margin === undefined ? [] : [b.margin])];
}

describe('beat prose drift guard — curated cards still read as the canon chapter', () => {
  it('every non-placeholder T1 string covers the canon at or above the floor', () => {
    for (const beat of T1_BEATS) {
      for (const s of beatStrings(beat)) {
        if (s.startsWith(PLACEHOLDER)) continue;
        const c = canonCoverage(s);
        expect(c, `${beat.id}: "${s.slice(0, 60)}…" covers only ${c.toFixed(3)} of the canon`).toBeGreaterThanOrEqual(
          MIN_COVERAGE,
        );
      }
    }
  });

  it('scores invented prose at zero — the guard actually bites', () => {
    expect(
      canonCoverage(
        'The gatewarden opened the gate and a bright thing came home to him at last, out of the long grey road beyond the fence.',
      ),
    ).toBe(0);
  });

  it('T1 carries no placeholders — every T1 string is curated', () => {
    const placeholders = T1_BEATS.flatMap(beatStrings).filter((s) => s.startsWith(PLACEHOLDER));
    expect(placeholders, 'T1 shipped fully curated; a placeholder here is a regression').toEqual([]);
  });
});
