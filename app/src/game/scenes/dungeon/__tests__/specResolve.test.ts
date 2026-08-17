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
} from '../specResolve';
import type { DungeonSpec } from '../../../contracts';

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
