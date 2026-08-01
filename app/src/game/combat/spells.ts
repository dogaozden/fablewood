/**
 * The Five Arts' spellbook (§2, §7) — pure, Phaser-free, mirrors damage.ts/status.ts's
 * pattern: this module computes a battle-agnostic sequence of board primitives; the scene
 * (out of this module's scope) resolves target ids/direction and applies the ops. Spec:
 * docs/design/magic-combat-depth.md §2 (schemas), §7 (the 15 spells' exact numbers).
 *
 * Tier 1 = today's five shipped actions, renamed into their Art (soul S2: always free,
 * glowCost 0). Tiers 2-3 are new, gated by Glow (arts.ts) and Keeper's Rank (arts.ts).
 * damage.ts's resolveAction remains a thin adapter OVER resolveSpell for the five T1 ids
 * so the shipped ActionOutcome-shaped tests keep meaning — new tests target resolveSpell
 * directly.
 */
import type { Dir, Quality } from './types';
import { computeHit, type StatusId } from './status';

export type ArtId = 'kindling' | 'binding' | 'ritecraft' | 'attestation' | 'courtcraft';

export type SpellId =
  | 'smite' | 'cinder-rebuke' | 'lanternfall'
  | 'weave' | 'snare-knot' | 'lattice'
  | 'sequence' | 'processional' | 'rite-of-sealing'
  | 'cast' | 'attested-ward' | 'verbatim-decree'
  | 'parley' | 'heartening-word' | 'injunction';

export type QualitySlot = 'q1' | 'q05' | 'q0';

/**
 * One status application a spell effect carries. §2's schema sketches a SINGULAR `status`
 * field, but §7's own tables need MORE than one simultaneous status on a single effect
 * (Parley-good: Staggered + Weakened; Injunction-good: Bound + Weakened + Staggered) — a
 * singular field cannot express that. Resolved ambiguity #1: generalized to an array
 * (`SpellEffect.statuses`); a single-element array covers every other row unchanged.
 */
export interface StatusApplication {
  id: StatusId;
  turns: number;
  /** defaults to 1 when omitted — every status except Warded is a fixed-magnitude effect. */
  magnitude?: number;
  where: 'primary' | 'all-hit' | 'party' | 'enemies' | 'target-ally';
}

export interface SpellEffect {
  /** primary-target damage (line: first tile; cross: centre; ally/self: unused, 0) */
  hits: number;
  /** damage to each additional shape tile (cross arms / line tiles 2..depth); burst1 reuses
   *  `hits` as the PER-TARGET amount instead (see resolveSpell's burst1 branch) */
  aoeHit: number;
  /** Ritecraft line depth for this quality slot (0 when the cast whiffs) */
  lineDepth: number;
  push: 0 | 1;
  statuses: StatusApplication[];
  /** Attestation-only party-pool backlash on a miss */
  fade: number;
  /** Courtcraft 'bad' branch party-pool backlash */
  partyHit: number;
  /** legacy Parley plumbing, T1 parley only (§3 rule 6 migration) — ALSO tells resolveAction's
   *  adapter to surface the old ActionOutcome.weaken=true flag for that one case. */
  weaken?: boolean;
  /** Injunction-bad's enemy mend */
  heal?: { target: 'primary'; amount: number };
  /** Verbatim Decree only: the primary amount when opts.vsBoss is true (8 normally, 6 vs the
   *  Warden) — every other spell's number is boss-invariant, so this stays undefined for them. */
  vsBossHits?: number;
}

export interface SpellDef {
  id: SpellId;
  art: ArtId;
  tier: 1 | 2 | 3;
  label: string;
  blurb: string;
  /** tier 1 is ALWAYS 0 (soul S2 — never cap questions; Glow gates only the NEW power) */
  glowCost: 0 | 1 | 2;
  range: number;
  /** burst1 = the caster's 4 orthogonal neighbours (crossTiles minus centre). ally = self or
   *  ally within range. self = no geometric target; effects are role-scoped (party/enemies). */
  shape: 'single' | 'cross' | 'line' | 'self' | 'burst1' | 'ally';
  effects: Record<QualitySlot, SpellEffect>;
  /** replaces wardenAbsorbs' string-match on 'cast' (§9, trap #10) — Phase 3 consumes this
   *  directly off the SpellDef; resolveSpell itself never reads or acts on it. */
  bossRider?: 'strip-shield';
  banner: Record<QualitySlot, string>;
}

export type BoardOp =
  | { op: 'damage'; targetId: string; amount: number }
  | { op: 'status'; targetId: string; id: StatusId; turns: number; magnitude: number }
  | { op: 'push'; targetId: string; dir: Dir }
  | { op: 'fade'; amount: number }
  | { op: 'heal'; targetId: string; amount: number }
  | { op: 'banner'; text: string };

export interface ResolveSpellOpts {
  /** the single/cross-centre/line-first-tile/ally target. Absent for 'self'/'burst1' shapes. */
  primaryTargetId?: string;
  /** extra targets in application order: cross arms, line tiles 2..depth, or (burst1) every
   *  adjacent enemy — the caller (board-aware) resolves these via grid.ts + live occupancy. */
  aoeTargetIds?: string[];
  /** ids for a 'where: party' status application (Heartening Word good) */
  partyIds?: string[];
  /** ids for a 'where: enemies' status application (Heartening Word bad) */
  enemyIds?: string[];
  /** push direction; required whenever the resolved effect has push:1 */
  dir?: Dir;
  /** §5.3 Overglow upcast — already gated (rank≥2, ≥1 pip spent) by the caller; resolveSpell
   *  only enforces the "max +1, primary only" ceiling by construction (a boolean, not a count). */
  overglow?: boolean;
  /** §5.5 the weld edge — already decided (capture-before-record) by the caller. */
  weld?: boolean;
  /** difficulty-rewards.md §4 the rider — already decided (quality===1 gate, packReady check)
   *  by the caller. */
  rider?: boolean;
  /** Mira's mastery bonus, folded into a landed primary hit only (never a whiff, never aoe). */
  miraBonus?: number;
  /** targeting the boss — gates Verbatim Decree's vsBossHits and (via the adapter) extraShield. */
  vsBoss?: boolean;
}

export function qualitySlot(quality: Quality): QualitySlot {
  return quality === 1 ? 'q1' : quality === 0.5 ? 'q05' : 'q0';
}

function fx(overrides: Partial<SpellEffect> = {}): SpellEffect {
  return {
    hits: 0,
    aoeHit: 0,
    lineDepth: 0,
    push: 0,
    statuses: [],
    fade: 0,
    partyHit: 0,
    ...overrides,
  };
}

export const SPELLBOOK: Record<SpellId, SpellDef> = {
  // ---- Kindling (mcq) — the quick art: one true spark among false lights ----
  smite: {
    id: 'smite', art: 'kindling', tier: 1,
    label: 'Smite', blurb: 'A bolt of cited truth. (multiple choice)',
    glowCost: 0, range: 2, shape: 'single',
    effects: {
      q1: fx({ hits: 3 }),
      q05: fx({ hits: 1 }),
      q0: fx(),
    },
    banner: {
      q1: 'A bolt of cited truth!',
      q05: 'A glancing bolt.',
      q0: 'The bolt fizzles — turn lost.',
    },
  },
  'cinder-rebuke': {
    id: 'cinder-rebuke', art: 'kindling', tier: 2,
    label: 'Cinder-Rebuke', blurb: 'A written ember that shoves. (multiple choice)',
    glowCost: 1, range: 2, shape: 'single',
    effects: {
      q1: fx({ hits: 2, push: 1 }),
      q05: fx({ hits: 1 }),
      q0: fx(),
    },
    banner: {
      q1: 'The ember catches — and shoves them back!',
      q05: 'A weak ember; it singes, nothing more.',
      q0: 'The ember gutters — turn lost.',
    },
  },
  lanternfall: {
    id: 'lanternfall', art: 'kindling', tier: 3,
    label: 'Lanternfall', blurb: "All the lantern's light at once. (multiple choice)",
    glowCost: 2, range: 0, shape: 'burst1',
    effects: {
      q1: fx({ hits: 3, statuses: [{ id: 'kindled', turns: 2, where: 'all-hit' }] }),
      q05: fx({ hits: 1 }),
      q0: fx(),
    },
    banner: {
      q1: "All the lantern's light, loosed at once!",
      q05: 'A guttering flare — it barely catches.',
      q0: 'The lantern gives no light — turn lost.',
    },
  },

  // ---- Binding (match) — threads and true pairings; knots that hold ----
  weave: {
    id: 'weave', art: 'binding', tier: 1,
    label: 'Binding Weave', blurb: 'A cross of binding light. (match the pairs)',
    glowCost: 0, range: 2, shape: 'cross',
    effects: {
      q1: fx({ hits: 2, aoeHit: 2 }),
      q05: fx({ hits: 2 }),
      q0: fx(),
    },
    banner: {
      q1: 'Full — the weave binds all.',
      q05: 'Partial — only the nearest thread binds.',
      q0: 'The weave slips — turn lost.',
    },
  },
  'snare-knot': {
    id: 'snare-knot', art: 'binding', tier: 2,
    label: 'Snare-Knot', blurb: 'A knot of its own true name — it cannot step. (match)',
    glowCost: 1, range: 3, shape: 'single',
    effects: {
      q1: fx({ hits: 1, statuses: [{ id: 'bound', turns: 2, where: 'primary' }] }),
      q05: fx({ statuses: [{ id: 'bound', turns: 1, where: 'primary' }] }),
      q0: fx(),
    },
    banner: {
      q1: 'The knot draws tight — it cannot step.',
      q05: 'A loose loop — it slows, barely.',
      q0: 'The thread snaps — turn lost.',
    },
  },
  lattice: {
    id: 'lattice', art: 'binding', tier: 3,
    label: 'Lattice of True Names', blurb: 'Every name in the room, tied at once. (match)',
    glowCost: 2, range: 2, shape: 'cross',
    effects: {
      q1: fx({ hits: 2, aoeHit: 2, statuses: [{ id: 'bound', turns: 1, where: 'all-hit' }] }),
      q05: fx({ hits: 2, statuses: [{ id: 'bound', turns: 1, where: 'primary' }] }),
      q0: fx(),
    },
    banner: {
      q1: 'Every name in the room, tied at once!',
      q05: 'One name catches; the rest slip free.',
      q0: 'The lattice unravels — turn lost.',
    },
  },

  // ---- Ritecraft (order) — proper sequence; the procession that must not break ----
  sequence: {
    id: 'sequence', art: 'ritecraft', tier: 1,
    label: 'Ritual Sequence', blurb: 'A lance in a line. (put in order)',
    glowCost: 0, range: 3, shape: 'line',
    effects: {
      q1: fx({ hits: 2, aoeHit: 2, lineDepth: 3 }),
      q05: fx({ hits: 2, aoeHit: 2, lineDepth: 1 }),
      q0: fx(),
    },
    banner: {
      q1: 'Full — a three-deep lance.',
      q05: 'Partial — the lance falls short.',
      q0: 'The lance breaks — turn lost.',
    },
  },
  processional: {
    id: 'processional', art: 'ritecraft', tier: 2,
    label: 'Processional', blurb: 'The rite sweeps them along its path. (put in order)',
    glowCost: 1, range: 3, shape: 'line',
    effects: {
      q1: fx({ hits: 2, aoeHit: 2, lineDepth: 3, push: 1 }),
      q05: fx({ hits: 1, aoeHit: 1, lineDepth: 3 }),
      q0: fx(),
    },
    banner: {
      q1: 'The rite sweeps them down its length!',
      q05: 'The rite falters, but still sweeps through.',
      q0: 'The procession scatters — turn lost.',
    },
  },
  'rite-of-sealing': {
    id: 'rite-of-sealing', art: 'ritecraft', tier: 3,
    label: 'Rite of Sealing', blurb: 'Struck through in the Ledger — marked things are struck true. (put in order)',
    glowCost: 2, range: 4, shape: 'line',
    effects: {
      q1: fx({ hits: 2, aoeHit: 2, lineDepth: 4, statuses: [{ id: 'inked', turns: 2, where: 'all-hit' }] }),
      q05: fx({ hits: 2, aoeHit: 2, lineDepth: 2, statuses: [{ id: 'inked', turns: 1, where: 'primary' }] }),
      q0: fx(),
    },
    banner: {
      q1: 'Struck through in the Ledger, marked true!',
      q05: 'Half-sealed — only the foremost is marked.',
      q0: 'The seal breaks — turn lost.',
    },
  },

  // ---- Attestation (free_recall) — sworn testimony before the Clerk; the apex ----
  cast: {
    id: 'cast', art: 'attestation', tier: 1,
    label: 'Cast From Memory', blurb: 'The big one — the Clerk judges. (recall)',
    glowCost: 0, range: 3, shape: 'single', bossRider: 'strip-shield',
    effects: {
      q1: fx({ hits: 6 }),
      q05: fx({ hits: 2 }),
      q0: fx({ fade: 2 }),
    },
    banner: {
      q1: 'Cast — the Ledger blazes (×3)!',
      q05: 'Partial recall — a glancing cast.',
      q0: 'The Fade lashes back (−2).',
    },
  },
  'attested-ward': {
    id: 'attested-ward', art: 'attestation', tier: 2,
    label: 'Attested Ward', blurb: 'Sworn protection, entered into the record. (recall — the Clerk judges)',
    glowCost: 1, range: 2, shape: 'ally', bossRider: 'strip-shield',
    effects: {
      q1: fx({ statuses: [{ id: 'warded', turns: -1, magnitude: 4, where: 'target-ally' }] }),
      q05: fx({ statuses: [{ id: 'warded', turns: -1, magnitude: 2, where: 'target-ally' }] }),
      q0: fx({ fade: 1 }),
    },
    banner: {
      q1: 'Sworn protection, entered into the record!',
      q05: 'A thinner ward — half-sworn.',
      q0: 'The oath falters — the Fade stirs (−1).',
    },
  },
  'verbatim-decree': {
    id: 'verbatim-decree', art: 'attestation', tier: 3,
    label: 'Verbatim Decree', blurb: "The book's own words, cited to the letter. (recall — the Clerk judges)",
    glowCost: 2, range: 3, shape: 'single', bossRider: 'strip-shield',
    effects: {
      q1: fx({ hits: 8, vsBossHits: 6 }),
      q05: fx({ hits: 3 }),
      q0: fx({ fade: 2 }),
    },
    banner: {
      q1: "The book's own words, cited to the letter!",
      q05: 'A partial citation — close, not exact.',
      q0: 'The Fade lashes back (−2).',
    },
  },

  // ---- Courtcraft (scenario_branch) — the merchant court; words that move people ----
  // Quality slots ARE the branch outcome here (encounters/kinds.ts renderScenario): q1=good,
  // q05=neutral, q0=bad. Callers must map branchTag → quality before calling resolveSpell.
  parley: {
    id: 'parley', art: 'courtcraft', tier: 1,
    label: 'Parley', blurb: 'Talk it down. (a branching choice)',
    glowCost: 0, range: 1, shape: 'single',
    effects: {
      q1: fx({
        statuses: [
          { id: 'staggered', turns: 1, where: 'primary' },
          { id: 'weakened', turns: 2, where: 'primary' },
        ],
        weaken: true,
      }),
      q05: fx(),
      q0: fx({ partyHit: 2 }),
    },
    banner: {
      q1: 'They yield — weakened.',
      q05: 'No accord — the moment passes.',
      q0: 'It backfires (−2).',
    },
  },
  'heartening-word': {
    id: 'heartening-word', art: 'courtcraft', tier: 2,
    label: 'Heartening Word', blurb: 'The right word at the right moment — the retinue stands taller. (a branching choice)',
    glowCost: 1, range: 0, shape: 'self',
    effects: {
      q1: fx({ statuses: [{ id: 'emboldened', turns: 2, where: 'party' }] }),
      q05: fx(),
      q0: fx({ statuses: [{ id: 'emboldened', turns: 1, where: 'enemies' }] }),
    },
    banner: {
      q1: 'The right word lands — the retinue stands taller!',
      q05: 'The moment passes, unremarked.',
      q0: 'A botched word — the wrong side rallies!',
    },
  },
  injunction: {
    id: 'injunction', art: 'courtcraft', tier: 3,
    label: 'Injunction', blurb: 'A writ that stops them where they stand. (a branching choice)',
    glowCost: 2, range: 2, shape: 'single',
    effects: {
      q1: fx({
        statuses: [
          { id: 'bound', turns: 2, where: 'primary' },
          { id: 'weakened', turns: 2, where: 'primary' },
          { id: 'staggered', turns: 1, where: 'primary' },
        ],
      }),
      q05: fx({ statuses: [{ id: 'weakened', turns: 1, where: 'primary' }] }),
      q0: fx({ partyHit: 2, heal: { target: 'primary', amount: 2 } }),
    },
    banner: {
      q1: 'A writ that stops them where they stand!',
      q05: 'A half-writ — it still stings.',
      q0: 'The writ backfires — they mend, you bleed (−2).',
    },
  },
};

/**
 * The ONE place resolveSpell folds Overglow/weld/Mira into a number — and ONLY for a
 * spell's single distinguished primary/ally target (never aoe arms, line tiles 2+, or any
 * burst1 hit — see resolveSpell's burst1 branch for why: §5.3 caps Overglow at +1 PER CAST,
 * so letting it apply per-target would silently multiply it across a burst).
 *
 * Routes through the existing status.ts computeHit (§3 rule 4) with EMPTY live statuses:
 * resolveSpell is pure and has no board access, so emboldened/weakened/inked/warded are NOT
 * its job. The scene applies those separately when it turns a 'damage' BoardOp into real HP
 * loss, calling computeHit AGAIN with the real attacker/target statuses and
 * overglow/weld:false (already baked in here, so they are never double-counted). Flank is
 * always false — spells never flank (§4.1).
 */
function primaryAmount(base: number, opts: ResolveSpellOpts, welded: boolean): number {
  const { hpDamage } = computeHit({
    base,
    attackerStatuses: [],
    targetStatuses: [],
    flank: false,
    overglow: !!opts.overglow,
    weld: welded,
    rider: !!opts.rider,
  });
  return hpDamage + (opts.miraBonus ?? 0);
}

function idsFor(
  where: StatusApplication['where'],
  primaryTargetId: string | undefined,
  aoeIds: string[],
  opts: ResolveSpellOpts,
): string[] {
  switch (where) {
    case 'primary':
    case 'target-ally':
      return primaryTargetId ? [primaryTargetId] : [];
    case 'all-hit':
      return [...(primaryTargetId ? [primaryTargetId] : []), ...aoeIds];
    case 'party':
      return opts.partyIds ?? [];
    case 'enemies':
      return opts.enemyIds ?? [];
  }
}

/**
 * The ONE dispatch: (SpellDef, resolved quality, board context) → an ordered primitive op
 * sequence. Table-driven, not a per-spell switch (retires the applyOutcome if/else chain
 * and the per-action switch trap class, §16 trap 4). Application order is fixed and uniform
 * across every spell: damage → push → status → fade → heal → banner (banner always last).
 */
export function resolveSpell(def: SpellDef, quality: Quality, opts: ResolveSpellOpts = {}): BoardOp[] {
  const slot = qualitySlot(quality);
  const effect = def.effects[slot];
  const ops: BoardOp[] = [];

  // §5.5 grants the weld edge to "a q1 cast" — the quality gate lives HERE, at the single
  // point the weld is consumed, rather than at each caller. Every call site previously passed
  // `weld` straight through from weldBonus(boxes), which is quality-agnostic by design, so a
  // PARTIAL answer collected the mastery dividend and the "welded truth" banner it had not
  // earned. Gating here fixes the T1 adapter and castGatedSpell at once and leaves no call
  // site able to reintroduce it.
  const welded = !!opts.weld && quality === 1;

  // Line shapes carry a fixed MAX depth in their SpellDef, but the depth actually hit varies
  // by quality (§7: Rite of Sealing q05 is depth 2, not its q1 depth of 4) — trim the
  // caller's aoeTargetIds to what THIS quality slot really reaches rather than trusting it
  // passed exactly the right count.
  const aoeIds = def.shape === 'line'
    ? (opts.aoeTargetIds ?? []).slice(0, Math.max(0, effect.lineDepth - 1))
    : (opts.aoeTargetIds ?? []);

  if (def.shape === 'burst1') {
    // No distinct primary in a burst — every adjacent enemy takes the identical raw hit.
    if (effect.hits > 0) {
      for (const id of aoeIds) ops.push({ op: 'damage', targetId: id, amount: effect.hits });
    }
  } else {
    const rawPrimary = opts.vsBoss && effect.vsBossHits !== undefined ? effect.vsBossHits : effect.hits;
    if (rawPrimary > 0 && opts.primaryTargetId) {
      ops.push({ op: 'damage', targetId: opts.primaryTargetId, amount: primaryAmount(rawPrimary, opts, welded) });
    }
    if (effect.aoeHit > 0) {
      for (const id of aoeIds) ops.push({ op: 'damage', targetId: id, amount: effect.aoeHit });
    }
  }

  if (effect.push === 1 && opts.dir) {
    const pushIds = def.shape === 'line'
      ? [...(opts.primaryTargetId ? [opts.primaryTargetId] : []), ...aoeIds]
      : opts.primaryTargetId ? [opts.primaryTargetId] : [];
    for (const id of pushIds) ops.push({ op: 'push', targetId: id, dir: opts.dir });
  }

  for (const app of effect.statuses) {
    for (const id of idsFor(app.where, opts.primaryTargetId, aoeIds, opts)) {
      ops.push({ op: 'status', targetId: id, id: app.id, turns: app.turns, magnitude: app.magnitude ?? 1 });
    }
  }

  // Attestation's Fade and Courtcraft's partyHit are named separately in the data (useful if
  // the HUD ever wants to treat them distinctly) but board application is identical — both
  // just reduce the shared party pool — so both funnel into the single 'fade' BoardOp the
  // spec's closed BoardOp union provides (no spell ever sets both in the same slot).
  const fadeAmount = effect.fade + effect.partyHit;
  if (fadeAmount > 0) ops.push({ op: 'fade', amount: fadeAmount });

  if (effect.heal && opts.primaryTargetId) {
    ops.push({ op: 'heal', targetId: opts.primaryTargetId, amount: effect.heal.amount });
  }

  ops.push({ op: 'banner', text: def.banner[slot] });
  if (welded) ops.push({ op: 'banner', text: 'The welded truth strikes true.' });
  if (opts.rider) ops.push({ op: 'banner', text: 'The truth burns brighter. (+1)' });
  return ops;
}

/**
 * The three tiers of one Art, sorted (T1,T2,T3) — the tier flyout's row source (§12.2).
 * Not in the team lead's literal bullet list, but a small, obviously-needed complement to
 * ARTS/SPELLBOOK for the wiring layer (the flyout needs "this Art's 3 spells, in tier
 * order" far more often than "this Art's encounter kind"); flagged in the handoff report
 * as beyond the literal ask in case it's unwanted, same spirit as ARTS itself above.
 */
export function spellsForArt(art: ArtId): SpellDef[] {
  return (Object.values(SPELLBOOK) as SpellDef[]).filter((s) => s.art === art).sort((a, b) => a.tier - b.tier);
}
