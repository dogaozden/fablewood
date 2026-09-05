/**
 * 2.3 — pipeline/validate_dungeon.mjs gates boss.relicId against a closed set of known relic
 * ids, mirroring how it already gates enemy.archetype. That set is necessarily a hand-written
 * literal duplicated from the catalog (a plain Node script can't import TypeScript), so this
 * test imports it directly and asserts it stays byte-equal to the catalog's own relic ids —
 * the two can never drift silently.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
// @ts-expect-error — plain Node ESM pipeline script, no .d.ts (it isn't part of the app/src
// TS project: tsconfig.json's include is ["app/src"]); vitest/esbuild resolve the value fine,
// this is purely tsc's noImplicitAny on the untyped import.
import { RELIC_IDS } from '../../../pipeline/validate_dungeon.mjs';

describe('validate_dungeon.mjs RELIC_IDS parity with the catalog (2.3)', () => {
  it('is exactly the set of catalog ids whose type is relic — no more, no less', () => {
    const catalogRelicIds = new Set(CATALOG.filter((i) => i.type === 'relic').map((i) => i.id));
    expect(RELIC_IDS).toEqual(catalogRelicIds);
  });

  it('is non-empty (a vacuously-passing parity check would hide the whole point)', () => {
    expect(RELIC_IDS.size).toBeGreaterThan(0);
  });
});
