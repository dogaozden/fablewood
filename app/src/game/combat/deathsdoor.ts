// deathsdoor.ts — Death's Door ("The Ledger Holds Your Line"), Concordance Ch. I.
// Pure state machine: no Phaser, no services. CombatScene drives it (Task 4).
export const SUCCESS_NEED = 3;
export const FAIL_LIMIT = 3;
// Box >= 4 is the codebase's established "welded" mastery threshold — keep in lockstep with weld logic.
export const REVIVE_BOX = 4;

export interface DeathsDoorState { successes: number; failures: number; revivedUsed: boolean; }
export type DeathsDoorEvent = 'hold' | 'stabilized' | 'wiped' | 'revived';

export function enterDoor(revivedUsed: boolean): DeathsDoorState {
  return { successes: 0, failures: 0, revivedUsed };
}

export function recordAnswer(
  s: DeathsDoorState,
  a: { quality: number; box: number },
): { next: DeathsDoorState; event: DeathsDoorEvent } {
  const correct = a.quality === 1; // DD-KNOB-1: partials fail at the door
  if (correct && a.box >= REVIVE_BOX && !s.revivedUsed) {
    return { next: { ...s, revivedUsed: true }, event: 'revived' };
  }
  const next = correct
    ? { ...s, successes: s.successes + 1 }
    : { ...s, failures: s.failures + 1 };
  if (next.successes >= SUCCESS_NEED) return { next, event: 'stabilized' };
  if (next.failures >= FAIL_LIMIT) return { next, event: 'wiped' };
  return { next, event: 'hold' };
}
