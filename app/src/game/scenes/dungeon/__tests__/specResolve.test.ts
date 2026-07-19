import { describe, it, expect } from 'vitest';
import type { Pack, Quest } from '../../../../packs/types';
import {
  slugify,
  stripLeadingArticle,
  candidateDungeonFiles,
  bossQuest,
  rewardText,
  isDungeonSpec,
} from '../specResolve';

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
