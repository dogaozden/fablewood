/**
 * Vault-Warden boss logic (slice-blueprint §4). Pure reducers; the scene owns
 * presentation and the phase state machine, calling these to compute effects.
 *
 * Phase rhythm: each phase OPENS with a scenario_branch (the Warden proposes a
 * term) → applyBranch. Between phases the player's Cast From Memory vs the
 * Warden draws from phase.recallTags and a PASS strips an extra shield
 * (damage.resolveAction.extraShield). Shields → 0 = victory; Warden HP → 0 is a
 * fallback victory; party wipe = retreat.
 */
export interface BranchEffect {
  shieldDelta: number;
  partyDelta: number;
  wardenHeal: number;
  stagger: boolean;
  banner: string;
}

export function applyBranch(branchTag: string | undefined): BranchEffect {
  if (branchTag === 'good') {
    return { shieldDelta: -1, partyDelta: 0, wardenHeal: 0, stagger: true, banner: 'The Warden concedes the point — a shield shatters, and he reels.' };
  }
  if (branchTag === 'bad') {
    return { shieldDelta: 0, partyDelta: -2, wardenHeal: 1, stagger: false, banner: 'The Warden presses his terms — you give ground, and he mends.' };
  }
  return { shieldDelta: 0, partyDelta: 0, wardenHeal: 0, stagger: false, banner: 'A wary stalemate — no ground won.' };
}

export function reduceShields(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

/** Boss is beaten when its shields are gone OR (fallback) its HP is spent. */
export function bossDefeated(shields: number, hp: number): boolean {
  return shields <= 0 || hp <= 0;
}
