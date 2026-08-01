/**
 * The damage table — the heart of combat↔knowledge. Maps (action, answer
 * quality) → a normalized outcome the scene applies to the board. Pure and
 * fully unit-tested. Numbers per the friction redesign (2026-07-19):
 *
 *  Strike (FREE, r1):     fixed 1, cannot miss, no question — the flow move.
 *  Smite  (mcq, r2):      quick bolt; q1→3  q0.5→1  q0→0. The cheapest gated spell.
 *  Weave  (match, r2):    cross AoE; q1→2 to every cross target, q0.5→primary only, q0→none
 *  Sequence(order, r3):   line; 2 dmg per tile up to depth floor(q*3) (q1→3-deep, q0.5→1-deep, q0→0)
 *  Cast   (recall, r3):   q1→6 (×3 crit), q0.5→2, q0→0 + Fade counter 2 to the party
 *  Parley (branch, r1):   good→weaken target, bad→party −2, else nothing
 *
 * The economy: every GATED spell out-damages a free Strike (1) at full quality —
 * answering a question is meant to feel like a big swing. Teeth live in the enemy
 * answering back each turn (so pure-Strike play is slow/costly) and in Cast's Fade
 * counter on a fail; a whiffed spell simply wastes the turn (no self-chip).
 * Mira's mastery bonus (+1) folds into the primary/first-tile hit when she acts and
 * a hit lands. Boss: a passing Cast vs the Warden strips an EXTRA shield.
 */
import { manhattan, type ActionKind, type Coord, type Quality, type Team, type UnitState } from './types';
import { SPELLBOOK, resolveSpell, qualitySlot, type SpellDef, type BoardOp, type ResolveSpellOpts } from './spells';

export interface ActionOutcome {
  /** damage to the primary target (Strike/Cast) or the line's first tile / cross centre */
  hits: number;
  aoe: 'none' | 'cross' | 'line';
  /** damage to each ADDITIONAL aoe target (cross arms / line tiles 2..depth) */
  aoeHit: number;
  /** Ritual Sequence lance depth (tiles) */
  lineDepth: number;
  /** recoil to the acting unit (teeth on a whiff) */
  selfChip: number;
  /** Fade counter to the party pool (Cast fail) */
  fade: number;
  /** Parley good → target loses a turn / is weakened */
  weaken: boolean;
  /** Parley bad → party takes this */
  partyHit: number;
  /** boss: extra shield stripped (passing Cast vs Warden) */
  extraShield: number;
  /** one-line "why" banner shown to the player */
  banner: string;
}

const EMPTY: ActionOutcome = {
  hits: 0, aoe: 'none', aoeHit: 0, lineDepth: 0, selfChip: 0,
  fade: 0, weaken: false, partyHit: 0, extraShield: 0, banner: '',
};

export interface ResolveOpts {
  /** +1 when Mira acts and province mastery ≥ gate */
  miraBonus?: number;
  /** targeting the boss (Cast can strip a shield on a pass) */
  vsBoss?: boolean;
  /** difficulty-rewards.md §4 rider, already gated by the caller */
  rider?: boolean;
  /** scenario_branch outcome, for Parley / boss branches */
  branchTag?: string;
}

/** Every synthetic aoe id Weave's 4-arm cross could ever need; Sequence only ever consumes
 *  a prefix of these (resolveSpell trims line aoe ids to lineDepth-1 itself). */
const T1_PRIMARY = 'target';
const T1_AOE = ['aoe-1', 'aoe-2', 'aoe-3', 'aoe-4'];

/**
 * The thin adapter (Phase 2 §2): builds the legacy ActionOutcome shape by actually calling
 * resolveSpell against the T1 SpellDef, using synthetic ids since resolveAction's callers
 * never had real unit ids to give it. Numeric amounts (hits/aoeHit/fade-or-partyHit/banner)
 * are parsed OUT of the returned BoardOp[] — proving the real dispatch computed them: the
 * bulk of what "equivalent to resolveSpell" means. A few fields have no BoardOp primitive at
 * all (aoe kind, lineDepth, the legacy weaken flag, extraShield) because they are shape/
 * metadata concerns, not board operations — those are read directly off the SpellDef.
 */
function outcomeFromSpell(def: SpellDef, quality: Quality, opts: ResolveOpts): ActionOutcome {
  const slot = qualitySlot(quality);
  const effect = def.effects[slot];
  const spellOpts: ResolveSpellOpts = {
    primaryTargetId: T1_PRIMARY,
    aoeTargetIds: T1_AOE,
    miraBonus: opts.miraBonus,
    rider: opts.rider,
    vsBoss: opts.vsBoss,
  };
  const ops = resolveSpell(def, quality, spellOpts);

  const dmgOps = ops.filter((o): o is Extract<BoardOp, { op: 'damage' }> => o.op === 'damage');
  const hits = dmgOps.find((o) => o.targetId === T1_PRIMARY)?.amount ?? 0;
  const aoeHit = dmgOps.find((o) => o.targetId !== T1_PRIMARY)?.amount ?? 0;
  const fadeOpAmount = (ops.find((o): o is Extract<BoardOp, { op: 'fade' }> => o.op === 'fade'))?.amount ?? 0;
  const banner = ops
    .filter((o): o is Extract<BoardOp, { op: 'banner' }> => o.op === 'banner')
    .map((o) => o.text)
    .join('\n');

  return {
    ...EMPTY,
    hits,
    aoe: def.shape === 'cross' ? 'cross' : def.shape === 'line' ? 'line' : 'none',
    aoeHit,
    lineDepth: effect.lineDepth,
    fade: effect.fade > 0 ? fadeOpAmount : 0,
    partyHit: effect.partyHit > 0 ? fadeOpAmount : 0,
    weaken: effect.weaken === true,
    extraShield: def.bossRider === 'strip-shield' && quality === 1 && !!opts.vsBoss ? 1 : 0,
    banner,
  };
}

export function resolveAction(action: ActionKind, quality: Quality, opts: ResolveOpts = {}): ActionOutcome {
  const mira = opts.miraBonus ?? 0;
  switch (action) {
    case 'strike': {
      // Free basic attack — no encounter, cannot miss. Fixed, modest, always lands
      // (quality is irrelevant; the scene always resolves a Strike at full).
      return { ...EMPTY, hits: 1 + mira, banner: 'A quick strike.' };
    }
    case 'smite':
      return outcomeFromSpell(SPELLBOOK.smite, quality, opts);
    case 'weave':
      return outcomeFromSpell(SPELLBOOK.weave, quality, opts);
    case 'sequence':
      return outcomeFromSpell(SPELLBOOK.sequence, quality, opts);
    case 'cast':
      return outcomeFromSpell(SPELLBOOK.cast, quality, opts);
    case 'parley': {
      // Legacy quirk preserved exactly: the ORIGINAL resolveAction ignored its `quality`
      // argument entirely for parley and branched only on opts.branchTag (kinds.ts always
      // sets quality to match — good=1/neutral=0.5/bad=0 — but the two were never enforced
      // to agree). resolveSpell keys purely off quality, so the adapter derives the true
      // quality FROM branchTag here rather than trusting the passed-in `quality`.
      const q: Quality = opts.branchTag === 'good' ? 1 : opts.branchTag === 'bad' ? 0 : 0.5;
      return outcomeFromSpell(SPELLBOOK.parley, q, opts);
    }
    case 'wait':
      return { ...EMPTY, banner: 'Holding position.' };
    case 'satchel':
      // Never actually reached: CombatScene.onPickAction special-cases 'satchel' before
      // the validTargets gate and resolves it via combat/satchel.ts + services.inventory,
      // never this table (inventory-handoff §10). Kept only so the switch stays exhaustive.
      return { ...EMPTY, banner: 'The satchel resolves outside this table.' };
  }
}

/**
 * supersession-reteach.md §5 — the one mercy rule. On the SUPERSEDING fact's first graded
 * appearance a miss costs the party no HP: the player mastered the old truth, the world
 * moved, and their diligence didn't fail. Zeroes every party-facing cost this table can
 * produce (Cast's Fade counter, Parley's party hit, a whiff's self-chip) and composes the
 * Clerk's line AFTER the base copy in the banner slot. Damage dealt is untouched — a miss
 * still buys nothing — and the SRS record stays honest (the caller records quality 0 as
 * normal, arming redemption). Second appearance onward: full teeth.
 */
export const AMENDED_MERCY_LINE = 'The Realm moved, not you. Read it again.';

export function applyAmendedMercy(outcome: ActionOutcome): ActionOutcome {
  return {
    ...outcome,
    fade: 0,
    partyHit: 0,
    selfChip: 0,
    banner: outcome.banner ? `${outcome.banner}\n${AMENDED_MERCY_LINE}` : AMENDED_MERCY_LINE,
  };
}

/** Same mercy at the T2/T3 seam, where the board is driven by BoardOps rather than an
 *  ActionOutcome: drop the Fade counter and any damage aimed at the party's own units. */
export function stripPartyHarmOps(ops: readonly BoardOp[], partyIds: readonly string[]): BoardOp[] {
  const party = new Set(partyIds);
  return ops.filter(
    (o) => !(o.op === 'fade' || (o.op === 'damage' && party.has(o.targetId))),
  );
}

/** Short label for the turn/HUD, e.g. floating combat text context. */
export function qualityWord(q: Quality): string {
  return q === 1 ? 'FULL' : q === 0.5 ? 'PARTIAL' : 'MISS';
}

/**
 * §4.1 flanking (melee only): a range-1 attack from `attackerPos` on `targetPos` flanks
 * when the tile directly OPPOSITE the attacker (O = T + (T − A)) holds a living unit of
 * the ATTACKER's team. Applies to both teams. Spells never flank — callers gate this to
 * melee sources (Strike, enemy melee, opportunity strikes) only; the range-1 check here
 * is a defensive backstop, not the primary gate. Route the result through computeHit's
 * `flank` param (status.ts).
 */
export function isFlanked(attackerPos: Coord, targetPos: Coord, attackerTeam: Team, units: UnitState[]): boolean {
  if (manhattan(attackerPos, targetPos) !== 1) return false;
  const opposite: Coord = {
    c: targetPos.c + (targetPos.c - attackerPos.c),
    r: targetPos.r + (targetPos.r - attackerPos.r),
  };
  return units.some((u) => u.alive && u.team === attackerTeam && u.c === opposite.c && u.r === opposite.r);
}
