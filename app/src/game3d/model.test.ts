import { describe, expect, it } from 'vitest'
import {
  applyAction,
  canAction,
  cloakUpgradeCost,
  freshJourney,
  hasCoverBetween,
  restoreJourney,
  type Journey,
} from './model'
import { distance, isWalkable } from './navigation'

const prepared = (overrides: Partial<Journey> = {}): Journey => ({
  ...freshJourney(),
  companion: true,
  chapter: 'road',
  learned: ['source-a', 'source-b', 'source-c'],
  renewed: ['stone-1', 'stone-2'],
  ...overrides,
})

describe('game3d journey model', () => {
  it('starts a deterministic, independent journey', () => {
    const first = freshJourney()
    const second = freshJourney()
    expect(first).toEqual({
      version: 1,
      position: { x: -8, z: 0 },
      companion: false,
      renewed: [],
      learned: [],
      collected: [],
      chapter: 'arrival',
      hp: 12,
      maxHp: 12,
      insight: 0,
      embers: 2,
      gold: 0,
      completedRuns: 0,
      combat: null,
      log: ['You arrive at the lantern hearth.'],
    })
    first.learned.push('changed')
    expect(second.learned).toEqual([])
  })

  it('allows short routed moves and refuses obstacles, water, and teleport distances', () => {
    const state = freshJourney()
    expect(applyAction(state, { type: 'move', to: { x: -5, z: 0 } }).position).toEqual({ x: -5, z: 0 })
    expect(canAction(state, { type: 'move', to: { x: -10, z: -6 } }).ok).toBe(false)
    expect(canAction(state, { type: 'move', to: { x: 11, z: 4 } }).ok).toBe(false)
    expect(canAction(state, { type: 'move', to: { x: 2, z: 3 } }).ok).toBe(false)
    expect(applyAction(state, { type: 'move', to: { x: 2, z: 3 } })).toBe(state)
  })

  it('recruits locally, learns unique neutral ids, and renews waystones in order', () => {
    let state = { ...freshJourney(), position: { x: 3, z: 6 } }
    state = applyAction(state, { type: 'recruit' })
    expect(state.companion).toBe(true)
    expect(state.chapter).toBe('road')

    state = { ...state, position: { x: 6, z: 4 } }
    state = applyAction(state, { type: 'learn', factId: 'neutral-source-1' })
    expect(state.insight).toBe(1)
    expect(canAction(state, { type: 'renew', stoneId: 'stone-2', quality: 1 }).ok).toBe(false)
    state = applyAction(state, { type: 'renew', stoneId: 'stone-1', quality: 0.5 })
    expect(state.renewed).toEqual(['stone-1'])
    expect(state.insight).toBe(2)

    const duplicate = applyAction(state, { type: 'learn', factId: 'neutral-source-1' })
    expect(duplicate).toBe(state)
  })

  it('lets a one-fact pack renew the full ordered road without requiring unavailable fact diversity', () => {
    let state = prepared({ learned: ['only-usable-source'], renewed: [], position: { x: 6, z: 4 } })
    state = applyAction(state, { type: 'renew', stoneId: 'stone-1', quality: 1 })
    state = { ...state, position: { x: 17, z: 3 } }
    state = applyAction(state, { type: 'renew', stoneId: 'stone-2', quality: 0.5 })
    state = applyAction(state, { type: 'enterBattle', kind: 'skirmish' })
    state = applyAction(state, { type: 'recall', targetId: 'shade-1', quality: 1 })
    state = applyAction(state, { type: 'recall', targetId: 'shade-2', quality: 1 })
    state = { ...state, position: { x: 24, z: -6 } }
    state = applyAction(state, { type: 'renew', stoneId: 'stone-3', quality: 1 })

    expect(state.renewed).toEqual(['stone-1', 'stone-2', 'stone-3'])
    expect(state.chapter).toBe('guardian')
  })

  it('makes failed recall cost health without progression and preserves story on defeat', () => {
    const state = prepared({ position: { x: 24, z: -6 }, renewed: ['stone-1', 'stone-2'], collected: ['skirmish-victory'], hp: 2 })
    const failed = applyAction(state, { type: 'renew', stoneId: 'stone-3', quality: 0 })
    expect(failed.position).toEqual({ x: -8, z: 0 })
    expect(failed.hp).toBe(failed.maxHp)
    expect(failed.renewed).toEqual(['stone-1', 'stone-2'])
    expect(failed.learned).toEqual(state.learned)
  })

  it('forgives only the amended first miss without granting waystone progress', () => {
    const state = prepared({ position: { x: 24, z: -6 }, collected: ['skirmish-victory'], hp: 6 })
    const forgiven = applyAction(state, { type: 'renew', stoneId: 'stone-3', quality: 0, amendedFirstMiss: true })
    expect(forgiven.hp).toBe(6)
    expect(forgiven.renewed).toEqual(state.renewed)
    expect(forgiven.log.at(-1)).toBe('The Realm moved, not you. Read it again.')
    expect(applyAction(forgiven, { type: 'renew', stoneId: 'stone-3', quality: 0 }).hp).toBe(4)
  })

  it('collects the cache once and restores bounded companion resources at the hearth', () => {
    let state = prepared({ position: { x: 20, z: 8 }, hp: 7, embers: 0 })
    state = applyAction(state, { type: 'collectChest' })
    expect(state.collected).toContain('chest')
    expect(state.gold).toBe(12)
    expect(state.embers).toBe(1)
    expect(applyAction(state, { type: 'collectChest' })).toBe(state)

    state = { ...state, position: { x: -8, z: 0 } }
    state = applyAction(state, { type: 'rest' })
    expect(state.hp).toBe(12)
    expect(state.embers).toBe(2)
  })

  it('prices cloak reinforcement and enforces gold, hearth, combat, and maximum gates', () => {
    const shortOnGold = { ...freshJourney(), gold: 11 }
    expect(cloakUpgradeCost(shortOnGold)).toBe(12)
    expect(canAction(shortOnGold, { type: 'reinforceCloak' })).toEqual({
      ok: false,
      reason: 'Reinforcing your hearth-cloak costs 12 gold.',
    })
    expect(applyAction(shortOnGold, { type: 'reinforceCloak' })).toBe(shortOnGold)

    const awayFromHearth = { ...shortOnGold, position: { x: -4, z: 0 }, gold: 12 }
    expect(canAction(awayFromHearth, { type: 'reinforceCloak' }).ok).toBe(false)

    const battle = applyAction(prepared({ position: { x: 17, z: 3 }, gold: 12 }), { type: 'enterBattle', kind: 'skirmish' })
    expect(canAction({ ...battle, position: { x: -8, z: 0 } }, { type: 'reinforceCloak' }).ok).toBe(false)

    const capped = { ...freshJourney(), hp: 20, maxHp: 20, gold: 100 }
    expect(cloakUpgradeCost(capped)).toBeNull()
    expect(canAction(capped, { type: 'reinforceCloak' }).ok).toBe(false)
  })

  it('spends the exact escalating cost and raises current and maximum health by two', () => {
    let state = { ...freshJourney(), hp: 7, gold: 50 }
    state = applyAction(state, { type: 'reinforceCloak' })
    expect(state).toMatchObject({ hp: 9, maxHp: 14, gold: 38 })
    expect(cloakUpgradeCost(state)).toBe(18)

    state = applyAction(state, { type: 'reinforceCloak' })
    expect(state).toMatchObject({ hp: 11, maxHp: 16, gold: 20 })
    expect(cloakUpgradeCost(state)).toBe(24)
  })

  it('restores upgraded saves and preserves cloak health through rest, patrols, and defeat', () => {
    let upgraded = { ...freshJourney(), hp: 5, gold: 30 }
    upgraded = applyAction(upgraded, { type: 'reinforceCloak' })
    upgraded = applyAction(upgraded, { type: 'reinforceCloak' })
    const restored = restoreJourney(upgraded)
    expect(restored).toEqual(upgraded)
    expect(restored).toMatchObject({ hp: 9, maxHp: 16, gold: 0 })

    const rested = applyAction({ ...restored, hp: 4 }, { type: 'rest' })
    expect(rested).toMatchObject({ hp: 16, maxHp: 16, gold: 0 })

    const patrol = applyAction({ ...restored, hp: 4, chapter: 'complete' }, { type: 'startPatrol' })
    expect(patrol).toMatchObject({ hp: 16, maxHp: 16, gold: 0 })

    let defeated: Journey = {
      ...restored,
      position: { x: 17, z: 3 },
      companion: true,
      chapter: 'road',
      learned: ['source-a'],
      renewed: ['stone-1', 'stone-2'],
      hp: 1,
      gold: 7,
    }
    defeated = applyAction(defeated, { type: 'enterBattle', kind: 'skirmish' })
    defeated = applyAction(defeated, { type: 'endTurn' })
    expect(defeated).toMatchObject({ position: { x: -8, z: 0 }, hp: 16, maxHp: 16, gold: 7, combat: null })
  })

  it('runs a two-enemy turn battle and cannot farm its reward by re-entry', () => {
    let state = prepared({ position: { x: 17, z: 3 } })
    state = applyAction(state, { type: 'enterBattle', kind: 'skirmish' })
    expect(state.combat?.enemies).toHaveLength(2)
    expect(state.combat?.moveRemaining).toBe(3)

    const beforeMove = state
    state = applyAction(state, { type: 'move', to: { x: 18, z: 3 } })
    expect(state.combat?.turn).toBe(beforeMove.combat?.turn)
    expect(state.combat?.moveRemaining).toBeCloseTo(2)

    state = applyAction(state, { type: 'recall', targetId: 'shade-1', quality: 1 })
    expect(state.combat?.turn).toBe(2)
    expect(state.combat?.enemies.find(({ id }) => id === 'shade-1')?.hp).toBe(0)
    state = applyAction(state, { type: 'recall', targetId: 'shade-2', quality: 1 })
    expect(state.combat).toBeNull()
    expect(state.collected).toContain('skirmish-victory')
    expect(state.gold).toBe(8)
    expect(canAction(state, { type: 'enterBattle', kind: 'skirmish' }).ok).toBe(false)
  })

  it.each([
    ['west', { x: 14.5, z: 3 }],
    ['east', { x: 19.5, z: 3 }],
    ['north', { x: 17, z: 5.5 }],
    ['south', { x: 17, z: 0.5 }],
  ] as const)('spawns a walkable, unoccupied skirmish formation when approached from the %s', (_side, position) => {
    const state = applyAction(prepared({ position: { ...position } }), { type: 'enterBattle', kind: 'skirmish' })
    const enemies = state.combat?.enemies ?? []
    expect(enemies).toHaveLength(2)
    expect(enemies.every((enemy) => isWalkable(enemy.position, true))).toBe(true)
    expect(enemies.every((enemy) => distance(enemy.position, state.position) >= 1.2)).toBe(true)
    expect(distance(enemies[0].position, enemies[1].position)).toBeGreaterThanOrEqual(1.2)
    expect(canAction(state, { type: 'move', to: enemies[0].position })).toEqual({
      ok: false,
      reason: 'A living enemy occupies that ground.',
    })
  })

  it('telegraphs guardian damage so movement avoids it, while stationary play is survivable', () => {
    let state = prepared({ position: { x: 25, z: -12 }, renewed: ['stone-1', 'stone-2', 'stone-3'], collected: ['skirmish-victory'], chapter: 'guardian' })
    state = applyAction(state, { type: 'enterBattle', kind: 'guardian' })
    expect(state.combat?.telegraph).toEqual({ x: 25, z: -12 })

    state = applyAction(state, { type: 'move', to: { x: 25, z: -9 } })
    state = applyAction(state, { type: 'recall', targetId: 'road-guardian', quality: 1 })
    expect(state.hp).toBe(12)
    expect(state.combat?.telegraph).toEqual({ x: 25, z: -9 })

    state = applyAction(state, { type: 'recall', targetId: 'road-guardian', quality: 1 })
    expect(state.hp).toBe(7)
    state = applyAction(state, { type: 'recall', targetId: 'road-guardian', quality: 0.5 })
    expect(state.combat).toBeNull()
    expect(state.chapter).toBe('return')
    expect(state.gold).toBe(25)
  })

  it('blocks a route through a living enemy even when its destination is clear', () => {
    let state = applyAction(prepared({ position: { x: 17, z: 3 } }), { type: 'enterBattle', kind: 'skirmish' })
    state = { ...state, combat: { ...state.combat!, enemies: [{ id: 'shade-1', position: { x: 18, z: 3.4 }, hp: 5, maxHp: 5 }] } }
    expect(canAction(state, { type: 'move', to: { x: 19, z: 3 } })).toEqual({ ok: false, reason: 'A living enemy blocks that route.' })
    expect(canAction(state, { type: 'move', to: { x: 17, z: 5 } }).ok).toBe(true)
    const cleared = { ...state, combat: { ...state.combat!, enemies: [{ ...state.combat!.enemies[0], hp: 0 }] } }
    expect(canAction(cleared, { type: 'move', to: { x: 19, z: 3 } }).ok).toBe(true)
  })

  it('supports guarding, limited companion healing, retreat, and defeat without story loss', () => {
    let state = prepared({ position: { x: 17, z: 3 }, hp: 6 })
    state = applyAction(state, { type: 'enterBattle', kind: 'skirmish' })
    const battleOrigin = state.position
    state = applyAction(state, { type: 'companionHeal' })
    expect(state.embers).toBe(1)
    expect(state.hp).toBeGreaterThanOrEqual(7)
    state = applyAction(state, { type: 'guard' })
    expect(state.combat?.turn).toBe(3)
    state = applyAction(state, { type: 'retreat' })
    expect(state.combat).toBeNull()
    expect(state.position).toEqual(battleOrigin)

    state = prepared({ position: { x: 17, z: 3 }, hp: 1 })
    state = applyAction(state, { type: 'enterBattle', kind: 'skirmish' })
    state = applyAction(state, { type: 'endTurn' })
    expect(state.combat).toBeNull()
    expect(state.position).toEqual({ x: -8, z: 0 })
    expect(state.learned).toEqual(['source-a', 'source-b', 'source-c'])
    expect(state.renewed).toEqual(['stone-1', 'stone-2'])
  })

  it('completes at the hearth once and starts a reward-safe repeat patrol', () => {
    let state = prepared({
      position: { x: -8, z: 0 },
      chapter: 'return',
      renewed: ['stone-1', 'stone-2', 'stone-3'],
      collected: ['chest', 'skirmish-victory', 'guardian-victory'],
      gold: 33,
    })
    state = applyAction(state, { type: 'returnHome' })
    expect(state.chapter).toBe('complete')
    expect(state.completedRuns).toBe(1)
    expect(state.gold).toBe(45)
    expect(applyAction(state, { type: 'returnHome' })).toBe(state)

    const patrol = applyAction(state, { type: 'startPatrol' })
    expect(patrol.chapter).toBe('road')
    expect(patrol.renewed).toEqual([])
    expect(patrol.learned).toEqual(state.learned)
    expect(patrol.gold).toBe(45)
    expect(patrol.completedRuns).toBe(1)
    expect(patrol.collected).toEqual(['chest'])
  })

  it('validates and clones saves while rejecting unknown versions, NaN, and out-of-bounds data', () => {
    const source = prepared()
    const restored = restoreJourney(source)
    expect(restored).toEqual(source)
    expect(restored).not.toBe(source)
    expect(restored.learned).not.toBe(source.learned)

    expect(() => restoreJourney({ ...source, version: 2 })).toThrow(TypeError)
    expect(() => restoreJourney({ ...source, hp: Number.NaN })).toThrow(TypeError)
    expect(() => restoreJourney({ ...source, maxHp: 13 })).toThrow(TypeError)
    expect(() => restoreJourney({ ...source, maxHp: 22 })).toThrow(TypeError)
    expect(() => restoreJourney({ ...source, position: { x: 35, z: 0 } })).toThrow(TypeError)
    expect(() => restoreJourney({ ...source, renewed: ['stone-9'] })).toThrow(TypeError)
  })

  it('requires the road battle before the last waystone and guardian', () => {
    const unfinished = prepared({ position: { x: 24, z: -6 } })
    expect(canAction(unfinished, { type: 'renew', stoneId: 'stone-3', quality: 1 })).toEqual({ ok: false, reason: 'Clear the road shades at the second waystone first.' })
    expect(applyAction(unfinished, { type: 'renew', stoneId: 'stone-3', quality: 1 })).toBe(unfinished)
    expect(canAction({ ...unfinished, renewed: ['stone-1', 'stone-2', 'stone-3'], position: { x: 27, z: -12 } }, { type: 'enterBattle', kind: 'guardian' }).ok).toBe(false)
    const cleared = { ...unfinished, collected: ['skirmish-victory'] }
    expect(applyAction(cleared, { type: 'renew', stoneId: 'stone-3', quality: 1 }).chapter).toBe('guardian')
  })

  it('rejects incoherent progress without repairing or replacing the save', () => {
    const complete = prepared({ chapter: 'complete', renewed: ['stone-1', 'stone-2', 'stone-3'], collected: ['skirmish-victory', 'guardian-victory'], completedRuns: 1 })
    expect(restoreJourney(complete)).toEqual(complete)
    for (const invalid of [
      { ...complete, completedRuns: 0 },
      { ...complete, companion: false },
      { ...complete, collected: ['guardian-victory'] },
      { ...complete, renewed: ['stone-1', 'stone-2'] },
      { ...complete, chapter: 'road' },
      { ...freshJourney(), chapter: 'return' },
    ]) {
      const unchanged = structuredClone(invalid)
      expect(() => restoreJourney(invalid)).toThrow(TypeError)
      expect(invalid).toEqual(unchanged)
    }
    const battle = applyAction(prepared({ position: { x: 17, z: 3 } }), { type: 'enterBattle', kind: 'skirmish' })
    expect(restoreJourney(battle)).toEqual(battle)
    expect(() => restoreJourney({ ...complete, combat: battle.combat })).toThrow(TypeError)
    expect(() => restoreJourney({ ...battle, combat: { ...battle.combat!, enemies: battle.combat!.enemies.map(enemy => ({ ...enemy, hp: 0 })) } })).toThrow(TypeError)
    expect(() => restoreJourney({ ...battle, embers: 0 })).toThrow(TypeError)
  })

  it.each([12, 14, 16, 18, 20])('restores the supported %i maximum health save', (maxHp) => {
    expect(restoreJourney({ ...prepared(), hp: maxHp - 1, maxHp })).toMatchObject({ hp: maxHp - 1, maxHp })
  })

  it('treats obstacle coordinate edges as cover boundaries', () => {
    expect(hasCoverBetween({ x: -15, z: -6 }, { x: -5, z: -6 })).toBe(true)
    expect(hasCoverBetween({ x: -21, z: -0.08 }, { x: -5, z: -0.08 })).toBe(false)
  })
})
