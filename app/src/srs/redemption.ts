/**
 * The "Reclaimed from the Fade" redemption rule (fun-review.md §3.1) — PURE, no I/O.
 *
 * A fact is RECLAIMED when it records a full pass (quality 1) while carrying an UNCLEARED
 * miss: its prior history holds a miss (quality 0) with no full pass (quality 1) recorded
 * after that miss. Partials (0.5) neither trigger the bell nor clear a pending miss. The
 * passing answer becomes the new watermark, so the bell self-retires — it only re-arms on a
 * later miss. All state lives in the passed-in history, so this is deterministic and testable
 * against the spec table in redemption.test.ts.
 */
import type { Quality } from '../game/contracts';

/** Does a `now`-quality answer redeem a fact whose PRIOR answer qualities were `prior`? */
export function isRedemption(prior: readonly Quality[], now: Quality): boolean {
  if (now !== 1) return false;
  let pendingMiss = false;
  for (const q of prior) {
    if (q === 0) pendingMiss = true;
    else if (q === 1) pendingMiss = false;
    // 0.5 leaves the watermark untouched — it neither arms nor clears a pending miss
  }
  return pendingMiss;
}

/**
 * The first factId among `factIds` that `isRedemption` fires for on a `now`-quality answer,
 * or null if none. `priorHistoryOf` returns a fact's PRIOR answer qualities — the caller MUST
 * read it BEFORE recording this answer (store.record appends immediately), the same
 * capture-before-record discipline dueRenewalSurge / weldBonus already follow. Deterministic:
 * returns the earliest qualifying id in the given order, so the bell's Clerk-line hash is stable.
 */
export function reclaimedFactId(
  factIds: readonly string[],
  now: Quality,
  priorHistoryOf: (id: string) => readonly Quality[],
): string | null {
  if (now !== 1) return null;
  for (const id of factIds) {
    if (isRedemption(priorHistoryOf(id), now)) return id;
  }
  return null;
}
