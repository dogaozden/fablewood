import { describe, it, expect } from 'vitest';
import { nextBeatFor, bossVaultOpened, GRANDFATHERED_BOSS_ROOM } from './beats';
import type { SaveData } from '../game/contracts';

const seenNone = { isSeen: () => false };
const seenOf = (...ids: string[]) => ({ isSeen: (id: string) => ids.includes(id) });
const save = (cleared: string[]): SaveData =>
  ({ scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', dungeon: { roomIndex: 0, cleared } }) as SaveData;

describe('bossVaultOpened', () => {
  it('true only when the grandfathered boss room is cleared', () => {
    expect(bossVaultOpened(save([GRANDFATHERED_BOSS_ROOM]))).toBe(true);
    expect(bossVaultOpened(save(['room.threshold']))).toBe(false);
    expect(bossVaultOpened({ scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } as SaveData)).toBe(false);
  });
});

describe('nextBeatFor', () => {
  it('hamlet-entry fires the hook once the vault is opened, then never again', () => {
    const opened = save([GRANDFATHERED_BOSS_ROOM]);
    expect(nextBeatFor('hamlet-entry', seenNone, opened)?.id).toBe('onward-01.dark-answers');
    expect(nextBeatFor('hamlet-entry', seenOf('onward-01.dark-answers'), opened)).toBeNull();
  });

  it('hamlet-entry stays silent on a fresh save (no vault opened)', () => {
    expect(nextBeatFor('hamlet-entry', seenNone, save([]))).toBeNull();
  });

  it('south-gate fires the barred road only AFTER the hook was seen', () => {
    const opened = save([GRANDFATHERED_BOSS_ROOM]);
    expect(nextBeatFor('south-gate', seenNone, opened)).toBeNull();
    expect(nextBeatFor('south-gate', seenOf('onward-01.dark-answers'), opened)?.id).toBe('onward-01.barred-road');
    expect(
      nextBeatFor('south-gate', seenOf('onward-01.dark-answers', 'onward-01.barred-road'), opened),
    ).toBeNull();
  });

  it('tavern fires the fable only after the barred road', () => {
    const opened = save([GRANDFATHERED_BOSS_ROOM]);
    expect(nextBeatFor('tavern', seenOf('onward-01.dark-answers'), opened)).toBeNull();
    expect(
      nextBeatFor('tavern', seenOf('onward-01.dark-answers', 'onward-01.barred-road'), opened)?.id,
    ).toBe('onward-01.fable-waywright');
  });

  it('every T1 beat carries card pages (no empty prose ever ships)', () => {
    const opened = save([GRANDFATHERED_BOSS_ROOM]);
    for (const [surface, seen] of [
      ['hamlet-entry', seenNone],
      ['south-gate', seenOf('onward-01.dark-answers')],
      ['tavern', seenOf('onward-01.dark-answers', 'onward-01.barred-road')],
    ] as const) {
      const b = nextBeatFor(surface, seen, opened);
      expect(b, surface).not.toBeNull();
      expect(b!.pages.length).toBeGreaterThan(0);
      for (const p of b!.pages) expect(p.length).toBeGreaterThan(40);
    }
  });
});
