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
 * Re-enumerated from scratch for this task (not copied from the W8 count): every real
 * `services.draw.due(`/`services.draw.fresh(` call site in app/src, doc comments excluded,
 * collapses to exactly five logical consumers across three files:
 *   - DungeonScene.ts: teachingFacts() (fresh-only) + trimDraw() (due, with a fresh fallback)
 *   - HamletScene.ts:  doWellspring() (due, with a fresh fallback)
 *   - CombatScene.ts:  globalDraw() (due, with a fresh fallback) + ddDraw() (due, with a
 *                       fresh fallback)
 * That's 2 + 1 + 2 = 5 consumers, spending 3 + 2 + 4 = 9 raw due/fresh calls (teachingFacts
 * has no fresh-fallback call; every other consumer is a due-then-fresh pair).
 *
 * A whole-tree scan (not a hardcoded file list) is deliberate: the thing actually worth
 * guarding is "no NEW file starts calling the draw service," which a scan catches and a
 * fixed 3-file allowlist alone would not.
 */

const APP_SRC = join(__dirname, '../../..'); // app/src

const EXPECTED: Record<string, { calls: number; fnNames: string[] }> = {
  'src/game/scenes/dungeon/DungeonScene.ts': { calls: 3, fnNames: ['teachingFacts', 'trimDraw'] },
  'src/game/scenes/hamlet/HamletScene.ts': { calls: 2, fnNames: ['doWellspring'] },
  'src/game/combat/CombatScene.ts': { calls: 4, fnNames: ['globalDraw', 'ddDraw'] },
};

const CALL_RE = /services\.draw\.(due|fresh)\(/g;

/** Real (non-comment) call sites of services.draw.due(/fresh( in one file's text. Mirrors the
 *  classification the task-10 source audit did by hand: a line is a doc comment if, trimmed,
 *  it starts with `//`, `*`, or `/**` — good enough for this codebase's own comment style
 *  (block-comment prose is always `*`-prefixed per line; there is no inline `/* ... *‍/` use
 *  of services.draw anywhere, checked by inspection). */
function realDrawCalls(src: string): number {
  let count = 0;
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) continue;
    const matches = line.match(CALL_RE);
    if (matches) count += matches.length;
  }
  return count;
}

/** Recursively collect every .ts source file under app/src, excluding tests/fixtures/dts —
 *  the same universe a "did a sixth consumer appear ANYWHERE" check needs to cover. */
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

describe('the draw census — five consumers, three files, forever (Ch. IX)', () => {
  it('every real services.draw.due()/fresh() call site in app/src is one of the five named consumers', () => {
    const allFiles = walkTsFiles(APP_SRC);
    const hits = new Map<string, number>();
    for (const file of allFiles) {
      const src = readFileSync(file, 'utf8');
      const n = realDrawCalls(src);
      if (n > 0) hits.set(relative(APP_SRC, file).split('\\').join('/'), n);
    }

    // draw/register.ts is the plumbing (it calls the raw drawDue/drawNew, not
    // services.draw.due/fresh), never a consumer — confirm it stays that way and is excluded
    // from this count by construction (it wouldn't match CALL_RE at all).
    expect(hits.has('draw/register.ts'), 'the wiring layer is not itself a consumer').toBe(false);

    const gotFiles = [...hits.keys()].sort();
    const wantFiles = Object.keys(EXPECTED).sort();
    expect(gotFiles, 'exactly three files call the draw service — no sixth consumer in a new file').toEqual(wantFiles);

    let total = 0;
    for (const [file, expected] of Object.entries(EXPECTED)) {
      expect(hits.get(file), `${file}: raw due()/fresh() call count`).toBe(expected.calls);
      total += expected.calls;
    }
    expect(total, '9 raw calls = 5 logical due-then-fresh-fallback consumers (teachingFacts is fresh-only)').toBe(9);
  });

  it('each of the five named consumer functions is still present in its file', () => {
    for (const [file, expected] of Object.entries(EXPECTED)) {
      const src = readFileSync(join(APP_SRC, file), 'utf8');
      for (const fnName of expected.fnNames) {
        expect(src.includes(fnName), `${file} still defines/calls ${fnName}`).toBe(true);
      }
    }
  });
});
