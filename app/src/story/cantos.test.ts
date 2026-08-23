import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANTOS } from './cantos';

/** docs/story/the-first-lantern.md relative to app/ (vitest cwd is the repo root or app/ —
 *  resolve from this test file instead so both work). */
const MD = readFileSync(
  join(__dirname, '..', '..', '..', 'docs', 'story', 'the-first-lantern.md'),
  'utf8',
);

/** Split the epic into its seven canto bodies, header line included. */
function mdCantos(): { header: string; body: string }[] {
  const parts = MD.split(/^## /m).slice(1); // drop the front-matter block
  return parts.map((p) => {
    const nl = p.indexOf('\n');
    return { header: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() };
  });
}

describe('CANTOS drift test — the engine copy is the epic, verbatim', () => {
  it('carries exactly the seven cantos, in order, titles matching the doc', () => {
    const md = mdCantos();
    expect(md.length).toBe(7);
    expect(CANTOS.length).toBe(7);
    md.forEach((m, i) => {
      expect(m.header).toContain(CANTOS[i].roman);
      expect(m.header).toContain(CANTOS[i].title);
    });
  });

  it('every canto body is byte-identical to the doc (Fable text is never rewritten)', () => {
    const md = mdCantos();
    md.forEach((m, i) => {
      expect(CANTOS[i].body, `canto ${CANTOS[i].roman}`).toBe(m.body);
    });
  });
});
