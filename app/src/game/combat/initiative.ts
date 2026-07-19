/**
 * Initiative order: a single speed-sorted queue mixing party and enemies
 * (BG3-style interleave). Higher speed first; ties → party before enemy, then
 * stable by spawn order. Pure.
 */
import type { UnitState } from './types';

export function buildInitiative(units: UnitState[]): string[] {
  return units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => {
      if (b.u.speed !== a.u.speed) return b.u.speed - a.u.speed;
      const at = a.u.team === 'party' ? 0 : 1;
      const bt = b.u.team === 'party' ? 0 : 1;
      if (at !== bt) return at - bt;
      return a.i - b.i;
    })
    .map((x) => x.u.id);
}

/**
 * Advance to the next living unit in the order, wrapping rounds. Returns the
 * next unit id and whether a new round started, or null if nobody is alive.
 */
export function nextInOrder(
  order: string[],
  fromIndex: number,
  alive: (id: string) => boolean,
): { id: string; index: number; newRound: boolean } | null {
  if (!order.some(alive)) return null;
  let idx = fromIndex;
  let newRound = false;
  for (let step = 0; step < order.length; step++) {
    idx = idx + 1;
    if (idx >= order.length) { idx -= order.length; newRound = true; }
    if (alive(order[idx])) return { id: order[idx], index: idx, newRound };
  }
  return null;
}
