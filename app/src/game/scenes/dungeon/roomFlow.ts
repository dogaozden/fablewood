/**
 * Pure room-progression state machine for the dungeon node-crawl. No Phaser here
 * so it runs under the node vitest env (slice-blueprint §4). The scene owns
 * presentation; this owns "which node is where in the crawl".
 */
import type { DungeonRoom } from '../../contracts';

export interface DungeonProgress {
  /** index of the first uncleared room — the node the crawl is "at" */
  roomIndex: number;
  /** ids of rooms fully cleared (combat won + any gate opened) */
  cleared: string[];
  /**
   * Id of the room whose combat is won but whose gate has NOT opened yet. Such a room is
   * deliberately not in `cleared` — an unopened ward is not a passed vault — but re-entry
   * must not re-litigate the fight either (Fable_SPEC.md:31 — a wipe costs the loot roll,
   * never story progress). At most one at a time: the crawl only stands before one ward.
   */
  gatePending?: string;
}

export type NodeState = 'cleared' | 'current' | 'locked';

export function isRoomCleared(room: DungeonRoom, cleared: readonly string[]): boolean {
  return cleared.includes(room.id);
}

/** Lowest index whose room is not yet cleared; rooms.length once all are done. */
export function firstUnclearedIndex(
  rooms: readonly DungeonRoom[],
  cleared: readonly string[],
): number {
  for (let i = 0; i < rooms.length; i++) {
    if (!cleared.includes(rooms[i].id)) return i;
  }
  return rooms.length;
}

/** cleared ✓ · current (the one lit node you may enter) · locked (sealed ahead). */
export function nodeState(
  index: number,
  rooms: readonly DungeonRoom[],
  cleared: readonly string[],
): NodeState {
  if (index < 0 || index >= rooms.length) {
    throw new RangeError(`room index ${index} out of range (0..${rooms.length - 1})`);
  }
  if (cleared.includes(rooms[index].id)) return 'cleared';
  if (index === firstUnclearedIndex(rooms, cleared)) return 'current';
  return 'locked';
}

/** Cleared nodes are revisitable (lore) and the current node is playable; locked is not. */
export function isReachable(
  index: number,
  rooms: readonly DungeonRoom[],
  cleared: readonly string[],
): boolean {
  const state = nodeState(index, rooms, cleared);
  return state === 'cleared' || state === 'current';
}

/** Immutably mark a room cleared and advance roomIndex to the next uncleared node. */
export function markRoomCleared(
  progress: DungeonProgress,
  roomId: string,
  rooms: readonly DungeonRoom[],
): DungeonProgress {
  const cleared = progress.cleared.includes(roomId)
    ? progress.cleared
    : [...progress.cleared, roomId];
  return {
    cleared,
    roomIndex: firstUnclearedIndex(rooms, cleared),
    // clearing a room settles its own ward; any other room's stays pending
    gatePending: progress.gatePending === roomId ? undefined : progress.gatePending,
  };
}

/** Immutably record "combat won here, ward still shut" (see DungeonProgress.gatePending). */
export function markGatePending(progress: DungeonProgress, roomId: string): DungeonProgress {
  return { ...progress, gatePending: roomId };
}

export function allCleared(rooms: readonly DungeonRoom[], cleared: readonly string[]): boolean {
  return firstUnclearedIndex(rooms, cleared) >= rooms.length;
}
