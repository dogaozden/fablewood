import { describe, expect, it } from 'vitest';
import { isGhostReopen, REOPEN_SETTLE_MS } from './dom';

/**
 * Crucible V1-15: the ghost-reopen guard (openPane's REOPEN_SETTLE_MS check, added to fix
 * v0 #2's "rapid q/Escape leaves a ghost-reopened pane behind") used to key off ONE shared
 * module-level `lastCloseAt` timestamp for every pane (Satchel/Shop/combat-Satchel alike).
 * That meant closing Shop and then opening a genuinely DIFFERENT pane (the Satchel) within
 * 150ms was misjudged as a ghost reopen of Shop and silently swallowed before paint.
 *
 * isGhostReopen() is the pure decision extracted out of openPane() (dom.ts has no jsdom in
 * this project — vite.config.ts's vitest `test.environment` is 'node' — so the DOM-heavy
 * parts of openPane() itself aren't unit-testable here; this pure slice is).
 */
describe('isGhostReopen (V1-15 per-pane reopen-guard scoping)', () => {
  it('is false for a pane with no prior recorded close', () => {
    expect(isGhostReopen('shop', Date.now(), new Map())).toBe(false);
  });

  it('is true just inside REOPEN_SETTLE_MS of closing the SAME pane (preserves the original v0 #2 fix)', () => {
    const closedAt = new Map([['shop', 1000]]);
    expect(isGhostReopen('shop', 1000 + REOPEN_SETTLE_MS - 1, closedAt)).toBe(true);
  });

  it('clears once REOPEN_SETTLE_MS has fully elapsed for that same pane', () => {
    const closedAt = new Map([['shop', 1000]]);
    expect(isGhostReopen('shop', 1000 + REOPEN_SETTLE_MS, closedAt)).toBe(false);
  });

  it('V1-15 regression: closing Shop then opening a DIFFERENT pane (Satchel) within the settle window is never a ghost reopen', () => {
    const closedAt = new Map([['shop', 1000]]);
    // 10ms after Shop closed — exactly the "press I within ~150ms" repro. A shared single
    // timestamp would have wrongly reported this as a ghost reopen; per-pane scoping must not.
    expect(isGhostReopen('inventory', 1000 + 10, closedAt)).toBe(false);
  });

  it('scopes independently per pane: the same instant can be a ghost reopen for one pane and not another', () => {
    const closedAt = new Map([
      ['shop', 1000],
      ['inventory', 5000],
    ]);
    const now = 5010;
    expect(isGhostReopen('shop', now, closedAt)).toBe(false); // shop's own close was 4010ms ago
    expect(isGhostReopen('inventory', now, closedAt)).toBe(true); // inventory's own close was 10ms ago
  });
});
