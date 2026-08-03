import { describe, it, expect } from 'vitest';
import { buildDrawIndex, drawNew } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { DrawDeps } from '../types';

const idx = buildDrawIndex([PACK_ALPHA, PACK_BETA]);
const deps = (seen: string[]): DrawDeps => ({
  dueOrder: ids => ids, eligible: () => true, hasRecord: id => seen.includes(id),
});

describe('drawNew', () => {
  it('introduces only unseen facts, rotating across packs', () => {
    const out = drawNew(idx, deps([]), { count: 4, seed: 3, now: 0 });
    expect(out.length).toBe(4);
    const seq = out.map(id => idx.packIdByFactId.get(id));
    expect(seq[0]).not.toBe(seq[1]); // strict alternation with two packs
    expect(seq[2]).not.toBe(seq[3]);
  });

  it('holds back prereq-gated facts until the prereq is seen', () => {
    const none = drawNew(idx, deps([]), { count: 8, seed: 1, now: 0 });
    expect(none).not.toContain('fx.a.two'); // prereq fx.a.one unseen
    const after = drawNew(idx, deps(['fx.a.one']), { count: 8, seed: 1, now: 0 });
    expect(after).toContain('fx.a.two');
  });

  it('never returns already-seen facts', () => {
    const out = drawNew(idx, deps(['fx.a.one', 'fx.b.one']), { count: 8, seed: 9, now: 0 });
    expect(out).not.toContain('fx.a.one');
    expect(out).not.toContain('fx.b.one');
  });
});
