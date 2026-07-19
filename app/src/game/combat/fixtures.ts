/**
 * DEV FIXTURE for standalone combat (harness boot with no CombatLaunch payload).
 * Fantasy-generic ONLY — the engine/content split is law, so no legal-domain
 * strings ever live here. Real battles arrive via CombatLaunch from the dungeon.
 */
import type { CombatLaunch, DungeonRoom, BossSpec } from '../contracts';

/** Six local "mosslore" facts so the due-queue path and SRS recording work with zero packs. */
export const FIXTURE_PACK_ID = 'dev-mosslore';

export const FIXTURE_FACTS: string[] = [
  'moss-verdant-law',
  'moss-lantern-oath',
  'moss-fade-tide',
  'moss-warden-terms',
  'moss-ledger-seal',
  'moss-glow-grace',
];

const FIXTURE_BOSS: BossSpec = {
  name: 'The Vault-Warden',
  shields: 3,
  phases: [
    { branchEncounterId: 'dev-boss-phase-1', recallTags: ['moss-warden-terms'] },
    { branchEncounterId: 'dev-boss-phase-2', recallTags: ['moss-ledger-seal'] },
    { branchEncounterId: 'dev-boss-phase-3', recallTags: ['moss-verdant-law'] },
  ],
};

export function fixtureRoom(boss: boolean): DungeonRoom {
  if (boss) {
    return {
      id: 'dev-wardens-vault',
      name: "The Warden's Vault",
      blurb: 'A dev fixture — the Warden guards the seal.',
      enemies: [{ archetype: 'wisp', tags: ['moss-fade-tide'], kinds: ['mcq'] }],
      boss: FIXTURE_BOSS,
    };
  }
  return {
    id: 'dev-antechamber',
    name: 'The Mossy Antechamber',
    blurb: 'A dev fixture room — two wisps and a wraith.',
    enemies: [
      { archetype: 'wisp', tags: ['moss-fade-tide'], kinds: ['mcq'], parley: true },
      { archetype: 'wisp', tags: ['moss-lantern-oath'], kinds: ['mcq'] },
      { archetype: 'wraith', tags: ['moss-glow-grace'], kinds: ['match'] },
    ],
  };
}

export function fixtureLaunch(seed: number, boss: boolean): CombatLaunch {
  return { packId: FIXTURE_PACK_ID, room: fixtureRoom(boss), seed, returnScene: 'boot' };
}
