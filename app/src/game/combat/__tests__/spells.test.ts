import { describe, it, expect } from 'vitest';
import { resolveAction } from '../damage';
import { computeHit } from '../status';
import { SPELLBOOK, resolveSpell, qualitySlot, spellsForArt, type SpellId } from '../spells';
import type { ArtId } from '../spells';

const SPELL_IDS = Object.keys(SPELLBOOK) as SpellId[];

/** A generous, fixed target roster covering every shape this spellbook uses:
 *  single/ally/self → primaryTargetId; cross (4 arms) / line (up to depth 4-1) → aoeTargetIds
 *  (resolveSpell trims line ids to lineDepth-1 itself); party/enemies for Courtcraft's
 *  role-scoped statuses; a push direction for the two spells that push. */
const TARGETS = {
  primaryTargetId: 'primary',
  aoeTargetIds: ['aoe-1', 'aoe-2', 'aoe-3', 'aoe-4'],
  partyIds: ['keeper', 'mira'],
  enemyIds: ['e1', 'e2'],
  dir: 'right' as const,
};

describe('SPELLBOOK — table snapshot (§7, freezes the numbers)', () => {
  it.each(SPELL_IDS)('%s resolves a stable BoardOp sequence at q1 / q05 / q0', (id) => {
    const def = SPELLBOOK[id];
    const snapshot = {
      q1: resolveSpell(def, 1, TARGETS),
      q05: resolveSpell(def, 0.5, TARGETS),
      q0: resolveSpell(def, 0, TARGETS),
    };
    expect(snapshot).toMatchSnapshot();
  });

  it('every spell carries a non-empty banner at all three quality slots', () => {
    for (const id of SPELL_IDS) {
      for (const q of [1, 0.5, 0] as const) {
        expect(SPELLBOOK[id].banner[qualitySlot(q)].length).toBeGreaterThan(0);
      }
    }
  });

  it('tier 1 spells are always free (soul S2 — never cap questions)', () => {
    for (const id of SPELL_IDS) {
      if (SPELLBOOK[id].tier === 1) expect(SPELLBOOK[id].glowCost).toBe(0);
    }
  });

  it('glowCost matches tier exactly: T2=1, T3=2', () => {
    for (const id of SPELL_IDS) {
      const def = SPELLBOOK[id];
      expect(def.glowCost).toBe(def.tier === 1 ? 0 : def.tier === 2 ? 1 : 2);
    }
  });

  it('bossRider strip-shield is flagged on exactly the three Attestation spells (§9)', () => {
    const flagged = SPELL_IDS.filter((id) => SPELLBOOK[id].bossRider === 'strip-shield').sort();
    expect(flagged).toEqual(['attested-ward', 'cast', 'verbatim-decree'].sort());
  });
});

describe('spellsForArt (§12.2 — the tier flyout row source)', () => {
  const ARTS_LIST: ArtId[] = ['kindling', 'binding', 'ritecraft', 'attestation', 'courtcraft'];

  it('every Art returns exactly 3 spells, sorted tier 1,2,3', () => {
    for (const art of ARTS_LIST) {
      const spells = spellsForArt(art);
      expect(spells).toHaveLength(3);
      expect(spells.map((s) => s.tier)).toEqual([1, 2, 3]);
      for (const s of spells) expect(s.art).toBe(art);
    }
  });

  it("kindling's tiers are exactly smite / cinder-rebuke / lanternfall, in that order", () => {
    expect(spellsForArt('kindling').map((s) => s.id)).toEqual(['smite', 'cinder-rebuke', 'lanternfall']);
  });

  it("courtcraft's tiers are exactly parley / heartening-word / injunction, in that order", () => {
    expect(spellsForArt('courtcraft').map((s) => s.id)).toEqual(['parley', 'heartening-word', 'injunction']);
  });
});

describe('spell-specific op sequencing (explicit, not just snapshot)', () => {
  it('Cinder-Rebuke q1 emits damage, THEN push, on the primary target', () => {
    const ops = resolveSpell(SPELLBOOK['cinder-rebuke'], 1, { primaryTargetId: 't', dir: 'right' });
    expect(ops[0]).toMatchObject({ op: 'damage', targetId: 't', amount: 2 });
    expect(ops[1]).toMatchObject({ op: 'push', targetId: 't', dir: 'right' });
  });

  it('Cinder-Rebuke q05 lands damage with no push', () => {
    const ops = resolveSpell(SPELLBOOK['cinder-rebuke'], 0.5, { primaryTargetId: 't', dir: 'right' });
    expect(ops.some((o) => o.op === 'push')).toBe(false);
    expect(ops).toContainEqual({ op: 'damage', targetId: 't', amount: 1 });
  });

  it('Snare-Knot q05 emits Bound(1) with NO damage op at all', () => {
    const ops = resolveSpell(SPELLBOOK['snare-knot'], 0.5, { primaryTargetId: 't' });
    expect(ops.some((o) => o.op === 'damage')).toBe(false);
    expect(ops).toContainEqual({ op: 'status', targetId: 't', id: 'bound', turns: 1, magnitude: 1 });
  });

  it('Lanternfall emits a damage+status pair per adjacent enemy — no single primary', () => {
    const ops = resolveSpell(SPELLBOOK.lanternfall, 1, { aoeTargetIds: ['e1', 'e2', 'e3'] });
    for (const id of ['e1', 'e2', 'e3']) {
      expect(ops).toContainEqual({ op: 'damage', targetId: id, amount: 3 });
      expect(ops).toContainEqual({ op: 'status', targetId: id, id: 'kindled', turns: 2, magnitude: 1 });
    }
    expect(ops.filter((o) => o.op === 'damage')).toHaveLength(3);
  });

  it('Injunction bad branch (q0) emits party damage (the shared fade primitive) AND a heal on the target', () => {
    const ops = resolveSpell(SPELLBOOK.injunction, 0, { primaryTargetId: 't' });
    expect(ops).toContainEqual({ op: 'fade', amount: 2 });
    expect(ops).toContainEqual({ op: 'heal', targetId: 't', amount: 2 });
  });

  it('Injunction good branch (q1) applies Bound + Weakened + Staggered together on one target', () => {
    const ops = resolveSpell(SPELLBOOK.injunction, 1, { primaryTargetId: 't' });
    const statuses = ops.filter((o) => o.op === 'status');
    expect(statuses).toEqual(
      expect.arrayContaining([
        { op: 'status', targetId: 't', id: 'bound', turns: 2, magnitude: 1 },
        { op: 'status', targetId: 't', id: 'weakened', turns: 2, magnitude: 1 },
        { op: 'status', targetId: 't', id: 'staggered', turns: 1, magnitude: 1 },
      ]),
    );
    expect(statuses).toHaveLength(3);
  });

  it('Parley good branch (q1) applies Staggered + Weakened together (§3 rule 6 migration, no permanent atk drift)', () => {
    const ops = resolveSpell(SPELLBOOK.parley, 1, { primaryTargetId: 't' });
    expect(ops).toContainEqual({ op: 'status', targetId: 't', id: 'staggered', turns: 1, magnitude: 1 });
    expect(ops).toContainEqual({ op: 'status', targetId: 't', id: 'weakened', turns: 2, magnitude: 1 });
    expect(ops.some((o) => o.op === 'damage')).toBe(false); // control-only, never raw damage
  });

  it('Rite of Sealing q05 depth-2: both tiles take damage, only the FIRST is Inked', () => {
    const ops = resolveSpell(SPELLBOOK['rite-of-sealing'], 0.5, TARGETS);
    const dmg = ops.filter((o) => o.op === 'damage');
    expect(dmg).toEqual([
      { op: 'damage', targetId: 'primary', amount: 2 },
      { op: 'damage', targetId: 'aoe-1', amount: 2 },
    ]);
    expect(ops).toContainEqual({ op: 'status', targetId: 'primary', id: 'inked', turns: 1, magnitude: 1 });
    expect(ops.some((o) => o.op === 'status' && o.targetId === 'aoe-1')).toBe(false);
  });

  it('Rite of Sealing q1 depth-4: all four tiles take damage AND are Inked', () => {
    const ops = resolveSpell(SPELLBOOK['rite-of-sealing'], 1, TARGETS);
    expect(ops.filter((o) => o.op === 'damage')).toHaveLength(4);
    expect(ops.filter((o) => o.op === 'status')).toHaveLength(4);
  });

  it('Heartening Word routes statuses by role (party vs enemies), never by target id', () => {
    const good = resolveSpell(SPELLBOOK['heartening-word'], 1, TARGETS);
    expect(good).toContainEqual({ op: 'status', targetId: 'keeper', id: 'emboldened', turns: 2, magnitude: 1 });
    expect(good).toContainEqual({ op: 'status', targetId: 'mira', id: 'emboldened', turns: 2, magnitude: 1 });
    const bad = resolveSpell(SPELLBOOK['heartening-word'], 0, TARGETS);
    expect(bad).toContainEqual({ op: 'status', targetId: 'e1', id: 'emboldened', turns: 1, magnitude: 1 });
    expect(bad).toContainEqual({ op: 'status', targetId: 'e2', id: 'emboldened', turns: 1, magnitude: 1 });
  });
});

describe('Overglow / weld / vsBoss (§5.3, §5.5, §9) — primary-only, never on aoe or burst hits', () => {
  it('Overglow adds +1 to the primary hit only, never to aoe arms', () => {
    const base = resolveSpell(SPELLBOOK.weave, 1, TARGETS);
    const over = resolveSpell(SPELLBOOK.weave, 1, { ...TARGETS, overglow: true });
    expect((base.find((o) => o.op === 'damage' && o.targetId === 'primary') as { amount: number }).amount).toBe(2);
    expect((over.find((o) => o.op === 'damage' && o.targetId === 'primary') as { amount: number }).amount).toBe(3);
    const baseArm = base.find((o) => o.op === 'damage' && o.targetId === 'aoe-1') as { amount: number };
    const overArm = over.find((o) => o.op === 'damage' && o.targetId === 'aoe-1') as { amount: number };
    expect(overArm.amount).toBe(baseArm.amount); // untouched
  });

  it('the weld edge adds +1 to the primary hit only', () => {
    const ops = resolveSpell(SPELLBOOK.smite, 1, { ...TARGETS, weld: true });
    expect(ops).toContainEqual({ op: 'damage', targetId: 'primary', amount: 4 });
  });

  it('Overglow and weld stack additively on the same cast (both are simple +1s through computeHit)', () => {
    const ops = resolveSpell(SPELLBOOK.smite, 1, { ...TARGETS, overglow: true, weld: true });
    expect(ops).toContainEqual({ op: 'damage', targetId: 'primary', amount: 5 });
  });

  it('Overglow never applies to a burst1 spell (no single primary to pin a one-time +1 to — would otherwise multiply across every hit enemy)', () => {
    const ops = resolveSpell(SPELLBOOK.lanternfall, 1, { ...TARGETS, aoeTargetIds: ['e1', 'e2', 'e3'], overglow: true });
    for (const o of ops.filter((op) => op.op === 'damage')) {
      expect((o as { amount: number }).amount).toBe(3); // unchanged from the base table value
    }
  });

  it("Verbatim Decree's primary drops from 8 to 6 vs the Warden (still the apex, but boss-tuned)", () => {
    const normal = resolveSpell(SPELLBOOK['verbatim-decree'], 1, TARGETS);
    const boss = resolveSpell(SPELLBOOK['verbatim-decree'], 1, { ...TARGETS, vsBoss: true });
    expect(normal).toContainEqual({ op: 'damage', targetId: 'primary', amount: 8 });
    expect(boss).toContainEqual({ op: 'damage', targetId: 'primary', amount: 6 });
  });

  it("vsBoss does not change Cast's primary number (only Decree has a boss-specific figure)", () => {
    const boss = resolveSpell(SPELLBOOK.cast, 1, { ...TARGETS, vsBoss: true });
    expect(boss).toContainEqual({ op: 'damage', targetId: 'primary', amount: 6 });
  });
});

describe('§5.4 anti-soul math — S1 (no question-avoidant optimum)', () => {
  it('max Strike-turn damage (base + flank) stays strictly below the cheapest q1 tier-1 spell\'s full turn potential', () => {
    // Computed from the tables, not hardcoded: Strike's base comes from resolveAction (the
    // shipped free-action table), flank's +1 comes from the real computeHit pipeline, and
    // each spell's turn value comes straight from SPELLBOOK. Parley is control-only (no
    // damage number at all, same as the shipped 'every GATED spell out-damages a Strike'
    // test already excludes it) so it is not part of this comparison.
    //
    // Resolved ambiguity: §5.4's own prose computes "Weave q1 = up to 6 across the cross" —
    // a TOTAL (centre + arms), not Weave's bare primary/centre number (2, which merely TIES
    // a flanked Strike's ceiling of 2 and would fail a strict "primary alone" comparison).
    // The doc's own worked example confirms the intended comparison is each spell's FULL q1
    // turn potential (primary + every additional tile its own shape can reach), not the
    // primary-tile figure in isolation — so that is what this test computes, purely from
    // each SpellDef's own hits/aoeHit/lineDepth/shape (still "from the tables, not
    // hardcoded"; only the aggregation formula — max reachable tiles per shape — is added).
    const strikeBase = resolveAction('strike', 1).hits;
    const strikeMax = computeHit({
      base: strikeBase, attackerStatuses: [], targetStatuses: [], flank: true, overglow: false, weld: false,
    }).hpDamage;

    const maxAoeTiles = (id: 'smite' | 'weave' | 'sequence' | 'cast'): number => {
      const def = SPELLBOOK[id];
      if (def.shape === 'cross') return 4; // crossTiles: centre + 4 orthogonal arms
      if (def.shape === 'line') return Math.max(0, def.effects.q1.lineDepth - 1); // tiles 2..depth
      return 0; // single-target: smite, cast
    };
    const fullTurnPotential = (['smite', 'weave', 'sequence', 'cast'] as const).map((id) => {
      const effect = SPELLBOOK[id].effects.q1;
      return effect.hits + effect.aoeHit * maxAoeTiles(id);
    });

    expect(Math.min(...fullTurnPotential)).toBeGreaterThan(strikeMax);
  });

  it("a spell's bare primary-tile hit may tie (never beat) a favorably-flanked Strike in isolation — documented, not a regression", () => {
    // Weave and Sequence's CENTRE/first-tile number alone is 2, identical to Strike's
    // best-case flanked ceiling (1 base + 1 flank). This is fine: that ceiling requires an
    // ally in the exact opposite tile every single turn, whereas the gated spells reach it
    // unconditionally (by range) AND carry additional aoe upside a flanked Strike never has
    // — captured by the full-turn-potential test above, which is the real S1 guarantee.
    expect(SPELLBOOK.weave.effects.q1.hits).toBe(2);
    expect(SPELLBOOK.sequence.effects.q1.hits).toBe(2);
  });
});
