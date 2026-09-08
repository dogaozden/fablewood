import {
  distance,
  findPath,
  isNearLandmark,
  isWalkable,
  landmarkById,
  pathDistance,
  STATIC_OBSTACLES,
  WORLD_BOUNDS,
  type LandmarkId,
  type Point,
  type StaticObstacle,
} from './navigation'

export type Chapter = 'arrival' | 'road' | 'guardian' | 'return' | 'complete'
export type RecallQuality = 0 | 0.5 | 1
export type BattleKind = 'skirmish' | 'guardian'
export type StoneId = 'stone-1' | 'stone-2' | 'stone-3'

export type Enemy = {
  id: string
  position: Point
  hp: number
  maxHp: number
}

export type Combat = {
  kind: BattleKind
  origin: Point
  enemies: Enemy[]
  turn: number
  moveRemaining: number
  guard: boolean
  companionHeals: number
  telegraph: Point | null
}

export type Journey = {
  version: 1
  position: Point
  companion: boolean
  renewed: string[]
  learned: string[]
  collected: string[]
  chapter: Chapter
  hp: number
  maxHp: number
  insight: number
  embers: number
  gold: number
  completedRuns: number
  combat: Combat | null
  log: string[]
}

export type Action =
  | { type: 'move'; to: Point }
  | { type: 'recruit' }
  | { type: 'learn'; factId: string }
  | { type: 'renew'; stoneId: StoneId; quality: RecallQuality; amendedFirstMiss?: boolean }
  | { type: 'collectChest' }
  | { type: 'rest' }
  | { type: 'reinforceCloak' }
  | { type: 'enterBattle'; kind: BattleKind }
  | { type: 'attack'; targetId: string }
  | { type: 'recall'; targetId: string; quality: RecallQuality }
  | { type: 'guard' }
  | { type: 'companionHeal' }
  | { type: 'endTurn' }
  | { type: 'retreat' }
  | { type: 'returnHome' }
  | { type: 'startPatrol' }

export type ActionCheck = { ok: true } | { ok: false; reason: string }

export const EXPLORATION_MOVE_LIMIT = 4
export const COMBAT_MOVE_BUDGET = 3
export const MAX_EMBERS = 2
export const MELEE_RANGE = 2
export const RECALL_RANGE = 7
export const ENEMY_BODY_RADIUS = 0.6

const START_POSITION: Point = { x: -8, z: 0 }
const STONES: readonly StoneId[] = ['stone-1', 'stone-2', 'stone-3']
const CLOAK_MAX_HP_VALUES: readonly number[] = [12, 14, 16, 18, 20]
const VICTORY_KEY: Record<BattleKind, string> = {
  skirmish: 'skirmish-victory',
  guardian: 'guardian-victory',
}

export const freshJourney = (): Journey => ({
  version: 1,
  position: { ...START_POSITION },
  companion: false,
  renewed: [],
  learned: [],
  collected: [],
  chapter: 'arrival',
  hp: 12,
  maxHp: 12,
  insight: 0,
  embers: MAX_EMBERS,
  gold: 0,
  completedRuns: 0,
  combat: null,
  log: ['You arrive at the lantern hearth.'],
})

const fail = (reason: string): ActionCheck => ({ ok: false, reason })
const inBattle = (journey: Journey): ActionCheck | null => journey.combat ? fail('Finish or retreat from the battle first.') : null
const notInBattle = (journey: Journey): ActionCheck | null => journey.combat ? null : fail('There is no active battle.')
const bridgeOpen = (journey: Journey): boolean => journey.renewed.includes('stone-1')
const targetEnemy = (journey: Journey, id: string): Enemy | undefined => journey.combat?.enemies.find((enemy) => enemy.id === id && enemy.hp > 0)

export const cloakUpgradeCost = (journey: Journey): number | null =>
  journey.maxHp >= 20 ? null : 12 + (journey.maxHp - 12) * 3

const canMove = (journey: Journey, to: Point): ActionCheck => {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return fail('Choose a finite destination.')
  if (!isWalkable(to, bridgeOpen(journey))) return fail('That ground cannot be crossed.')
  if (journey.combat?.enemies.some((enemy) => enemy.hp > 0 && distance(to, enemy.position) < ENEMY_BODY_RADIUS)) {
    return fail('A living enemy occupies that ground.')
  }
  const path = findPath(journey.position, to, bridgeOpen(journey))
  if (path.length === 0) return fail('No open route reaches that point.')
  if (journey.combat?.enemies.some((enemy) => enemy.hp > 0 && path.slice(1).some((point, index) => {
    const from = path[index]
    const dx = point.x - from.x, dz = point.z - from.z
    const lengthSquared = dx * dx + dz * dz
    const t = lengthSquared ? Math.max(0, Math.min(1, ((enemy.position.x - from.x) * dx + (enemy.position.z - from.z) * dz) / lengthSquared)) : 0
    return distance(enemy.position, { x: from.x + t * dx, z: from.z + t * dz }) < ENEMY_BODY_RADIUS
  }))) return fail('A living enemy blocks that route.')
  const length = pathDistance(path)
  const limit = journey.combat?.moveRemaining ?? EXPLORATION_MOVE_LIMIT
  if (length > limit + 0.001) return fail(journey.combat ? 'That exceeds this turn’s movement.' : 'Move in shorter steps along the route.')
  return { ok: true }
}

const canRenew = (journey: Journey, stoneId: StoneId): ActionCheck => {
  const combatCheck = inBattle(journey)
  if (combatCheck) return combatCheck
  if (!journey.companion) return fail('Mira must travel with you to renew the road.')
  if (!isNearLandmark(journey.position, stoneId)) return fail('Stand beside this waystone first.')
  if (journey.renewed.includes(stoneId)) return fail('This waystone is already renewed.')
  const stoneIndex = STONES.indexOf(stoneId)
  if (stoneIndex > 0 && !journey.renewed.includes(STONES[stoneIndex - 1])) return fail('Renew the earlier waystone first.')
  if (stoneId === 'stone-3' && !journey.collected.includes(VICTORY_KEY.skirmish)) return fail('Clear the road shades at the second waystone first.')
  if (journey.learned.length === 0) return fail('Learn a source before attempting this waystone.')
  return { ok: true }
}

export const canAction = (journey: Journey, action: Action): ActionCheck => {
  switch (action.type) {
    case 'move':
      return canMove(journey, action.to)
    case 'recruit': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (journey.companion) return fail('Mira is already travelling with you.')
      return isNearLandmark(journey.position, 'mira') ? { ok: true } : fail('Find Mira in the hamlet first.')
    }
    case 'learn': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (!action.factId || action.factId !== action.factId.trim()) return fail('A source needs a stable fact id.')
      if (journey.learned.includes(action.factId)) return fail('That source has already been learned.')
      const byAStone = STONES.some((stoneId) => isNearLandmark(journey.position, stoneId))
      return byAStone ? { ok: true } : fail('Read this source beside a waystone.')
    }
    case 'renew':
      return canRenew(journey, action.stoneId)
    case 'collectChest': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (!bridgeOpen(journey)) return fail('The renewed bridge leads to this cache.')
      if (!isNearLandmark(journey.position, 'chest')) return fail('Stand beside the chest first.')
      return journey.collected.includes('chest') ? fail('The chest is already empty.') : { ok: true }
    }
    case 'rest': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      return isNearLandmark(journey.position, 'hearth') ? { ok: true } : fail('Return to the hearth to rest.')
    }
    case 'reinforceCloak': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (!isNearLandmark(journey.position, 'hearth')) return fail('Return to the hearth to reinforce your cloak.')
      const cost = cloakUpgradeCost(journey)
      if (cost === null) return fail('Your hearth-cloak is fully reinforced.')
      return journey.gold >= cost ? { ok: true } : fail(`Reinforcing your hearth-cloak costs ${cost} gold.`)
    }
    case 'enterBattle': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (journey.collected.includes(VICTORY_KEY[action.kind])) return fail('This threat has already been cleared on this patrol.')
      if (action.kind === 'skirmish') {
        if (!journey.renewed.includes('stone-2')) return fail('Renew the second waystone before facing the road shades.')
        return isNearLandmark(journey.position, 'stone-2') ? { ok: true } : fail('The road shades gather near the second waystone.')
      }
      if (!journey.renewed.includes('stone-3')) return fail('Renew the third waystone before challenging the guardian.')
      if (!journey.collected.includes(VICTORY_KEY.skirmish)) return fail('Clear the road shades before challenging the guardian.')
      return isNearLandmark(journey.position, 'guardian') ? { ok: true } : fail('Reach the ruined gate to challenge its guardian.')
    }
    case 'attack': {
      const battleCheck = notInBattle(journey)
      if (battleCheck) return battleCheck
      const enemy = targetEnemy(journey, action.targetId)
      if (!enemy) return fail('Choose a living enemy.')
      return distance(journey.position, enemy.position) <= MELEE_RANGE ? { ok: true } : fail('Move within melee range first.')
    }
    case 'recall': {
      const battleCheck = notInBattle(journey)
      if (battleCheck) return battleCheck
      if (journey.learned.length === 0) return fail('Learn a source before using recall.')
      const enemy = targetEnemy(journey, action.targetId)
      if (!enemy) return fail('Choose a living enemy.')
      return distance(journey.position, enemy.position) <= RECALL_RANGE ? { ok: true } : fail('Move within recall range first.')
    }
    case 'guard':
    case 'endTurn':
      return notInBattle(journey) ?? { ok: true }
    case 'companionHeal': {
      const battleCheck = notInBattle(journey)
      if (battleCheck) return battleCheck
      if (!journey.companion) return fail('You need a companion for this action.')
      if (journey.embers <= 0) return fail('No companion embers remain.')
      if ((journey.combat?.companionHeals ?? 0) <= 0) return fail('Mira has already spent her embers in this battle.')
      return journey.hp < journey.maxHp ? { ok: true } : fail('You are already at full health.')
    }
    case 'retreat':
      return notInBattle(journey) ?? { ok: true }
    case 'returnHome': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      if (journey.chapter !== 'return') return fail('The guardian road has not been restored yet.')
      return isNearLandmark(journey.position, 'hearth') ? { ok: true } : fail('Return to the hearth to finish the chapter.')
    }
    case 'startPatrol': {
      const combatCheck = inBattle(journey)
      if (combatCheck) return combatCheck
      return journey.chapter === 'complete' ? { ok: true } : fail('Complete the chapter before beginning a patrol.')
    }
  }
}

const addLog = (journey: Journey, message: string): Journey => ({ ...journey, log: [...journey.log, message].slice(-12) })

const respawnAfterDefeat = (journey: Journey): Journey => addLog({
  ...journey,
  position: { ...START_POSITION },
  hp: journey.maxHp,
  embers: MAX_EMBERS,
  combat: null,
}, 'The hearth-light gathers you home. Your journey remains.')

const hurtPlayer = (journey: Journey, damage: number): Journey => {
  const hp = Math.max(0, journey.hp - Math.max(0, damage))
  return hp === 0 ? respawnAfterDefeat({ ...journey, hp }) : { ...journey, hp }
}

const pointAlong = (from: Point, to: Point, amount: number): Point => {
  const length = distance(from, to)
  if (length <= amount || length === 0) return { ...to }
  return { x: from.x + ((to.x - from.x) / length) * amount, z: from.z + ((to.z - from.z) / length) * amount }
}

const segmentIntersects = (from: Point, to: Point, obstacle: StaticObstacle): boolean => {
  const length = distance(from, to)
  const samples = Math.max(1, Math.ceil(length / 0.25))
  for (let index = 1; index < samples; index += 1) {
    const amount = index / samples
    const point = { x: from.x + (to.x - from.x) * amount, z: from.z + (to.z - from.z) * amount }
    if (obstacle.kind === 'circle') {
      if (distance(point, obstacle.center) < obstacle.radius) return true
    } else if (point.x > obstacle.minX && point.x < obstacle.maxX && point.z > obstacle.minZ && point.z < obstacle.maxZ) {
      return true
    }
  }
  return false
}

export const hasCoverBetween = (from: Point, to: Point): boolean => STATIC_OBSTACLES.some((obstacle) => segmentIntersects(from, to, obstacle))

const enemyTurn = (journey: Journey): Journey => {
  const combat = journey.combat
  if (!combat) return journey
  let damage = 0
  let enemies = combat.enemies.map((enemy) => ({ ...enemy, position: { ...enemy.position } }))

  if (combat.kind === 'guardian') {
    const guardian = enemies.find((enemy) => enemy.hp > 0)
    if (guardian && combat.telegraph && distance(journey.position, combat.telegraph) <= 1.6) {
      damage += hasCoverBetween(guardian.position, journey.position) ? 2 : 5
    }
    if (guardian && distance(guardian.position, journey.position) > 4) {
      const next = pointAlong(guardian.position, journey.position, 1)
      if (isWalkable(next, true)) guardian.position = next
    }
  } else {
    enemies = enemies.map((enemy) => {
      if (enemy.hp <= 0) return enemy
      let nextEnemy = enemy
      if (distance(enemy.position, journey.position) > 2.2) {
        const next = pointAlong(enemy.position, journey.position, 1.5)
        if (isWalkable(next, true)) nextEnemy = { ...enemy, position: next }
      }
      if (distance(nextEnemy.position, journey.position) <= 2.2) {
        const rawDamage = nextEnemy.id === 'shade-1' ? 2 : 1
        damage += hasCoverBetween(nextEnemy.position, journey.position) ? Math.max(0, rawDamage - 1) : rawDamage
      }
      return nextEnemy
    })
  }

  if (combat.guard) damage = Math.floor(damage / 2)
  const advanced: Journey = {
    ...journey,
    combat: {
      ...combat,
      enemies,
      turn: combat.turn + 1,
      moveRemaining: COMBAT_MOVE_BUDGET,
      guard: false,
      telegraph: combat.kind === 'guardian' ? { ...journey.position } : null,
    },
  }
  const result = hurtPlayer(advanced, damage)
  return damage > 0 && result.combat ? addLog(result, `Enemies deal ${damage} damage.`) : result
}

const resolveVictory = (journey: Journey): Journey => {
  const combat = journey.combat
  if (!combat || combat.enemies.some((enemy) => enemy.hp > 0)) return enemyTurn(journey)
  const key = VICTORY_KEY[combat.kind]
  if (combat.kind === 'guardian') {
    return addLog({
      ...journey,
      combat: null,
      chapter: 'return',
      collected: journey.collected.includes(key) ? journey.collected : [...journey.collected, key],
      gold: journey.gold + 25,
      insight: journey.insight + 2,
    }, 'The guardian yields. Carry the road-light home.')
  }
  return addLog({
    ...journey,
    combat: null,
    collected: journey.collected.includes(key) ? journey.collected : [...journey.collected, key],
    gold: journey.gold + 8,
    embers: Math.min(MAX_EMBERS, journey.embers + 1),
  }, 'The road shades scatter, leaving a small reward.')
}

const strikeEnemy = (journey: Journey, targetId: string, damage: number, message: string): Journey => {
  if (!journey.combat) return journey
  const enemies = journey.combat.enemies.map((enemy) => enemy.id === targetId ? { ...enemy, hp: Math.max(0, enemy.hp - damage) } : enemy)
  return resolveVictory(addLog({ ...journey, combat: { ...journey.combat, enemies } }, message))
}

const skirmishEnemies = (origin: Point): Enemy[] => {
  const center = landmarkById('stone-2').position
  const candidates: Point[] = [
    { x: center.x + 3, z: center.z },
    { x: center.x, z: center.z + 3 },
    { x: center.x - 3, z: center.z },
    { x: center.x, z: center.z - 3 },
    { x: center.x + 2.2, z: center.z + 2.2 },
    { x: center.x - 2.2, z: center.z - 2.2 },
  ]
  const positions: Point[] = []
  for (const candidate of candidates) {
    if (!isWalkable(candidate, true) || distance(candidate, origin) < ENEMY_BODY_RADIUS * 2) continue
    if (positions.some((position) => distance(position, candidate) < ENEMY_BODY_RADIUS * 2)) continue
    positions.push(candidate)
    if (positions.length === 2) break
  }
  if (positions.length !== 2) throw new Error('Skirmish arena has no valid enemy formation.')
  return positions.map((position, index) => ({
    id: `shade-${index + 1}`,
    position,
    hp: 5,
    maxHp: 5,
  }))
}

const enterBattle = (journey: Journey, kind: BattleKind): Journey => {
  const origin = { ...journey.position }
  const enemies: Enemy[] = kind === 'skirmish'
    ? skirmishEnemies(origin)
    : [{ id: 'road-guardian', position: { x: 29, z: -12 }, hp: 18, maxHp: 18 }]
  return addLog({
    ...journey,
    combat: {
      kind,
      origin,
      enemies,
      turn: 1,
      moveRemaining: COMBAT_MOVE_BUDGET,
      guard: false,
      companionHeals: journey.embers,
      telegraph: kind === 'guardian' ? { ...journey.position } : null,
    },
  }, kind === 'guardian' ? 'The guardian marks the ground beneath you.' : 'Two road shades close in.')
}

export const applyAction = (journey: Journey, action: Action): Journey => {
  if (!canAction(journey, action).ok) return journey

  switch (action.type) {
    case 'move': {
      const path = findPath(journey.position, action.to, bridgeOpen(journey))
      const moved = { ...journey, position: { ...action.to } }
      if (!journey.combat) return moved
      return { ...moved, combat: { ...journey.combat, moveRemaining: Math.max(0, journey.combat.moveRemaining - pathDistance(path)) } }
    }
    case 'recruit':
      return addLog({ ...journey, companion: true, chapter: 'road' }, 'Mira joins the journey.')
    case 'learn':
      return addLog({ ...journey, learned: [...journey.learned, action.factId], insight: journey.insight + 1 }, 'A new source kindles insight.')
    case 'renew': {
      if (action.quality === 0 && action.amendedFirstMiss) return addLog(journey, 'The Realm moved, not you. Read it again.')
      if (action.quality === 0) return addLog(hurtPlayer(journey, 2), 'The recall falters. You lose 2 health, but the waystone waits.')
      const renewed = [...journey.renewed, action.stoneId]
      const chapter: Chapter = action.stoneId === 'stone-3' ? 'guardian' : journey.chapter
      return addLog({ ...journey, renewed, chapter, insight: journey.insight + 1 }, action.quality === 1 ? 'The waystone answers with a clear flame.' : 'The waystone catches a steady ember.')
    }
    case 'collectChest':
      return addLog({ ...journey, collected: [...journey.collected, 'chest'], gold: journey.gold + 12, embers: Math.min(MAX_EMBERS, journey.embers + 1) }, 'The cache holds 12 gold and a companion ember.')
    case 'rest':
      return addLog({ ...journey, hp: journey.maxHp, embers: MAX_EMBERS }, 'The hearth restores health and companion embers.')
    case 'reinforceCloak': {
      const cost = cloakUpgradeCost(journey)
      if (cost === null) return journey
      const maxHp = journey.maxHp + 2
      return addLog({ ...journey, hp: Math.min(maxHp, journey.hp + 2), maxHp, gold: journey.gold - cost }, 'The hearth permanently reinforces your cloak.')
    }
    case 'enterBattle':
      return enterBattle(journey, action.kind)
    case 'attack':
      return strikeEnemy(journey, action.targetId, 3, 'Your strike deals 3 damage.')
    case 'recall': {
      const damage: Record<RecallQuality, number> = { 0: 1, 0.5: 4, 1: 8 }
      return strikeEnemy(journey, action.targetId, damage[action.quality], `Recall deals ${damage[action.quality]} damage.`)
    }
    case 'guard':
      return enemyTurn({ ...journey, combat: journey.combat ? { ...journey.combat, guard: true } : null })
    case 'companionHeal': {
      const healed = { ...journey, hp: Math.min(journey.maxHp, journey.hp + 4), embers: journey.embers - 1 }
      const withSpentEmber = journey.combat
        ? { ...healed, combat: { ...journey.combat, companionHeals: journey.combat.companionHeals - 1 } }
        : healed
      return enemyTurn(addLog(withSpentEmber, 'Mira restores 4 health.'))
    }
    case 'endTurn':
      return enemyTurn(journey)
    case 'retreat':
      return addLog({ ...journey, position: journey.combat ? { ...journey.combat.origin } : journey.position, combat: null }, 'You retreat. The threat regathers, but your progress remains.')
    case 'returnHome':
      return addLog({ ...journey, chapter: 'complete', completedRuns: journey.completedRuns + 1, gold: journey.gold + 12 }, 'The road-light returns to the hearth. The chapter is complete.')
    case 'startPatrol':
      return addLog({
        ...journey,
        position: { ...START_POSITION },
        renewed: [],
        collected: journey.collected.filter((id) => id !== VICTORY_KEY.skirmish && id !== VICTORY_KEY.guardian),
        chapter: 'road',
        hp: journey.maxHp,
        embers: MAX_EMBERS,
        combat: null,
      }, 'A new patrol begins along the darkened road.')
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonNegativeInteger = (value: unknown): value is number => isFiniteNumber(value) && Number.isInteger(value) && value >= 0
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isPoint = (value: unknown): value is Point => isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z)
const isChapter = (value: unknown): value is Chapter => ['arrival', 'road', 'guardian', 'return', 'complete'].includes(String(value))
const isBattleKind = (value: unknown): value is BattleKind => value === 'skirmish' || value === 'guardian'

const restoreEnemy = (value: unknown): Enemy => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isPoint(value.position) || !isFiniteNumber(value.hp) || !isFiniteNumber(value.maxHp)) {
    throw new TypeError('Invalid journey enemy.')
  }
  if (value.maxHp <= 0 || value.hp < 0 || value.hp > value.maxHp) throw new TypeError('Invalid journey enemy health.')
  if (!isInsideWorld(value.position)) throw new TypeError('Journey enemy is outside the world.')
  return { id: value.id, position: { ...value.position }, hp: value.hp, maxHp: value.maxHp }
}

const restoreCombat = (value: unknown): Combat | null => {
  if (value === null) return null
  if (!isRecord(value) || !isBattleKind(value.kind) || !isPoint(value.origin) || !Array.isArray(value.enemies)) throw new TypeError('Invalid journey combat.')
  if (!isInsideWorld(value.origin)) throw new TypeError('Journey combat origin is outside the world.')
  if (!isNonNegativeInteger(value.turn) || value.turn < 1 || !isFiniteNumber(value.moveRemaining) || value.moveRemaining < 0 || value.moveRemaining > COMBAT_MOVE_BUDGET) throw new TypeError('Invalid journey combat turn.')
  if (typeof value.guard !== 'boolean' || !isNonNegativeInteger(value.companionHeals) || value.companionHeals > MAX_EMBERS) throw new TypeError('Invalid journey combat resources.')
  if (value.enemies.length === 0) throw new TypeError('Journey combat requires an enemy.')
  if (value.telegraph !== null && !isPoint(value.telegraph)) throw new TypeError('Invalid journey combat telegraph.')
  if (value.telegraph && !isInsideWorld(value.telegraph)) throw new TypeError('Journey combat telegraph is outside the world.')
  return {
    kind: value.kind,
    origin: { ...value.origin },
    enemies: value.enemies.map(restoreEnemy),
    turn: value.turn,
    moveRemaining: value.moveRemaining,
    guard: value.guard,
    companionHeals: value.companionHeals,
    telegraph: value.telegraph ? { ...value.telegraph } : null,
  }
}

export const restoreJourney = (value: unknown): Journey => {
  if (!isRecord(value) || value.version !== 1) throw new TypeError('Unsupported or invalid journey version.')
  if (!isPoint(value.position)) throw new TypeError('Invalid journey position.')
  if (typeof value.companion !== 'boolean' || !isStringArray(value.renewed) || !isStringArray(value.learned) || !isStringArray(value.collected) || !isStringArray(value.log)) {
    throw new TypeError('Invalid journey collections.')
  }
  if (!value.renewed.every((id) => STONES.includes(id as StoneId)) || new Set(value.renewed).size !== value.renewed.length) throw new TypeError('Invalid renewed waystones.')
  if (!value.renewed.every((id, index) => id === STONES[index])) throw new TypeError('Waystones must form an ordered renewed path.')
  if (new Set(value.learned).size !== value.learned.length || new Set(value.collected).size !== value.collected.length) throw new TypeError('Journey collections contain duplicate ids.')
  if ([...value.learned, ...value.collected].some((id) => !id || id !== id.trim())) throw new TypeError('Journey ids must be non-empty and stable.')
  if (!isWalkable(value.position, value.renewed.includes('stone-1'))) throw new TypeError('Invalid journey position.')
  if (!isChapter(value.chapter) || !isFiniteNumber(value.hp) || !isFiniteNumber(value.maxHp) || !CLOAK_MAX_HP_VALUES.includes(value.maxHp) || value.hp <= 0 || value.hp > value.maxHp) {
    throw new TypeError('Invalid journey health or chapter.')
  }
  if (!isNonNegativeInteger(value.insight) || !isNonNegativeInteger(value.embers) || value.embers > MAX_EMBERS || !isNonNegativeInteger(value.gold) || !isNonNegativeInteger(value.completedRuns)) {
    throw new TypeError('Invalid journey resources.')
  }
  if (!value.log.every((entry) => entry.length <= 500)) throw new TypeError('Invalid journey log.')
  const combat = restoreCombat(value.combat)
  const roadCleared = value.collected.includes(VICTORY_KEY.skirmish)
  const guardianCleared = value.collected.includes(VICTORY_KEY.guardian)
  if ((value.chapter === 'arrival') !== !value.companion) throw new TypeError('Journey chapter and companion disagree.')
  if (value.renewed.length && (!value.companion || !value.learned.length)) throw new TypeError('Renewed road has no travelling memory.')
  if (roadCleared && value.renewed.length < 2) throw new TypeError('Road victory precedes its waystones.')
  if (value.renewed.length === 3 && !roadCleared) throw new TypeError('The final waystone requires a cleared road.')
  if (['guardian', 'return', 'complete'].includes(value.chapter) !== (value.renewed.length === 3)) throw new TypeError('Journey chapter and waystones disagree.')
  if (['return', 'complete'].includes(value.chapter) !== guardianCleared) throw new TypeError('Journey chapter and guardian victory disagree.')
  if (value.chapter === 'complete' && value.completedRuns === 0) throw new TypeError('A completed chapter requires a completed journey.')
  if (combat) {
    const expectedChapter = combat.kind === 'guardian' ? 'guardian' : 'road'
    if (value.chapter !== expectedChapter || value.renewed.length < 2 || value.collected.includes(VICTORY_KEY[combat.kind])) throw new TypeError('Combat does not belong to this chapter.')
    if ((combat.kind === 'guardian') !== (combat.telegraph !== null)) throw new TypeError('Combat telegraph does not match its guardian.')
    if (!combat.enemies.some(enemy => enemy.hp > 0) || new Set(combat.enemies.map(enemy => enemy.id)).size !== combat.enemies.length) throw new TypeError('Combat requires distinct living opponents.')
    if (combat.companionHeals !== value.embers) throw new TypeError('Combat and companion embers disagree.')
  }
  return {
    version: 1,
    position: { ...value.position },
    companion: value.companion,
    renewed: [...value.renewed],
    learned: [...value.learned],
    collected: [...value.collected],
    chapter: value.chapter,
    hp: value.hp,
    maxHp: value.maxHp,
    insight: value.insight,
    embers: value.embers,
    gold: value.gold,
    completedRuns: value.completedRuns,
    combat,
    log: [...value.log],
  }
}

export const isInsideWorld = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.z) &&
  point.x >= WORLD_BOUNDS.minX && point.x <= WORLD_BOUNDS.maxX && point.z >= WORLD_BOUNDS.minZ && point.z <= WORLD_BOUNDS.maxZ

export const interactionLandmark = (journey: Journey): LandmarkId | null => {
  const ids: readonly LandmarkId[] = ['hearth', 'mira', 'well', 'stone-1', 'stone-2', 'stone-3', 'guardian', 'chest']
  return ids.find((id) => isNearLandmark(journey.position, id)) ?? null
}
