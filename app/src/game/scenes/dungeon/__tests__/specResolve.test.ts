import { describe, it, expect } from 'vitest';
import type { Pack, Quest } from '../../../../packs/types';
import {
  slugify,
  stripLeadingArticle,
  candidateDungeonFiles,
  bossQuest,
  rewardText,
  rewardXp,
  isDungeonSpec,
  unknownArchetypes,
  archetypeError,
  unknownRelicIds,
  relicError,
  bossRelicId,
} from '../specResolve';
import type { DungeonSpec, DungeonRoom } from '../../../contracts';
import devDungeon from '../__fixtures__/dev.dungeon.json';

const quest = (id: string, title: string, region: string, reward?: Quest['reward']): Quest => ({
  id,
  title,
  region,
  encounter_ids: [],
  reward,
});

const vcLaw: Pack = {
  meta: { id: 'vc-law', title: 'The Venture Coast', version: '1', sources: [] },
  facts: [],
  encounters: [],
  quests: [
    quest('q.vaults.threshold', 'The Threshold Ledger', 'The Preference Vaults', {
      xp: 120,
      item: 'lens-of-pre-and-post',
    }),
    quest('q.vaults.warden', "The Vault-Warden's Term Sheet", 'The Preference Vaults', {
      xp: 500,
      item: 'warden-signet-of-terms',
    }),
  ],
  metaphor_map: {},
};

describe('slug helpers', () => {
  it('slugifies a region label', () => {
    expect(slugify('The Preference Vaults')).toBe('the-preference-vaults');
    expect(slugify('The Root-Heart Hollow!')).toBe('the-root-heart-hollow');
  });
  it('strips a leading article', () => {
    expect(stripLeadingArticle('the-preference-vaults')).toBe('preference-vaults');
    expect(stripLeadingArticle('preference-vaults')).toBe('preference-vaults');
  });
});

describe('candidateDungeonFiles', () => {
  it('prefers the blueprint-canonical article-stripped name, then falls back', () => {
    expect(candidateDungeonFiles(vcLaw)).toEqual([
      'preference-vaults.dungeon.json',
      'the-preference-vaults.dungeon.json',
      'vc-law.dungeon.json',
    ]);
  });
  it('returns just the pack-id file when there are no quests', () => {
    expect(candidateDungeonFiles({ ...vcLaw, quests: [] })).toEqual(['vc-law.dungeon.json']);
  });
});

describe('bossQuest', () => {
  it('picks the Warden quest by name', () => {
    expect(bossQuest(vcLaw)?.id).toBe('q.vaults.warden');
  });
  it('falls back to the last quest when nothing matches', () => {
    const noWarden: Pack = {
      ...vcLaw,
      quests: [quest('q.a', 'Alpha', 'R'), quest('q.b', 'Beta', 'R')],
    };
    expect(bossQuest(noWarden)?.id).toBe('q.b');
  });
});

describe('rewardText', () => {
  it('formats {xp,item} rewards', () => {
    expect(rewardText(bossQuest(vcLaw))).toBe('Warden Signet Of Terms (+500 XP)');
  });
  it('passes strings through and handles missing rewards', () => {
    expect(rewardText(quest('q', 't', 'r', 'a shard of moonlit glass'))).toBe(
      'a shard of moonlit glass',
    );
    expect(rewardText(quest('q', 't', 'r'))).toBeNull();
    expect(rewardText(undefined)).toBeNull();
  });
});

describe('rewardXp (Task 5 — the numeric half of the same reward rewardText formats)', () => {
  it('reads the xp component of an {xp,item} reward', () => {
    expect(rewardXp(bossQuest(vcLaw))).toBe(500);
  });
  it('is undefined for a string reward, a missing xp field, or no quest at all', () => {
    expect(rewardXp(quest('q', 't', 'r', 'a shard of moonlit glass'))).toBeUndefined();
    expect(rewardXp(quest('q', 't', 'r', { item: 'lens-of-pre-and-post' }))).toBeUndefined();
    expect(rewardXp(quest('q', 't', 'r'))).toBeUndefined();
    expect(rewardXp(undefined)).toBeUndefined();
  });
});

describe('isDungeonSpec', () => {
  it('accepts a minimal well-formed spec', () => {
    expect(
      isDungeonSpec({
        id: 'x',
        name: 'X',
        rooms: [{ id: 'r1', name: 'One', enemies: [] }],
      }),
    ).toBe(true);
  });
  it('rejects malformed specs', () => {
    expect(isDungeonSpec(null)).toBe(false);
    expect(isDungeonSpec({ id: 'x', name: 'X', rooms: [] })).toBe(false);
    expect(isDungeonSpec({ id: 'x', name: 'X' })).toBe(false);
    expect(isDungeonSpec({ id: 'x', name: 'X', rooms: [{ id: 'r1' }] })).toBe(false);
  });
});

// Ch. VIII — archetype-id validation. The gap the seam scout named: a typo'd archetype passes
// isDungeonSpec's shape check (it only asks that `enemies` be an array), reaches makeEnemy,
// indexes ENEMY_STATS to `undefined`, and crashes on `s.hp` at COMBAT LAUNCH — rooms away from
// the load that carried it. These two functions move the failure to load time and name it.
describe('archetype validation (Ch. VIII)', () => {
  const spec = (archetypes: string[], roomId = 'r1'): DungeonSpec =>
    ({
      id: 'd', name: 'D',
      rooms: [{ id: roomId, name: 'Room', enemies: archetypes.map((a) => ({ archetype: a })) }],
    } as unknown as DungeonSpec);

  it('accepts every archetype the engine knows, the three newcomers included', () => {
    const all = spec(['wisp', 'wraith', 'construct', 'warden', 'lurker', 'husk', 'pall']);
    expect(unknownArchetypes(all)).toEqual([]);
    expect(archetypeError(all, 'vc-law')).toBeNull();
  });

  it('collects unknown ids, de-duplicated in first-seen order, across every room', () => {
    const bad = {
      id: 'd', name: 'D',
      rooms: [
        { id: 'r1', name: 'One', enemies: [{ archetype: 'lurkr' }, { archetype: 'wisp' }] },
        { id: 'r2', name: 'Two', enemies: [{ archetype: 'grue' }, { archetype: 'lurkr' }] },
      ],
    } as unknown as DungeonSpec;
    expect(unknownArchetypes(bad)).toEqual(['lurkr', 'grue']);
  });

  it('names the bad id, its room, and the legal set in the load-time error', () => {
    const msg = archetypeError(spec(['lurkr'], 'under-1'), 'vc-law');
    expect(msg).not.toBeNull();
    expect(msg).toContain('"lurkr"');
    expect(msg).toContain('vc-law');
    expect(msg).toContain('under-1');
    // tells an author what they MAY write, not only what they may not
    expect(msg).toContain('lurker');
    expect(msg).toContain('husk');
    expect(msg).toContain('pall');
  });

  // Ch. VIII fix round 1 (M1) — the fixture map now runs through the same gate a pack's map does
  // (DungeonScene.useFixture). This pins the in-repo map itself as buildable: it is the one map
  // every ?dev=1 run and a dozen e2e specs actually walk, so a typo here would fail far from its
  // cause. Guards the assertion too — a validator that silently accepted everything would pass
  // this line for the wrong reason, so the negative case above is what gives it teeth.
  it('the shipped dev fixture names only archetypes the engine can build', () => {
    expect(unknownArchetypes(devDungeon as unknown as DungeonSpec)).toEqual([]);
    expect(archetypeError(devDungeon as unknown as DungeonSpec, 'dev-fixture')).toBeNull();
  });

  it('tolerates a room with no enemies array and a non-string archetype', () => {
    const odd = {
      id: 'd', name: 'D',
      rooms: [
        { id: 'r1', name: 'One' },
        { id: 'r2', name: 'Two', enemies: [{ archetype: 7 }, null, { }] },
      ],
    } as unknown as DungeonSpec;
    expect(() => unknownArchetypes(odd)).not.toThrow();
    expect(unknownArchetypes(odd)).toEqual(['7']);
  });
});

// Ch. IX (Provenance) — Task 8: "each boss carries its own [relic] — the pack's boss spec
// names a relicId from the engine catalog, the Vault-Warden's falling back to the Signet".
// Same gap shape as archetype validation above: a typo'd relicId passes isDungeonSpec's shape
// check untouched (it never looks at `boss` at all) and store.grant(id) never validates its
// argument either (app/src/inventory/store.ts:171 — any string is happily stacked), so an
// unvalidated typo would otherwise ship silently into a player's Satchel as a nameless,
// icon-less row. These two functions (mirroring unknownArchetypes/archetypeError exactly)
// move that failure to load time and name it.
describe('relic-id validation (Ch. IX Provenance)', () => {
  const bossSpec = (roomId: string, bossExtra: Record<string, unknown> = {}): DungeonSpec =>
    ({
      id: 'd', name: 'D',
      rooms: [
        { id: roomId, name: 'Room', enemies: [], boss: { name: 'B', shields: 3, phases: [], ...bossExtra } },
      ],
    } as unknown as DungeonSpec);

  it("accepts a boss room with no relicId at all — Provenance's own fallback default", () => {
    const s = bossSpec('r1');
    expect(unknownRelicIds(s)).toEqual([]);
    expect(relicError(s, 'vc-law')).toBeNull();
  });

  it('accepts every relic id the catalog knows', () => {
    for (const id of ['warden-signet-of-terms', 'unbroken-clasp', 'waymark-heel', 'margin-lamp', 'second-wick']) {
      const s = bossSpec('r1', { relicId: id });
      expect(unknownRelicIds(s)).toEqual([]);
      expect(relicError(s, 'vc-law')).toBeNull();
    }
  });

  it('rejects a relicId that is not in the catalog at all', () => {
    const s = bossSpec('under-boss', { relicId: 'ring-of-typos' });
    expect(unknownRelicIds(s)).toEqual(['ring-of-typos']);
    const msg = relicError(s, 'vc-law');
    expect(msg).not.toBeNull();
    expect(msg).toContain('"ring-of-typos"');
    expect(msg).toContain('vc-law');
    expect(msg).toContain('under-boss');
    // tells an author what they MAY write, not only what they may not
    expect(msg).toContain('warden-signet-of-terms');
    expect(msg).toContain('unbroken-clasp');
  });

  it('rejects a relicId that IS a real catalog id but the wrong type (a trinket/consumable/tool typo\'d into the boss slot)', () => {
    const s = bossSpec('r1', { relicId: 'embermend-draught' }); // real id, type:'consumable'
    expect(unknownRelicIds(s)).toEqual(['embermend-draught']);
    expect(relicError(s, 'vc-law')).not.toBeNull();
  });

  it('collects unknown relic ids, de-duplicated in first-seen order, across every room', () => {
    const bad = {
      id: 'd', name: 'D',
      rooms: [
        { id: 'r1', name: 'One', enemies: [], boss: { name: 'B1', shields: 3, phases: [], relicId: 'ring-a' } },
        { id: 'r2', name: 'Two', enemies: [], boss: { name: 'B2', shields: 3, phases: [], relicId: 'ring-b' } },
        { id: 'r3', name: 'Three', enemies: [], boss: { name: 'B3', shields: 3, phases: [], relicId: 'ring-a' } },
      ],
    } as unknown as DungeonSpec;
    expect(unknownRelicIds(bad)).toEqual(['ring-a', 'ring-b']);
  });

  it('tolerates a room with no boss at all, and a non-string relicId', () => {
    const odd = {
      id: 'd', name: 'D',
      rooms: [
        { id: 'r1', name: 'One', enemies: [] }, // no boss
        { id: 'r2', name: 'Two', enemies: [], boss: { name: 'B', shields: 3, phases: [], relicId: 7 } },
      ],
    } as unknown as DungeonSpec;
    expect(() => unknownRelicIds(odd)).not.toThrow();
    expect(unknownRelicIds(odd)).toEqual(['7']);
  });

  // Same fix-round-1 discipline as the archetype suite's own dev-fixture pin: the one map that
  // ships IN this repo (every ?dev=1 run, a dozen e2e specs) must itself pass the gate it sets.
  it('the shipped dev fixture names a real catalog relic on its boss room', () => {
    expect(unknownRelicIds(devDungeon as unknown as DungeonSpec)).toEqual([]);
    expect(relicError(devDungeon as unknown as DungeonSpec, 'dev-fixture')).toBeNull();
  });

  // bossRelicId is the typed accessor DungeonScene.bossVictory reads (specResolve.ts) — a
  // defined return is trustworthy with no second catalog lookup at the call site because
  // relicError has already gated the spec by the time any room is played.
  describe('bossRelicId — the typed accessor bossVictory reads', () => {
    it('returns the relicId string when the boss names one', () => {
      const s = bossSpec('r1', { relicId: 'unbroken-clasp' });
      expect(bossRelicId(s.rooms[0])).toBe('unbroken-clasp');
    });
    it('returns undefined when the boss names none', () => {
      expect(bossRelicId(bossSpec('r1').rooms[0])).toBeUndefined();
    });
    it('returns undefined for a room with no boss at all', () => {
      const room = { id: 'r1', name: 'R', enemies: [] } as unknown as DungeonRoom;
      expect(bossRelicId(room)).toBeUndefined();
    });
  });
});
