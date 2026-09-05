import { describe, it, expect } from 'vitest';
import { nextBeatFor, bossVaultOpened, GRANDFATHERED_BOSS_ROOM, BEAT_AFTER_EFFECTS } from './beats';
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

describe('«Onward» T2 — road, Span and Return surfaces', () => {
  const ROAD = 'arc01-road';
  const IV = 'onward-01.first-waystone';
  const V = 'onward-01.the-middles';
  const VI = 'onward-01.hollis-promise';
  const VII = 'onward-01.the-span';
  const VIII = 'onward-01.the-return';
  const afterT1 = ['onward-01.dark-answers', 'onward-01.barred-road', 'onward-01.fable-waywright'];

  it('road-entry fires the first waystone on the road, and never off it', () => {
    expect(nextBeatFor('road-entry', seenOf(...afterT1), save([]), { specId: ROAD, roomId: 'ws-1' })?.id).toBe(IV);
    expect(nextBeatFor('road-entry', seenOf(...afterT1), save([]), { specId: 'some-other-spec', roomId: 'ws-1' })).toBeNull();
    expect(nextBeatFor('road-entry', seenOf(...afterT1), save([])), 'no context at all is silent, never a throw').toBeNull();
  });

  it('the middles wait for the second stone, and Hollis for the third', () => {
    const ctx = { specId: ROAD, roomId: 'mid-2' };
    expect(nextBeatFor('road-entry', seenOf(...afterT1, IV), save([]), ctx), 'ws-2 not cleared yet').toBeNull();
    expect(nextBeatFor('road-entry', seenOf(...afterT1, IV), save(['ws-1', 'ws-2']), ctx)?.id).toBe(V);
    expect(nextBeatFor('road-entry', seenOf(...afterT1, IV, V), save(['ws-1', 'ws-2']), ctx), 'ws-3 not cleared yet').toBeNull();
    expect(
      nextBeatFor('road-entry', seenOf(...afterT1, IV, V), save(['ws-1', 'ws-2', 'ws-3']), { specId: ROAD, roomId: 'span' })?.id,
    ).toBe(VI);
  });

  it('boss-victory fires the Span only for the Span, and only once', () => {
    const seen = seenOf(...afterT1, IV, V, VI);
    expect(nextBeatFor('boss-victory', seen, save([]), { specId: ROAD, roomId: 'span' })?.id).toBe(VII);
    expect(nextBeatFor('boss-victory', seen, save([]), { specId: ROAD, roomId: 'ws-1' })).toBeNull();
    expect(nextBeatFor('boss-victory', seen, save([]), { specId: 'vc-law', roomId: 'room.warden' })).toBeNull();
    expect(nextBeatFor('boss-victory', seenOf(...afterT1, IV, V, VI, VII), save([]), { specId: ROAD, roomId: 'span' })).toBeNull();
  });

  it('return fires at the hamlet only after the Span, and only once', () => {
    expect(nextBeatFor('return', seenOf(...afterT1, IV, V, VI), save([]))).toBeNull();
    expect(nextBeatFor('return', seenOf(...afterT1, IV, V, VI, VII), save([]))?.id).toBe(VIII);
    expect(nextBeatFor('return', seenOf(...afterT1, IV, V, VI, VII, VIII), save([]))).toBeNull();
  });

  it('the T1 surfaces are untouched by the new rows', () => {
    const opened = save([GRANDFATHERED_BOSS_ROOM]);
    expect(nextBeatFor('hamlet-entry', seenNone, opened)?.id).toBe('onward-01.dark-answers');
    expect(nextBeatFor('tavern', seenOf('onward-01.dark-answers', 'onward-01.barred-road'), opened)?.id).toBe(
      'onward-01.fable-waywright',
    );
  });

  it('the Span grants the thread fragment and the Return closes the arc', () => {
    expect(BEAT_AFTER_EFFECTS[VII]).toEqual({ grantFragment: 'frag.name.01-span-ledger' });
    expect(BEAT_AFTER_EFFECTS[VIII]).toEqual({ completeArc: 'onward-01' });
    expect(Object.keys(BEAT_AFTER_EFFECTS).sort()).toEqual([VII, VIII].sort());
  });
});
