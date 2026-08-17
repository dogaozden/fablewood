import type { EncounterResult } from '../contracts';

/** Ch. IV Lantern-light — the overlay affordance's decision slice, DOM-free by design:
 *  vitest runs under `node` here (see inventory/ui/dom.test.ts's precedent), so
 *  overlay.ts owns the wiring and this module owns the rules. */

/** The sentinel a raise resolves to INSTEAD of an answer: nothing was judged, nothing may
 *  be recorded/granted — factIds [] and quality 0 keep a non-branching caller inert. */
export function redrawSentinel(enc: {
  id: string;
  kind: EncounterResult['kind'];
  fact_ids: string[];
}): EncounterResult {
  return {
    encounterId: enc.id,
    kind: enc.kind,
    factIds: [],
    quality: 0,
    redraw: { shownFactIds: enc.fact_ids },
  };
}

/** The keys that COMMIT an answer right now, for whichever kind is currently rendering —
 *  published by the renderer (kinds.ts) through the overlay (see Overlay.setLiveCommitKeys in
 *  overlay.ts), consulted by isCommitKey below. A plain set of key strings: the consumer stays
 *  kind-agnostic, same spirit as isCommitTarget's data-commit attribute for clicks. */
export type CommitKeySet = ReadonlySet<string>;

/** True for a key gesture that COMMITS an answer for the CURRENTLY RENDERED kind — `live`
 *  names exactly which keys do that right now (mcq's live digits minus any struck option,
 *  Enter only where a kind actually binds it to submit/select — see kinds.ts). Replaces the
 *  old blanket "any digit, or Enter" test, which disarmed the lantern on dead keys: a
 *  Scrivener's-Hint-struck MCQ digit commits nothing, yet used to cost the raise anyway (W8
 *  lantern ticket). Committing disarms the lantern — a submitted answer must never be
 *  dodgeable mid-judge. */
export function isCommitKey(key: string, live: CommitKeySet): boolean {
  return live.has(key);
}

/** True for a click target that COMMITS an answer (kinds.ts marks those buttons
 *  `data-commit="true"`) — never for an intermediate control (match's chips, order's ▲▼
 *  nudges) and never for the raise button itself. Committing disarms the lantern — a click
 *  that only rearranges the encounter's WIP state must leave the raise alive. */
export function isCommitTarget(el: { closest(sel: string): unknown }): boolean {
  return Boolean(el.closest('[data-commit]')) && !el.closest('.fw-lantern');
}

/** One gate per presentation. settle() is the single-resolution latch for EVERY finish
 *  path (answer, ESC-abort, lantern); disarm()/mayRaise() govern the lantern only. */
export interface LanternGate {
  mayRaise(): boolean;
  disarm(): void;
  /** True exactly once — only that caller may close/resolve. */
  settle(): boolean;
}

export function createLanternGate(): LanternGate {
  let disarmed = false;
  let settled = false;
  return {
    mayRaise: () => !disarmed && !settled,
    disarm: () => {
      disarmed = true;
    },
    settle: () => {
      if (settled) return false;
      settled = true;
      return true;
    },
  };
}
