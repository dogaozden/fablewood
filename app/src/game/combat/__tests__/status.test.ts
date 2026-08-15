import { describe, it, expect } from 'vitest';
import {
  STATUS_DEFS, hasStatus, statusMagnitude, clearStatus, applyStatus,
  tickTurnStart, decayTurnEnd, effectiveMove, computeHit, CONSUMED_ON_OWN_ACTION,
  type StatusId, type StatusInstance,
} from '../status';
import { makeKeeper, makeEnemy, ENEMY_STATS } from '../units';

const STATUS_IDS: StatusId[] = [
  'kindled', 'bound', 'dimmed', 'warded', 'inked', 'emboldened', 'weakened', 'staggered',
];

describe('STATUS_DEFS', () => {
  it('defines all 8 statuses, each refresh-stacking', () => {
    for (const id of STATUS_IDS) {
      expect(STATUS_DEFS[id].id).toBe(id);
      expect(STATUS_DEFS[id].stack).toBe('refresh');
      expect(STATUS_DEFS[id].glyph.length).toBeGreaterThan(0);
    }
  });
  it('only kindled carries a tickStart hook', () => {
    expect(STATUS_DEFS.kindled.tickStart).toBeTypeOf('function');
    for (const id of STATUS_IDS.filter((i) => i !== 'kindled')) {
      expect(STATUS_DEFS[id].tickStart).toBeUndefined();
    }
  });
});

describe('hasStatus / statusMagnitude / clearStatus', () => {
  const statuses: StatusInstance[] = [{ id: 'inked', turnsLeft: 2, magnitude: 1 }];
  it('hasStatus reports presence', () => {
    expect(hasStatus(statuses, 'inked')).toBe(true);
    expect(hasStatus(statuses, 'bound')).toBe(false);
  });
  it('statusMagnitude reads the magnitude, 0 if absent', () => {
    expect(statusMagnitude(statuses, 'inked')).toBe(1);
    expect(statusMagnitude(statuses, 'bound')).toBe(0);
  });
  it('clearStatus removes only the named id', () => {
    const two: StatusInstance[] = [...statuses, { id: 'bound', turnsLeft: 1, magnitude: 0 }];
    expect(clearStatus(two, 'inked')).toEqual([{ id: 'bound', turnsLeft: 1, magnitude: 0 }]);
  });
});

describe('applyStatus — refresh-not-stack (§3 rule 1)', () => {
  it('adds a fresh status with the given turns/magnitude', () => {
    const u = makeKeeper(0, 0);
    const next = applyStatus(u, 'inked', 2);
    expect(next).toEqual([{ id: 'inked', turnsLeft: 2, magnitude: 1 }]);
  });

  it('re-applying a SMALLER duration/magnitude does not shrink the existing one', () => {
    let u = makeKeeper(0, 0);
    u = { ...u, statuses: applyStatus(u, 'weakened', 2, 1) };
    u = { ...u, statuses: applyStatus(u, 'weakened', 1, 1) }; // weaker re-application
    expect(u.statuses).toEqual([{ id: 'weakened', turnsLeft: 2, magnitude: 1 }]);
  });

  it('re-applying a BIGGER duration refreshes turnsLeft to the max', () => {
    let u = makeKeeper(0, 0);
    u = { ...u, statuses: applyStatus(u, 'weakened', 1, 1) };
    u = { ...u, statuses: applyStatus(u, 'weakened', 2, 1) };
    expect(u.statuses).toEqual([{ id: 'weakened', turnsLeft: 2, magnitude: 1 }]);
  });

  it('one instance per StatusId — never two entries for the same status', () => {
    let u = makeKeeper(0, 0);
    u = { ...u, statuses: applyStatus(u, 'inked', 1) };
    u = { ...u, statuses: applyStatus(u, 'emboldened', 1) };
    u = { ...u, statuses: applyStatus(u, 'inked', 2) };
    expect(u.statuses.filter((s) => s.id === 'inked')).toHaveLength(1);
    expect(u.statuses).toHaveLength(2);
  });

  it("Warded max rule: a bigger ward replaces a smaller, never sums (4 then 2 stays 4)", () => {
    let u = makeKeeper(0, 0);
    u = { ...u, statuses: applyStatus(u, 'warded', -1, 4) };
    u = { ...u, statuses: applyStatus(u, 'warded', -1, 2) };
    expect(statusMagnitude(u.statuses, 'warded')).toBe(4);
  });

  it('Warded max rule the other way: 2 then 4 becomes 4 (still never sums to 6)', () => {
    let u = makeKeeper(0, 0);
    u = { ...u, statuses: applyStatus(u, 'warded', -1, 2) };
    u = { ...u, statuses: applyStatus(u, 'warded', -1, 4) };
    expect(statusMagnitude(u.statuses, 'warded')).toBe(4);
  });

  it('regression: repeated Parley-good Weakened applications never drift attack down further than -1 (no permanent stacking)', () => {
    // Parley-good migrates to Staggered(1) + Weakened(2) (§3 rule 6) instead of the old
    // permanent attack-=1. Simulating several parleys across a battle must cap at
    // magnitude 1 forever, never accumulate.
    let u = makeKeeper(0, 0);
    for (let i = 0; i < 5; i++) {
      u = { ...u, statuses: applyStatus(u, 'weakened', 2, 1) };
    }
    expect(statusMagnitude(u.statuses, 'weakened')).toBe(1);
    expect(u.statuses.filter((s) => s.id === 'weakened')).toHaveLength(1);
  });
});

describe('applyStatus — construct Bound immunity (§8 Bond-proof)', () => {
  it('rejects Bound outright for archetype construct — statuses unchanged', () => {
    const construct = makeEnemy({ archetype: 'construct' }, 0, 0, 0);
    const next = applyStatus(construct, 'bound', 2);
    expect(next).toEqual([]);
    expect(next).toBe(construct.statuses); // same reference — a true no-op rejection
  });
  it('does not reject other statuses for a construct (only Bound is Bond-proof)', () => {
    const construct = makeEnemy({ archetype: 'construct' }, 0, 0, 0);
    expect(applyStatus(construct, 'inked', 2)).toEqual([{ id: 'inked', turnsLeft: 2, magnitude: 1 }]);
  });
  it('a non-construct unit accepts Bound normally', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 0, 0);
    expect(applyStatus(wisp, 'bound', 2)).toEqual([{ id: 'bound', turnsLeft: 2, magnitude: 1 }]);
  });
});

describe('tickTurnStart (§3 rule 2)', () => {
  it('kindled deals its damage before staggered is consumed, in that exact order', () => {
    const u = { ...makeKeeper(0, 0), hp: 5, statuses: [
      { id: 'kindled', turnsLeft: 1, magnitude: 1 } as StatusInstance,
      { id: 'staggered', turnsLeft: 1, magnitude: 0 } as StatusInstance,
    ] };
    const { ops, statuses } = tickTurnStart(u);
    expect(ops).toEqual([{ op: 'damage', amount: 1 }, { op: 'consume' }]);
    expect(statuses).toEqual([]); // kindled expired (turnsLeft 1→0), staggered consumed
  });

  it('kindled can kill — the returned damage op, applied, brings hp to 0 or below', () => {
    const u = { ...makeKeeper(0, 0), hp: 1, statuses: [{ id: 'kindled', turnsLeft: 2, magnitude: 1 } as StatusInstance] };
    const { ops } = tickTurnStart(u);
    const dmg = ops.filter((o) => o.op === 'damage').reduce((sum, o) => sum + (o as { op: 'damage'; amount: number }).amount, 0);
    expect(u.hp - dmg).toBeLessThanOrEqual(0);
  });

  it('kindled ticks once per call and decrements; a 2-turn kindled survives to tick again next turn', () => {
    const u = { ...makeKeeper(0, 0), statuses: [{ id: 'kindled', turnsLeft: 2, magnitude: 1 } as StatusInstance] };
    const first = tickTurnStart(u);
    expect(first.ops).toEqual([{ op: 'damage', amount: 1 }]);
    expect(first.statuses).toEqual([{ id: 'kindled', turnsLeft: 1, magnitude: 1 }]);

    const second = tickTurnStart({ ...u, statuses: first.statuses });
    expect(second.ops).toEqual([{ op: 'damage', amount: 1 }]);
    expect(second.statuses).toEqual([]); // expired after its 2nd tick
  });

  it('staggered alone: consumed and signals turn-end, no damage op', () => {
    const u = { ...makeKeeper(0, 0), statuses: [{ id: 'staggered', turnsLeft: 1, magnitude: 0 } as StatusInstance] };
    const { ops, statuses } = tickTurnStart(u);
    expect(ops).toEqual([{ op: 'consume' }]);
    expect(statuses).toEqual([]);
  });

  it('neither present: no ops, statuses untouched', () => {
    const u = { ...makeKeeper(0, 0), statuses: [{ id: 'bound', turnsLeft: 2, magnitude: 0 } as StatusInstance] };
    const { ops, statuses } = tickTurnStart(u);
    expect(ops).toEqual([]);
    expect(statuses).toEqual(u.statuses);
  });
});

describe('decayTurnEnd (§3 rule 3)', () => {
  it('decrements ordinary duration statuses and removes them at 0', () => {
    const statuses: StatusInstance[] = [
      { id: 'bound', turnsLeft: 1, magnitude: 0 },
      { id: 'dimmed', turnsLeft: 2, magnitude: 1 },
    ];
    const next = decayTurnEnd(statuses);
    expect(next).toEqual([{ id: 'dimmed', turnsLeft: 1, magnitude: 1 }]); // bound expired
  });

  it('Warded never decays, no matter how many turn-ends pass', () => {
    let statuses: StatusInstance[] = [{ id: 'warded', turnsLeft: -1, magnitude: 3 }];
    for (let i = 0; i < 10; i++) statuses = decayTurnEnd(statuses);
    expect(statuses).toEqual([{ id: 'warded', turnsLeft: -1, magnitude: 3 }]);
  });

  it('kindled is NOT double-decremented here — its lifecycle belongs entirely to tickTurnStart', () => {
    const statuses: StatusInstance[] = [{ id: 'kindled', turnsLeft: 1, magnitude: 1 }];
    expect(decayTurnEnd(statuses)).toEqual([{ id: 'kindled', turnsLeft: 1, magnitude: 1 }]);
  });
});

describe('regression (crucible v1 #7): a skipped (Staggered) turn must still run turn-end decay', () => {
  it('tickTurnStart (consumes Staggered) followed by decayTurnEnd still decrements a co-applied duration status', () => {
    // Mirrors Parley-good's real shape: Staggered(1) + Weakened(2) applied together. The
    // fix this locks in is CombatScene calling endTurnDecay from the staggered branch
    // (before its early return) instead of skipping it for a turn the unit never acted on —
    // composing the two functions in that exact order must decrement Weakened by one.
    const u = {
      ...makeKeeper(0, 0),
      statuses: [
        { id: 'staggered', turnsLeft: 1, magnitude: 0 } as StatusInstance,
        { id: 'weakened', turnsLeft: 2, magnitude: 1 } as StatusInstance,
      ],
    };
    const tick = tickTurnStart(u);
    expect(tick.ops, 'staggered alone: consumed, no damage op').toEqual([{ op: 'consume' }]);
    expect(tick.statuses, 'weakened survives staggered\'s own consumption, untouched so far').toEqual([
      { id: 'weakened', turnsLeft: 2, magnitude: 1 },
    ]);

    const afterDecay = decayTurnEnd(tick.statuses);
    expect(afterDecay, "weakened decayed by 1 — the round was NOT skipped for it").toEqual([
      { id: 'weakened', turnsLeft: 1, magnitude: 1 },
    ]);
  });
});

describe('effectiveMove — bound-still-acts & dimmed floor (§3)', () => {
  it('Bound zeroes move (acting is a separate, unaffected concern — Bound is not Silenced)', () => {
    expect(effectiveMove(4, [{ id: 'bound', turnsLeft: 1, magnitude: 0 }])).toBe(0);
  });
  it('Dimmed subtracts 1, floored at a minimum of 1', () => {
    expect(effectiveMove(4, [{ id: 'dimmed', turnsLeft: 1, magnitude: 1 }])).toBe(3);
    expect(effectiveMove(1, [{ id: 'dimmed', turnsLeft: 1, magnitude: 1 }])).toBe(1); // floor
  });
  it('neither present: move is unchanged', () => {
    expect(effectiveMove(4, [])).toBe(4);
  });
});

describe('computeHit — the one pipeline (§3 rule 4)', () => {
  const noMods = {
    attackerStatuses: [] as StatusInstance[], targetStatuses: [] as StatusInstance[],
    flank: false, overglow: false, weld: false, rider: false, attackerDauntedSourceAlive: false,
    attackerUnwrittenOpeningTempo: false,
  };

  it('base only, no modifiers', () => {
    expect(computeHit({ base: 3, ...noMods })).toMatchObject({ hpDamage: 3, absorbed: 0 });
  });

  it('emboldened +1, weakened -1, flank +1, overglow +1, weld +1 — each applies additively', () => {
    expect(computeHit({ base: 1, ...noMods, attackerStatuses: [{ id: 'emboldened', turnsLeft: 1, magnitude: 1 }] }).hpDamage).toBe(2);
    expect(computeHit({ base: 1, ...noMods, attackerStatuses: [{ id: 'weakened', turnsLeft: 1, magnitude: 1 }] }).hpDamage).toBe(0);
    expect(computeHit({ base: 1, ...noMods, flank: true }).hpDamage).toBe(2);
    expect(computeHit({ base: 1, ...noMods, overglow: true }).hpDamage).toBe(2);
    expect(computeHit({ base: 1, ...noMods, weld: true }).hpDamage).toBe(2);
    expect(computeHit({
      base: 2, ...noMods, flank: true, overglow: true, weld: true,
      attackerStatuses: [{ id: 'emboldened', turnsLeft: 1, magnitude: 1 }],
    }).hpDamage).toBe(6); // 2+1+1+1+1
  });

  it('weakened floors at 0, never negative', () => {
    expect(computeHit({ base: 1, ...noMods, attackerStatuses: [{ id: 'weakened', turnsLeft: 1, magnitude: 1 }], flank: false }).hpDamage).toBe(0);
  });

  it('pipeline order: inked amplifies only nonzero post-floor damage (a 0 stays 0)', () => {
    const res = computeHit({
      base: 1, ...noMods,
      attackerStatuses: [{ id: 'weakened', turnsLeft: 1, magnitude: 1 }], // 1-1=0 after floor
      targetStatuses: [{ id: 'inked', turnsLeft: 1, magnitude: 1 }],
    });
    expect(res.hpDamage).toBe(0); // inked never touches a floored-to-zero hit
  });

  it('pipeline order: inked amplifies a nonzero post-floor hit, and Warded absorbs AFTER inked', () => {
    // base 2, inked +1 => post-inked 3; warded pool 2 => absorbs 2, hpDamage 1 remains.
    // (If Warded had absorbed BEFORE inked, this would instead be 2-2=0 with 1 leftover
    // inked-damage unaccounted for — the numbers here can only match the specified order.)
    const res = computeHit({
      base: 2, ...noMods,
      targetStatuses: [
        { id: 'inked', turnsLeft: 1, magnitude: 1 },
        { id: 'warded', turnsLeft: -1, magnitude: 2 },
      ],
    });
    expect(res.hpDamage).toBe(1);
    expect(res.absorbed).toBe(2);
    expect(statusMagnitude(res.targetStatuses, 'warded')).toBe(0); // fully spent → removed
    expect(hasStatus(res.targetStatuses, 'warded')).toBe(false);
  });

  it('Warded partial absorption leaves the remaining pool intact', () => {
    const res = computeHit({
      base: 2, ...noMods,
      targetStatuses: [{ id: 'warded', turnsLeft: -1, magnitude: 5 }],
    });
    expect(res.hpDamage).toBe(0);
    expect(res.absorbed).toBe(2);
    expect(statusMagnitude(res.targetStatuses, 'warded')).toBe(3);
  });

  it('no Warded present: absorbed is 0 and targetStatuses is returned unchanged', () => {
    const targetStatuses: StatusInstance[] = [{ id: 'inked', turnsLeft: 1, magnitude: 1 }];
    const res = computeHit({ base: 1, ...noMods, targetStatuses });
    expect(res.absorbed).toBe(0);
    expect(res.targetStatuses).toBe(targetStatuses); // same reference — no needless copy
  });
});

describe('Bestiary newcomers (Ch. VIII) — Task 1: pure groundwork', () => {
  const NEWCOMER_IDS: StatusId[] = ['toppled', 'daunted', 'unwritten'];

  describe('STATUS_DEFS', () => {
    it('defines toppled/daunted/unwritten, each refresh-stacking with a real glyph', () => {
      for (const id of NEWCOMER_IDS) {
        expect(STATUS_DEFS[id].id).toBe(id);
        expect(STATUS_DEFS[id].stack).toBe('refresh');
        expect(STATUS_DEFS[id].glyph.length).toBeGreaterThan(0);
      }
    });

    it('none of the three carry a tickStart hook — their lifecycles are event-driven, wired outside this module', () => {
      for (const id of NEWCOMER_IDS) {
        expect(STATUS_DEFS[id].tickStart).toBeUndefined();
      }
    });
  });

  describe('decayTurnEnd — none of the three decay by time', () => {
    it('toppled never ticks or expires, no matter how many turn-ends pass — it has no duration, only the rise consumes it', () => {
      let statuses: StatusInstance[] = [{ id: 'toppled', turnsLeft: 1, magnitude: 0 }];
      for (let i = 0; i < 10; i++) statuses = decayTurnEnd(statuses);
      expect(statuses).toEqual([{ id: 'toppled', turnsLeft: 1, magnitude: 0 }]);
    });

    it('daunted never decays by time — battle-long until its source falls, a later seam', () => {
      let statuses: StatusInstance[] = [{ id: 'daunted', turnsLeft: -1, magnitude: 0, sourceId: 'pall-1' }];
      for (let i = 0; i < 10; i++) statuses = decayTurnEnd(statuses);
      expect(statuses).toEqual([{ id: 'daunted', turnsLeft: -1, magnitude: 0, sourceId: 'pall-1' }]);
    });

    it('unwritten never decays by time — cleared only by acting or taking damage, both later seams', () => {
      let statuses: StatusInstance[] = [{ id: 'unwritten', turnsLeft: -1, magnitude: 0 }];
      for (let i = 0; i < 10; i++) statuses = decayTurnEnd(statuses);
      expect(statuses).toEqual([{ id: 'unwritten', turnsLeft: -1, magnitude: 0 }]);
    });
  });

  describe('applyStatus — keep-the-larger stands untouched for the three newcomers', () => {
    it('toppled refresh-stacks like every other status: one instance, turnsLeft/magnitude keep the larger', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'toppled', 1, 0) };
      u = { ...u, statuses: applyStatus(u, 'toppled', 1, 0) }; // re-knocked mid-rise: still one instance
      expect(u.statuses).toEqual([{ id: 'toppled', turnsLeft: 1, magnitude: 0 }]);
      expect(u.statuses).toHaveLength(1);
    });

    it('unwritten refresh-stacks like every other status', () => {
      let u = makeEnemy({ archetype: 'wisp' }, 0, 0, 0);
      u = { ...u, statuses: applyStatus(u, 'unwritten', -1, 0) };
      expect(u.statuses).toEqual([{ id: 'unwritten', turnsLeft: -1, magnitude: 0 }]);
    });

    it("daunted keeps the larger turnsLeft/magnitude on refresh, exactly like Warded's max rule", () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'daunted', 1, 1, 'pall-1') };
      u = { ...u, statuses: applyStatus(u, 'daunted', 5, 2) }; // bigger re-application
      expect(u.statuses).toEqual([{ id: 'daunted', turnsLeft: 5, magnitude: 2, sourceId: 'pall-1' }]);
    });
  });

  describe('StatusInstance.sourceId — additive-optional, only Daunted sets it', () => {
    it('a fresh Daunted apply sets sourceId to the given source', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'daunted', 1, 1, 'pall-1') };
      expect(u.statuses).toEqual([{ id: 'daunted', turnsLeft: 1, magnitude: 1, sourceId: 'pall-1' }]);
    });

    it('sourceId survives a refresh that omits it — it is not dropped', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'daunted', 1, 1, 'pall-1') };
      u = { ...u, statuses: applyStatus(u, 'daunted', 2, 1) }; // refresh, no sourceId argument this time
      expect(u.statuses[0].sourceId).toBe('pall-1');
    });

    it('a later apply can overwrite sourceId with a new source', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'daunted', 1, 1, 'pall-1') };
      u = { ...u, statuses: applyStatus(u, 'daunted', 1, 1, 'pall-2') };
      expect(u.statuses[0].sourceId).toBe('pall-2');
    });

    it('toppled and unwritten never carry a sourceId — the key is absent, not just undefined', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'toppled', 1, 0) };
      expect('sourceId' in u.statuses[0]).toBe(false);
    });
  });

  describe('CONSUMED_ON_OWN_ACTION — the fourth lifecycle', () => {
    it('contains exactly unwritten; the consuming hook itself lands at the CombatScene seam, later', () => {
      expect(CONSUMED_ON_OWN_ACTION.has('unwritten')).toBe(true);
      expect(CONSUMED_ON_OWN_ACTION.size).toBe(1);
    });
  });

  describe('ENEMY_STATS.toppleable — topple-ability is per-entry data (units.ts)', () => {
    it('all four standing archetypes are NOT toppleable — Toppling arrives with the Husk, a later task', () => {
      for (const archetype of ['wisp', 'wraith', 'construct', 'warden'] as const) {
        expect(ENEMY_STATS[archetype].toppleable).toBe(false);
      }
    });
  });

  describe('regression: the newcomers coexist with the original eight, no cross-contamination', () => {
    it('decayTurnEnd ticks a co-applied Weakened down by 1 while Toppled sits untouched beside it', () => {
      const statuses: StatusInstance[] = [
        { id: 'weakened', turnsLeft: 2, magnitude: 1 },
        { id: 'toppled', turnsLeft: 1, magnitude: 0 },
      ];
      expect(decayTurnEnd(statuses)).toEqual([
        { id: 'weakened', turnsLeft: 1, magnitude: 1 },
        { id: 'toppled', turnsLeft: 1, magnitude: 0 },
      ]);
    });

    it('computeHit is unaffected by an unrelated Daunted status (with sourceId) sitting in the array', () => {
      const res = computeHit({
        base: 1,
        attackerStatuses: [{ id: 'emboldened', turnsLeft: 1, magnitude: 1 }],
        targetStatuses: [{ id: 'daunted', turnsLeft: -1, magnitude: 0, sourceId: 'pall-1' }],
        flank: false, overglow: false, weld: false, rider: false, attackerDauntedSourceAlive: false,
        attackerUnwrittenOpeningTempo: false,
      });
      expect(res.hpDamage).toBe(2); // base 1 + emboldened 1; daunted/sourceId untouched — no pipeline change this task
    });
  });
});

describe('Bestiary (Ch. VIII) — Task 4: Daunted mechanics', () => {
  describe('computeHit — the −1 fold, active only while the source stands (mirrors weakened)', () => {
    const base2 = {
      base: 2, targetStatuses: [] as StatusInstance[], flank: false, overglow: false, weld: false, rider: false,
      attackerUnwrittenOpeningTempo: false,
    };
    const dauntedStatus = (magnitude = 1): StatusInstance[] => [{ id: 'daunted', turnsLeft: -1, magnitude, sourceId: 'pall-1' }];

    it('source alive-on-board: deals −1', () => {
      const res = computeHit({ ...base2, attackerStatuses: dauntedStatus(), attackerDauntedSourceAlive: true });
      expect(res.hpDamage).toBe(1);
    });

    it('source NOT alive: no penalty, even though the status is still sitting on the attacker', () => {
      const res = computeHit({ ...base2, attackerStatuses: dauntedStatus(), attackerDauntedSourceAlive: false });
      expect(res.hpDamage).toBe(2);
    });

    it('attackerDauntedSourceAlive:true is a no-op when the attacker does not carry daunted at all', () => {
      const res = computeHit({ ...base2, attackerStatuses: [], attackerDauntedSourceAlive: true });
      expect(res.hpDamage).toBe(2);
    });

    it('floors at 0, never negative — same floor rule as weakened', () => {
      const res = computeHit({
        base: 1, targetStatuses: [], flank: false, overglow: false, weld: false, rider: false,
        attackerStatuses: dauntedStatus(), attackerDauntedSourceAlive: true,
        attackerUnwrittenOpeningTempo: false,
      });
      expect(res.hpDamage).toBe(0);
    });

    it('stacks with weakened — both are −1 folds, applied together', () => {
      const res = computeHit({
        ...base2,
        attackerStatuses: [...dauntedStatus(), { id: 'weakened', turnsLeft: 1, magnitude: 1 }],
        attackerDauntedSourceAlive: true,
      });
      expect(res.hpDamage).toBe(0); // 2 - 1 (daunted) - 1 (weakened) = 0
    });

    it('reads magnitude via statusMagnitude exactly like weakened — not a hardcoded −1 literal', () => {
      const res = computeHit({ ...base2, base: 3, attackerStatuses: dauntedStatus(2), attackerDauntedSourceAlive: true });
      expect(res.hpDamage).toBe(1); // 3 - 2
    });
  });

  describe('sourceId — repeated touches from the SAME source (T6 Pall sanity-check)', () => {
    it('re-touching with an identical sourceId is a no-op for sourceId while turns/magnitude still keep-the-larger', () => {
      let u = makeKeeper(0, 0);
      u = { ...u, statuses: applyStatus(u, 'daunted', -1, 1, 'pall-1') };
      u = { ...u, statuses: applyStatus(u, 'daunted', -1, 1, 'pall-1') }; // the Pall touches again, same instance
      expect(u.statuses).toEqual([{ id: 'daunted', turnsLeft: -1, magnitude: 1, sourceId: 'pall-1' }]);

      // A bigger re-touch (e.g. a stronger variant landing later) still keeps-the-larger on
      // turns/magnitude, and sourceId — explicitly re-passed as the SAME id — stays put; this
      // composes correctly because "overwrite" with an identical value is indistinguishable
      // from "no-op" for sourceId specifically, while magnitude still refreshes to the max.
      u = { ...u, statuses: applyStatus(u, 'daunted', -1, 3, 'pall-1') };
      expect(u.statuses).toEqual([{ id: 'daunted', turnsLeft: -1, magnitude: 3, sourceId: 'pall-1' }]);
    });
  });
});

describe('Bestiary (Ch. VIII) — Task 5: Unwritten mechanics', () => {
  describe('computeHit — the opening-tempo +1 fold (rides the act that consumes the status)', () => {
    // Local equivalent of the "computeHit — the one pipeline" describe block's own `noMods`
    // (that one is scoped to its own callback, not reachable here) — same shape, minus the
    // field under test in this block.
    const noMods = {
      attackerStatuses: [] as StatusInstance[], targetStatuses: [] as StatusInstance[],
      flank: false, overglow: false, weld: false, rider: false, attackerDauntedSourceAlive: false,
    };

    it('true adds a flat +1, same shape as flank/overglow/weld/rider', () => {
      expect(computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: true }).hpDamage).toBe(2);
    });

    it('false (the default, every-other-hit case): no bonus', () => {
      expect(computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: false }).hpDamage).toBe(1);
    });

    it('reacts to the FLAG only, not to whether attackerStatuses happens to carry the unwritten id — the caller decides which hit this is, this pure module just folds what it is told', () => {
      const withStatusInArray = computeHit({
        base: 1, ...noMods, attackerUnwrittenOpeningTempo: true,
        attackerStatuses: [{ id: 'unwritten', turnsLeft: -1, magnitude: 0 }],
      });
      const withoutStatusInArray = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: true });
      expect(withStatusInArray.hpDamage).toBe(2);
      expect(withoutStatusInArray.hpDamage).toBe(2);
    });

    it('stacks additively with other modifiers (emboldened + flank + opening tempo, all at once)', () => {
      const res = computeHit({
        base: 1, ...noMods, attackerUnwrittenOpeningTempo: true, flank: true,
        attackerStatuses: [{ id: 'emboldened', turnsLeft: 1, magnitude: 1 }],
      });
      expect(res.hpDamage).toBe(4); // 1 + 1(emboldened) + 1(tempo) + 1(flank)
    });

    it('folds BEFORE the floor, like every other modifier — a heavily Weakened attacker still floors at 0 even with the tempo bonus stacked on top', () => {
      // base 0, weakened(2) => pre-floor -2, tempo +1 => pre-floor -1 => floors to 0. If the
      // bonus were (wrongly) applied AFTER the floor instead, this would read 1, not 0 — the
      // number pins the pipeline ORDER, not just the sign.
      const res = computeHit({
        base: 0, ...noMods, attackerUnwrittenOpeningTempo: true,
        attackerStatuses: [{ id: 'weakened', turnsLeft: 1, magnitude: 2 }],
      });
      expect(res.hpDamage).toBe(0);
    });

    it('exactly-once, pinned at the pure-function level: two sequential calls modeling "the consuming act" then "the next act" both read correctly off whatever the caller passes', () => {
      // Mirrors CombatScene's own sequence (enemyStrike): hit 1 fires while attacker.statuses
      // still carries 'unwritten', so the caller passes true; consumeOnOwnAction then clears
      // it; hit 2 fires with the caller now passing false, since attacker.statuses no longer
      // carries it. This module has no memory between calls — exactly-once is a property of
      // the CALLER's wiring (proven at the CombatScene/e2e level) — but this pins that
      // computeHit itself never "remembers" a prior true and always reflects the current call.
      const consumingAct = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: true });
      const nextAct = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: false });
      expect(consumingAct.hpDamage, 'the consuming act carries +1').toBe(2);
      expect(nextAct.hpDamage, 'the next act is plain base — never again').toBe(1);
    });

    // Fix round 1 — controller ruling: an opportunity strike IS the holder acting, exactly like
    // a turn-action hit (enemyStrike) — CombatScene now reads the SAME hasStatus/consumeOnOwnAction
    // pattern at BOTH resolveOpportunityStrikes and enemyStrike. computeHit itself can't tell
    // which of the two CombatScene seams a given call came from (it only ever sees the boolean
    // the caller hands it) — these two tests pin that the arithmetic is correct and symmetric
    // regardless of which seam fires FIRST for a given unit, which is the actual cross-path
    // guarantee CombatScene's wiring relies on. Full end-to-end proof through the real OA
    // machinery is deferred to Task 6 (no Unwritten unit can be walked-past in the shipped game
    // until the Lurker exists) — these are this round's unit-level evidence.
    it('cross-path exactly-once: an OA-from-unseen carries the tempo (and would consume the status); the SAME unit\'s later turn-action hit carries none', () => {
      // Models resolveOpportunityStrikes firing first — the striker is still Unwritten going
      // into its OA, so the caller passes true — then enemyStrike firing later that same round;
      // the OA's own consumeOnOwnAction already cleared 'unwritten' by then, so the caller now
      // passes false.
      const oaHit = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: true });
      const turnActionHit = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: false });
      expect(oaHit.hpDamage, 'the OA is the first act from the unseen — it carries +1').toBe(2);
      expect(turnActionHit.hpDamage, 'the turn-action hit is a LATER act — already revealed by the OA, no bonus').toBe(1);
    });

    it('cross-path exactly-once, the inverse ordering: a turn-action fires first and carries the tempo; a LATER OA from the same unit carries none', () => {
      // Models enemyStrike firing first (still Unwritten, caller passes true) — its own
      // consumeOnOwnAction clears the status — then a later OA from the same unit that round;
      // the caller now passes false, since attacker.statuses no longer carries 'unwritten'.
      const turnActionHit = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: true });
      const oaHit = computeHit({ base: 1, ...noMods, attackerUnwrittenOpeningTempo: false });
      expect(turnActionHit.hpDamage, 'the turn-action is the first act from the unseen — it carries +1').toBe(2);
      expect(oaHit.hpDamage, 'a later OA from the same (already-revealed) unit carries no bonus').toBe(1);
    });
  });
});
