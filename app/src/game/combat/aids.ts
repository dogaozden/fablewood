/** Ch. VII Mira's Stall — the combat-transient armed-aid state, pure and DOM-free (style
 *  precedent: encounters/lantern-ui.ts). CombatScene/satchel own the wiring; this module
 *  owns the rules: what "armed" means and when an arm fires.
 *
 *  Arming-model laws (Concordance Ch. VII amendment): items deduct ONLY on fire; an unfired
 *  arm dissolves at battle end with the item retained (no refund bookkeeping — nothing was
 *  ever taken); a second arm REPLACES the standing one; one live arm at a time. Ward of Focus
 *  is a passive hamlet-side charm, never armed here (Constraint 4) — it fires at the Vigil
 *  break detection in doCottage, outside this module entirely. */

/** Ward is NOT armable — deliberately excluded from this union (Constraint 4). */
export type AidKind = 'reveal_option' | 'retry_cast';

export interface ArmedAid {
  itemId: string;
  kind: AidKind;
}

/** Arms itemId/kind. Always returns a fresh aid — a standing arm is simply replaced (dissolved,
 *  item retained, no side effects on the old arm), never merged with or checked against. The
 *  prior arm is still taken as a parameter to keep the call site symmetric with aidFires and
 *  explicit about what's being replaced, even though the replace law needs none of its data. */
export function armAid(_current: ArmedAid | null, itemId: string, kind: AidKind): ArmedAid {
  return { itemId, kind };
}

/** Returns the fired aid when `kind` matches the standing arm, else null. Null covers both
 *  "nothing armed" and "armed with a different kind" — in the mismatch case the standing arm
 *  is untouched and stays armed for its own trigger. The caller deducts the item and clears
 *  the arm ONLY when this returns non-null; a null result deducts nothing. */
export function aidFires(current: ArmedAid | null, kind: AidKind): ArmedAid | null {
  return current !== null && current.kind === kind ? current : null;
}
