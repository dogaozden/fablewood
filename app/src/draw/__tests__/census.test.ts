import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Concordance Ch. IX (Task 10, the wave sweep): "no relic reads or writes the record seam,
 * the judge, the draw census (five consumers, forever), or the SRS." This file pins the
 * census itself — the one piece of that sentence with a checkable shape — since nothing
 * upstream of this task ever encoded "five consumers, three files" as a real assertion. It
 * was only ever hand-verified: a W8-certification headcount, then re-quoted in this wave's
 * own review comments ("the census law counts CONSUMERS, not files... don't re-assert
 * 'five' without enumerating") without a pin that would fail if a sixth ever appeared.
 *
 * Re-enumerated from scratch for this task: every real `services.draw.due(`/
 * `services.draw.fresh(` call site in app/src, doc comments excluded, collapses to exactly
 * five logical consumers across three files:
 *   - DungeonScene.ts: teachingFacts() (fresh-only) + trimDraw() (due, with a fresh fallback)
 *   - HamletScene.ts:  doWellspring() (due, with a fresh fallback)
 *   - CombatScene.ts:  globalDraw() (due, with a fresh fallback) + ddDraw() (due, with a
 *                       fresh fallback)
 * That's 2 + 1 + 2 = 5 consumers, spending 3 + 2 + 4 = 9 raw due/fresh calls.
 *
 * Fix-round-1 hardening (2026-08-18, I2): the original version of this file matched only the
 * literal `services.draw.due(`/`services.draw.fresh(` adjacency, line by line. Review showed
 * two ordinary, zero-adversarial-intent refactors would make a NEW 6th consumer invisible to
 * it: (a) a destructuring alias (`const { due } = services.draw;` then calling bare `due(...)`
 * elsewhere — no `services.draw.due(` substring ever appears), and (b) Prettier wrapping a
 * long call across a line break (`services.draw\n  .fresh({...})` — the old per-line regex
 * never saw the two halves as adjacent). Both would have left the census "still exactly 3
 * files" while a real 6th consumer sat unseen.
 *
 * Hardened design: scan the WHOLE file text (comments and string literals stripped first —
 * see stripCode) for every occurrence of the literal `services.draw` — a destructuring alias
 * source still contains that literal, and a Prettier wrap breaks at the dot boundary AFTER
 * it, never mid-identifier, so the literal itself always survives intact. Classify each
 * occurrence 3 ways, by what (if anything) follows it:
 *   - CALL: immediately `.due(`/`.fresh(` (whitespace/newline-tolerant) — a real draw.
 *   - SAFE: immediately one of the OTHER seven real DrawApi methods (ready, indexReady,
 *     allFactIds, sourceOf, factOf, encountersOf, isEmpty) — legitimate non-drawing usage
 *     every consumer file also has (readiness checks, metadata lookups); parens optional,
 *     since encountersOf is sometimes passed as a bare callback reference, never invoked
 *     inline (HamletScene.ts/CombatScene.ts both do this).
 *   - SUSPICIOUS: anything else — nothing recognizable follows (a destructuring source, the
 *     register.ts assignment target), OR `.due`/`.fresh` WITHOUT a call paren (itself the
 *     alias-risk shape), OR an unrecognized method name (the DrawApi surface grew — worth a
 *     human's eyes either way).
 * Then assert: the FULL SET of files containing ANY occurrence (call, safe, OR suspicious) is
 * exactly the 3 consumer files plus the three known bare-only touchpoints below; suspicious
 * occurrences are zero everywhere in today's tree; and the 3 consumers' CALL counts match the
 * enumeration above exactly. A bare occurrence in an unlisted file, a call hidden by
 * wrapping, or a due/fresh reference missing its call parens all now surface as a failure
 * instead of vanishing.
 *
 * True boundary (stated, not implied): this catches ORDINARY refactors — aliasing,
 * destructuring, reformatting, a passed-around method reference. It does NOT catch deliberate
 * obfuscation: renaming the `services` singleton itself before importing it, constructing the
 * property name dynamically (`services['dr' + 'aw']`), or re-exporting `services.draw` under
 * a new name from a third module and importing THAT everywhere. Those require intent no
 * accidental refactor has, and are out of scope for a text-level scan — a real AST/type-
 * checker pass would be the next rung, not attempted here.
 *
 * The broadened scan surfaced one real, pre-existing, non-consumer touchpoint the old narrow
 * regex never saw: game/encounters/register.ts calls services.draw.indexReady()/.isEmpty()/
 * .encountersOf/.factOf for cross-pack fact/encounter resolution (pick()'s own docstring:
 * "encountersOf... is per-fact source resolution for step 2 ONLY") — never .due(/.fresh(, so
 * it never draws a new assignment. Allowlisted below as bare-only, same as draw/register.ts.
 *
 * T1-6 (the reading desk) added a third: story/register.ts's openDesk() calls
 * services.draw.indexReady()/.allFactIds() to enumerate the global fact pool for weldCount()
 * (books.ts) — an enumeration read, never a due()/fresh() draw. Same bare-only shape as the
 * other two.
 */

// Fix-round-1 (M1): this used to be `../../..` (3 levels up from __tests__, landing on app/,
// not app/src as the old comment claimed) — harmless only because every path key below
// carried a redundant leading "src/" that happened to cancel the error out. Two levels up
// (__tests__ -> draw -> src) actually lands on app/src, scoping the walk to source only
// (not app/'s configs, dist, or anything else) — verified unchanged: same 3/2/4 call split,
// same file set, before and after (quoted in the fix-round report).
const APP_SRC = join(__dirname, '../..'); // app/src

const EXPECTED_CALLS: Record<string, { calls: number; fnNames: string[] }> = {
  'game/scenes/dungeon/DungeonScene.ts': { calls: 3, fnNames: ['teachingFacts', 'trimDraw'] },
  'game/scenes/hamlet/HamletScene.ts': { calls: 2, fnNames: ['doWellspring'] },
  'game/combat/CombatScene.ts': { calls: 4, fnNames: ['globalDraw', 'ddDraw'] },
};
const WIRING_FILE = 'draw/register.ts';
// Bare-only non-consumer touchpoints: allowed to mention services.draw (safely — see
// findDrawOccurrences), but never to CALL due()/fresh() on it — that would make them an
// undeclared 6th consumer.
const BARE_ONLY_FILES = [WIRING_FILE, 'game/encounters/register.ts', 'story/register.ts'];

// The DrawApi surface besides due()/fresh() (draw/register.ts's own services.draw = {...}
// literal is the ground truth for this list: ready, indexReady, due, fresh, allFactIds,
// sourceOf, factOf, encountersOf, isEmpty — nine methods, two of them due/fresh).
const SAFE_METHODS = ['ready', 'indexReady', 'allFactIds', 'sourceOf', 'factOf', 'encountersOf', 'isEmpty'];

/** Strip comments AND string-literal contents before scanning, so neither doc-comment prose
 *  (contracts.ts mentions "services.draw" twice, both in /** prose) nor a log message like
 *  `console.warn('...services.draw index failed...')` (every one of the 3 consumer files has
 *  exactly this pattern) can produce a false hit. Known, accepted limitation: a regex literal
 *  containing a literal `//` (e.g. `/\/\//`) would still be mis-read as starting a line
 *  comment — checked by hand that nothing in this scan's real universe does that near a
 *  services.draw mention. A whole-tree text scan trades that theoretical edge case for not
 *  needing a real TS parser; documented rather than hidden. */
function stripCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

export type DrawOccurrenceKind = 'call' | 'safe' | 'suspicious';
export interface DrawOccurrence {
  kind: DrawOccurrenceKind;
  method: string | null;
}

/** Every `services.draw` occurrence in (code-only) source, 3-way classified — see the
 *  file-header note for the full rationale. Whitespace/newline-tolerant on both sides of the
 *  dot (services . draw) and between the match and whatever follows it. Exported so the
 *  synthetic tests below can drive it directly, independent of the real tree. */
export function findDrawOccurrences(rawSrc: string): DrawOccurrence[] {
  const src = stripCode(rawSrc);
  const out: DrawOccurrence[] = [];
  const re = /\bservices\s*\.\s*draw\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const afterDot = rest.match(/^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/);
    if (!afterDot) {
      out.push({ kind: 'suspicious', method: null }); // e.g. "= {...}" or ";" — no method at all
      continue;
    }
    const name = afterDot[1];
    const hasCallParen = /^\s*\(/.test(rest.slice(afterDot[0].length));
    if (name === 'due' || name === 'fresh') {
      out.push(hasCallParen ? { kind: 'call', method: name } : { kind: 'suspicious', method: name });
    } else if (SAFE_METHODS.includes(name)) {
      out.push({ kind: 'safe', method: name });
    } else {
      out.push({ kind: 'suspicious', method: name }); // unrecognized DrawApi surface — worth a look
    }
  }
  return out;
}

/** Recursively collect every .ts source file under app/src, excluding tests/fixtures — the
 *  same universe a "did a sixth consumer appear ANYWHERE" check needs to cover. */
function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('findDrawOccurrences — the scanner itself, against synthetic sources (fix-round-1, I2)', () => {
  it('finds a plain same-line call', () => {
    const occ = findDrawOccurrences(`services.draw.due({ count: 1 });`);
    expect(occ).toEqual([{ kind: 'call', method: 'due' }]);
  });

  it('EVASION 1 — a Prettier-wrapped call still resolves as a call (the literal breaks at the dot, not mid-identifier)', () => {
    const occ = findDrawOccurrences(`
      services.draw
        .fresh({ count: 1, seed, now });
    `);
    expect(
      occ,
      'the old line-by-line regex would have missed this — .fresh( never shared a line with services.draw',
    ).toEqual([{ kind: 'call', method: 'fresh' }]);
  });

  it('EVASION 2 — a destructuring-alias site is found as a SUSPICIOUS occurrence, not made invisible', () => {
    const occ = findDrawOccurrences(`
      const { due } = services.draw;
      function sneakyConsumer() {
        return due({ count: 1 });
      }
    `);
    // The alias site is found (nothing follows "services.draw" but ";"). Under the OLD regex
    // (services\.draw\.(due|fresh)\() a file shaped like this would have produced ZERO hits
    // and been invisible to the census entirely — a real 6th consumer hiding in plain sight.
    // Under the hardened scanner it produces one SUSPICIOUS hit, which the whole-tree test
    // below turns into a failure the moment it appears anywhere outside the allowlist.
    expect(occ).toEqual([{ kind: 'suspicious', method: null }]);
  });

  it('a bare .due/.fresh reference with no call parens is ALSO suspicious, not safe — the same alias risk as destructuring', () => {
    const occ = findDrawOccurrences(`const fn = services.draw.due;`);
    expect(occ).toEqual([{ kind: 'suspicious', method: 'due' }]);
  });

  it('recognizes the other seven real DrawApi methods as safe, called or passed bare', () => {
    for (const name of ['ready', 'indexReady', 'allFactIds', 'sourceOf', 'factOf', 'isEmpty']) {
      expect(findDrawOccurrences(`services.draw.${name}();`), `${name}(), called`).toEqual([
        { kind: 'safe', method: name },
      ]);
    }
    // encountersOf is the one real consumer files pass around bare (never invoke inline).
    expect(findDrawOccurrences(`const x = cond ? services.draw.encountersOf : undefined;`)).toEqual([
      { kind: 'safe', method: 'encountersOf' },
    ]);
  });

  it('an unrecognized method name is flagged suspicious, not silently allowed', () => {
    const occ = findDrawOccurrences(`services.draw.someNewMethodNobodyKnowsAboutYet();`);
    expect(occ).toEqual([{ kind: 'suspicious', method: 'someNewMethodNobodyKnowsAboutYet' }]);
  });

  it('ignores a mention inside a line comment or a block comment', () => {
    const occ = findDrawOccurrences(`
      // services.draw.due({ count: 1 }); — commented out, must not count
      /* services.draw.fresh({ count: 1 }); also commented out */
      const real = 1;
    `);
    expect(occ).toEqual([]);
  });

  it('ignores a mention inside a string literal — a console.warn message, exactly the shape every consumer file has', () => {
    const occ = findDrawOccurrences(
      `console.warn('[dungeon] services.draw index failed to load — falling back to the legacy lookup');`,
    );
    expect(occ, 'prose inside a log message must not count as a code reference').toEqual([]);
  });

  it('classifies the register.ts-style definition (services.draw = {...}) as suspicious (bare, no method), never a call', () => {
    const occ = findDrawOccurrences('services.draw = {\n  due(opts) { return drawDue(index, deps, opts); },\n};');
    expect(occ).toEqual([{ kind: 'suspicious', method: null }]);
  });
});

describe('the draw census — five consumers, three files, forever (Ch. IX)', () => {
  it('every mention of services.draw in app/src is confined to the 3 named consumer files plus the bare-only touchpoints, and no mention anywhere is suspicious', () => {
    const allFiles = walkTsFiles(APP_SRC);
    const byFile = new Map<string, DrawOccurrence[]>();
    for (const file of allFiles) {
      const rel = relative(APP_SRC, file).split('\\').join('/');
      const occ = findDrawOccurrences(readFileSync(file, 'utf8'));
      if (occ.length) byFile.set(rel, occ);
    }

    const allowed = new Set([...Object.keys(EXPECTED_CALLS), ...BARE_ONLY_FILES]);
    const gotFiles = [...byFile.keys()].sort();
    expect(
      gotFiles,
      'no 6th consumer anywhere in app/src — including one hidden behind a destructuring alias or a wrapped line',
    ).toEqual([...allowed].sort());

    // Zero SUSPICIOUS occurrences anywhere EXCEPT the wiring file's own definition site
    // (handled precisely below) — this is the actual I2 guard: a destructuring alias, a bare
    // .due/.fresh reference, or an unrecognized method name would all show up here, in ANY
    // other file (consumer, bare-only, or otherwise), and fail loudly rather than silently
    // changing a count.
    for (const [file, occ] of byFile) {
      if (file === WIRING_FILE) continue;
      const suspicious = occ.filter((o) => o.kind === 'suspicious');
      expect(suspicious.length, `${file}: zero suspicious services.draw occurrences`).toBe(0);
    }

    // Bare-only touchpoints: never a CALL (safe or, for the wiring file only, its one known
    // suspicious-by-design assignment).
    for (const file of BARE_ONLY_FILES) {
      const occ = byFile.get(file) ?? [];
      expect(occ.length, `${file}: mentions services.draw at least once`).toBeGreaterThan(0);
      expect(occ.every((o) => o.kind !== 'call'), `${file}: never CALLS due()/fresh() on services.draw`).toBe(true);
    }
    // draw/register.ts specifically: exactly one mention, and it IS the suspicious-by-design
    // `services.draw = {...}` assignment (the exact shape the synthetic test above pins) —
    // genuinely stable, pinned tighter than the general bare-only check above. If this file
    // ever grew a SECOND mention, or its one mention stopped being the plain assignment, that
    // would mean the wiring itself changed shape and deserves a human look.
    const wiring = byFile.get(WIRING_FILE) ?? [];
    expect(wiring, 'draw/register.ts mentions services.draw exactly once — the assignment, suspicious-by-design').toEqual([
      { kind: 'suspicious', method: null },
    ]);

    // The 3 consumer files: exactly the expected CALL counts (9 total).
    let totalCalls = 0;
    for (const [file, expected] of Object.entries(EXPECTED_CALLS)) {
      const occ = byFile.get(file) ?? [];
      const calls = occ.filter((o) => o.kind === 'call');
      expect(calls.length, `${file}: due()/fresh() CALL count`).toBe(expected.calls);
      totalCalls += calls.length;
    }
    expect(totalCalls, '9 raw calls = 5 logical due-then-fresh-fallback consumers (teachingFacts is fresh-only)').toBe(9);
  });

  it('each of the five named consumer functions is still present in its file', () => {
    for (const [file, expected] of Object.entries(EXPECTED_CALLS)) {
      const src = readFileSync(join(APP_SRC, file), 'utf8');
      for (const fnName of expected.fnNames) {
        expect(src.includes(fnName), `${file} still defines/calls ${fnName}`).toBe(true);
      }
    }
  });
});
