import { describe, it, expect } from 'vitest';
import type { DungeonRoom } from '../../../contracts';
import {
  firstUnclearedIndex,
  nodeState,
  isReachable,
  markRoomCleared,
  allCleared,
  type DungeonProgress,
} from '../roomFlow';

const room = (id: string): DungeonRoom => ({ id, name: id, enemies: [] });
const rooms = [room('r1'), room('r2'), room('r3'), room('boss')];

describe('firstUnclearedIndex', () => {
  it('is 0 with nothing cleared', () => {
    expect(firstUnclearedIndex(rooms, [])).toBe(0);
  });
  it('skips cleared rooms in order', () => {
    expect(firstUnclearedIndex(rooms, ['r1', 'r2'])).toBe(2);
  });
  it('returns rooms.length when all cleared', () => {
    expect(firstUnclearedIndex(rooms, ['r1', 'r2', 'r3', 'boss'])).toBe(4);
  });
  it('ignores clear order — the first gap wins', () => {
    // r2 cleared out of order: r1 is still the first uncleared node
    expect(firstUnclearedIndex(rooms, ['r2'])).toBe(0);
  });
});

describe('nodeState', () => {
  it('marks cleared / current / locked', () => {
    const cleared = ['r1'];
    expect(nodeState(0, rooms, cleared)).toBe('cleared');
    expect(nodeState(1, rooms, cleared)).toBe('current');
    expect(nodeState(2, rooms, cleared)).toBe('locked');
    expect(nodeState(3, rooms, cleared)).toBe('locked');
  });
  it('throws on out-of-range index', () => {
    expect(() => nodeState(9, rooms, [])).toThrow(RangeError);
  });
});

describe('isReachable', () => {
  it('current and cleared are reachable, locked is not', () => {
    const cleared = ['r1'];
    expect(isReachable(0, rooms, cleared)).toBe(true); // cleared → revisit
    expect(isReachable(1, rooms, cleared)).toBe(true); // current → play
    expect(isReachable(2, rooms, cleared)).toBe(false); // locked
  });
});

describe('markRoomCleared', () => {
  it('adds the room and advances roomIndex', () => {
    const p0: DungeonProgress = { roomIndex: 0, cleared: [] };
    const p1 = markRoomCleared(p0, 'r1', rooms);
    expect(p1.cleared).toEqual(['r1']);
    expect(p1.roomIndex).toBe(1);
  });
  it('is idempotent and does not mutate the input', () => {
    const p0: DungeonProgress = { roomIndex: 1, cleared: ['r1'] };
    const p1 = markRoomCleared(p0, 'r1', rooms);
    expect(p1.cleared).toEqual(['r1']);
    expect(p0.cleared).toEqual(['r1']); // unchanged
  });
  it('drives to allCleared after the last room', () => {
    let p: DungeonProgress = { roomIndex: 0, cleared: [] };
    for (const r of rooms) p = markRoomCleared(p, r.id, rooms);
    expect(allCleared(rooms, p.cleared)).toBe(true);
    expect(p.roomIndex).toBe(rooms.length);
  });
});
