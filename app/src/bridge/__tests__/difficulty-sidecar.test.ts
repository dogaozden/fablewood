import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPacks } from '../plugin';
import {
  applyDifficultySidecar,
  DIFFICULTY_SIDECAR_FILE,
  type DifficultyProvenance,
} from '../difficulty';
import { difficultyOf } from '../../game/encounters/engine';
import { riderBonus } from '../../game/combat/arts';
import type { Encounter } from '../../packs/types';

// A tiny 3-encounter pack, mirroring pack.json's shape at the fields the merge touches.
function toyPack() {
  return {
    meta: { id: 'toy' },
    encounters: [
      { id: 'e-ember', kind: 'mcq', prompt: 'a' },
      { id: 'e-lantern', kind: 'match', prompt: 'b' },
      { id: 'e-beacon', kind: 'free_recall', prompt: 'c' },
    ],
  };
}

function sidecar(entries: Record<string, number>): DifficultyProvenance {
  const encounters: DifficultyProvenance['encounters'] = {};
  for (const [id, difficulty] of Object.entries(entries)) {
    encounters[id] = {
      difficulty: difficulty as 1 | 2 | 3,
      rationale: 'test',
      source: 'llm',
      model: 'test-model',
      date: '2026-08-01',
    };
  }
  return { pack: 'toy', encounters };
}

describe('applyDifficultySidecar (pure merge)', () => {
  it('applies every tier and flips difficultyClassified true at full coverage', () => {
    const pack = toyPack();
    applyDifficultySidecar(pack, sidecar({ 'e-ember': 1, 'e-lantern': 2, 'e-beacon': 3 }));
    expect(pack.encounters.map((e) => (e as { difficulty?: number }).difficulty)).toEqual([1, 2, 3]);
    expect(pack.meta.difficultyClassified).toBe(true);
  });

  it('applies present entries but leaves the flag falsy under partial coverage (rider dormant)', () => {
    const pack = toyPack();
    applyDifficultySidecar(pack, sidecar({ 'e-ember': 1, 'e-lantern': 2 })); // e-beacon missing
    const diffs = pack.encounters.map((e) => (e as { difficulty?: number }).difficulty);
    expect(diffs).toEqual([1, 2, undefined]);
    expect(pack.meta.difficultyClassified).toBeUndefined();
  });

  it('is a no-op for an absent/null sidecar — pack stays unmarked (all → Lantern 2)', () => {
    const pack = toyPack();
    applyDifficultySidecar(pack, null);
    expect(pack.encounters.every((e) => (e as { difficulty?: number }).difficulty === undefined)).toBe(true);
    expect(pack.meta.difficultyClassified).toBeUndefined();
  });

  it('ignores out-of-range tiers and treats them as uncovered (no flag)', () => {
    const pack = toyPack();
    const s = sidecar({ 'e-ember': 1, 'e-lantern': 2, 'e-beacon': 3 });
    (s.encounters['e-beacon'] as { difficulty: number }).difficulty = 4; // invalid
    applyDifficultySidecar(pack, s);
    const diffs = pack.encounters.map((e) => (e as { difficulty?: number }).difficulty);
    expect(diffs).toEqual([1, 2, undefined]);
    expect(pack.meta.difficultyClassified).toBeUndefined();
  });

  it('ignores stale sidecar ids not present in the pack', () => {
    const pack = toyPack();
    applyDifficultySidecar(
      pack,
      sidecar({ 'e-ember': 1, 'e-lantern': 2, 'e-beacon': 3, 'e-ghost': 3 }),
    );
    expect(pack.meta.difficultyClassified).toBe(true);
    expect(pack.encounters).toHaveLength(3);
  });

  it('does not flag an empty pack as classified', () => {
    const pack = { meta: { id: 'empty' }, encounters: [] as Array<{ id: string }> };
    applyDifficultySidecar(pack, { pack: 'empty', encounters: {} });
    expect((pack.meta as { difficultyClassified?: boolean }).difficultyClassified).toBeUndefined();
  });
});

describe('listPacks difficulty-sidecar integration (disk)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-diff-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writePack(dir: string): void {
    fs.mkdirSync(path.join(dir, 'toy'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'toy', 'pack.json'), JSON.stringify(toyPack()));
  }

  it('folds a full sidecar into the loaded pack and sets difficultyClassified', () => {
    const dir = path.join(tmp, 'packs');
    writePack(dir);
    fs.writeFileSync(
      path.join(dir, 'toy', DIFFICULTY_SIDECAR_FILE),
      JSON.stringify(sidecar({ 'e-ember': 1, 'e-lantern': 2, 'e-beacon': 3 })),
    );
    const [entry] = listPacks(dir);
    const pack = entry.pack as { meta: { difficultyClassified?: boolean }; encounters: Array<{ difficulty?: number }> };
    expect(pack.encounters.map((e) => e.difficulty)).toEqual([1, 2, 3]);
    expect(pack.meta.difficultyClassified).toBe(true);
  });

  it('leaves the pack unmarked when no sidecar is present (rider dormant)', () => {
    const dir = path.join(tmp, 'packs');
    writePack(dir);
    const [entry] = listPacks(dir);
    const pack = entry.pack as { meta: { difficultyClassified?: boolean }; encounters: Array<{ difficulty?: number }> };
    expect(pack.encounters.every((e) => e.difficulty === undefined)).toBe(true);
    expect(pack.meta.difficultyClassified).toBeUndefined();
  });

  it('degrades to unmarked when the sidecar is malformed JSON', () => {
    const dir = path.join(tmp, 'packs');
    writePack(dir);
    fs.writeFileSync(path.join(dir, 'toy', DIFFICULTY_SIDECAR_FILE), '{ not json');
    const [entry] = listPacks(dir);
    const pack = entry.pack as { meta: { difficultyClassified?: boolean }; encounters: Array<{ difficulty?: number }> };
    expect(pack.encounters.every((e) => e.difficulty === undefined)).toBe(true);
    expect(pack.meta.difficultyClassified).toBeUndefined();
  });
});

// The whole point of P3: classifying the pack is what lights the reward rider. This ties the
// loader merge (bridge) to the gate (arts.riderBonus) through difficultyOf (engine) end-to-end —
// GREEN only because the sidecar merge flips the flag and stamps the tiers; without it (the
// unclassified branch below) the rider is zero everywhere.
describe('rider gate lit by the loader merge (non-dormant iff classified)', () => {
  const asEncounter = (e: unknown) => e as Encounter;

  it('a classified pack lights the rider on a T1 q1 punch-up into a harder draw', () => {
    const pack = toyPack();
    applyDifficultySidecar(pack, sidecar({ 'e-ember': 1, 'e-lantern': 2, 'e-beacon': 3 }));
    const packReady = pack.meta.difficultyClassified ?? false;
    expect(packReady).toBe(true);
    const byId = (id: string) => asEncounter(pack.encounters.find((e) => e.id === id));
    // T1 (Smite, tier 1) drawing Beacon(3) or Lantern(2) at q1 → +1 rider fires
    expect(riderBonus(1, difficultyOf(byId('e-beacon')), packReady)).toBe(1);
    expect(riderBonus(1, difficultyOf(byId('e-lantern')), packReady)).toBe(1);
    // T1 drawing its own Ember(1) — no punch-up (not harder than the tier)
    expect(riderBonus(1, difficultyOf(byId('e-ember')), packReady)).toBe(0);
    // T3 can never earn the rider — nothing exceeds Beacon (§5)
    expect(riderBonus(3, difficultyOf(byId('e-beacon')), packReady)).toBe(0);
  });

  it('stays fully dormant on the SAME pack when unclassified (no sidecar)', () => {
    const pack = toyPack(); // no merge → unmarked, flag absent
    const packReady = pack.meta.difficultyClassified ?? false;
    expect(packReady).toBe(false);
    for (const e of pack.encounters) {
      expect(difficultyOf(asEncounter(e))).toBe(2); // unmarked → Lantern
      expect(riderBonus(1, difficultyOf(asEncounter(e)), packReady)).toBe(0); // rider zero everywhere
    }
  });
});
