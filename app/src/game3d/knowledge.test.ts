import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AmendmentsApi,
  DrawServiceApi,
  EncounterResult,
  SrsApi,
} from '../game/contracts'
import { services } from '../game/contracts'
import type { Encounter, EncounterKind, Fact, FactType, Pack } from '../packs/types'
import { freshJourney, type Journey } from './model'

const bridge = vi.hoisted(() => ({
  getPacks: vi.fn(),
  getStateStrict: vi.fn(),
  putState: vi.fn(),
}))

vi.mock('../bridge/client', () => bridge)

import {
  JOURNEY_FILE,
  chooseLesson,
  createJourneySaver,
  loadJourney,
  openArchive,
  recallLesson,
  type Lesson,
  type RealmArchive,
} from './knowledge'

const fact = (id: string, type: FactType = 'concept'): Fact => ({
  id,
  type,
  statement: `Neutral statement for ${id}.`,
  source_ref: {
    file: 'neutral-source.md',
    loc: 1,
    quote: `Neutral source line for ${id}.`,
  },
  as_of: '2026-09-07',
  source_version: '1.0.0',
  difficulty: 1,
})

const encounter = (
  id: string,
  factIds: string[],
  kind: EncounterKind = 'mcq',
): Encounter => ({
  id,
  fact_ids: factIds,
  kind,
  prompt: `Neutral prompt for ${id}.`,
})

const pack = (facts: Fact[], encounters: Encounter[]): Pack => ({
  meta: {
    id: 'neutral-pack',
    title: 'Neutral Field Notes',
    version: '1.0.0',
    sources: [{ title: 'Neutral Source' }],
  },
  facts,
  encounters,
  quests: [],
  metaphor_map: {},
})

const archiveFor = (facts: Fact[], encounters: Encounter[]): RealmArchive => ({
  packs: [pack(facts, encounters)],
  practice: false,
  count: facts.length,
})

const amendments = (suspended: ReadonlySet<string> = new Set()): AmendmentsApi => ({
  async ready() {},
  isWitnessed: () => false,
  isSuspended: (id) => suspended.has(id),
  eligible: (ids) => ids.filter((id) => !suspended.has(id)),
  pending: () => [],
  async witness() {},
  firstAmendedAppearance: () => null,
})

type DrawSetup = {
  due?: string[]
  fresh?: string[]
  all?: string[]
  facts?: Fact[]
  encounters?: Encounter[]
}

const installDraw = ({
  due = [],
  fresh = [],
  all = [],
  facts = [],
  encounters = [],
}: DrawSetup = {}) => {
  const factsById = new Map(facts.map((entry) => [entry.id, entry]))
  const encountersByFact = new Map<string, Encounter[]>()
  for (const entry of encounters) {
    for (const factId of entry.fact_ids) {
      const indexed = encountersByFact.get(factId) ?? []
      indexed.push(entry)
      encountersByFact.set(factId, indexed)
    }
  }
  const draw = {
    ready: vi.fn(async () => {}),
    indexReady: vi.fn(async () => {}),
    due: vi.fn(() => [...due]),
    fresh: vi.fn(() => [...fresh]),
    allFactIds: vi.fn(() => [...all]),
    sourceOf: vi.fn((factId: string) => factsById.has(factId) ? 'neutral-pack' : undefined),
    factOf: vi.fn((factId: string) => factsById.get(factId)),
    encountersOf: vi.fn((factId: string) => encountersByFact.get(factId) ?? []),
    isEmpty: vi.fn(() => facts.length === 0),
  } satisfies DrawServiceApi
  services.draw = draw
  return draw
}

const fakeSrs = (record = vi.fn(async () => {})): SrsApi => ({
  async ready() {},
  dueQueue: () => [],
  record,
  boxOf: () => 0,
  masteryAvg: () => 0,
  historyQualities: () => [],
  hasRecord: () => false,
  nextDueOf: () => undefined,
})

const resultFor = (factIds: string[]): EncounterResult => ({
  encounterId: 'neutral-encounter',
  kind: 'mcq',
  factIds,
  quality: 1,
})

const lessonFor = (facts: Fact[], practice = false): Lesson => ({
  fact: facts[0],
  facts,
  encounter: encounter('neutral-encounter', facts.map(({ id }) => id)),
  packId: practice ? '__fixture__' : 'neutral-pack',
  sourceTitle: practice ? 'Invented neutral practice' : 'Neutral Field Notes',
  practice,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  bridge.getPacks.mockReset()
  bridge.getStateStrict.mockReset()
  bridge.putState.mockReset()
  bridge.getPacks.mockResolvedValue({ packs: [] })
  bridge.getStateStrict.mockResolvedValue({ status: 'absent' })
  bridge.putState.mockResolvedValue(true)
  services.amendments = amendments()
  services.srs = fakeSrs()
  services.runEncounter = vi.fn(async () => resultFor([]))
  vi.spyOn(Date, 'now').mockReturnValue(123_456)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('chooseLesson', () => {
  it('uses due facts before fresh facts and the revisit pool', async () => {
    const dueFact = fact('neutral-due')
    const freshFact = fact('neutral-fresh')
    const revisitFact = fact('neutral-revisit')
    const encounters = [
      encounter('due-question', [dueFact.id]),
      encounter('fresh-question', [freshFact.id]),
      encounter('revisit-question', [revisitFact.id]),
    ]
    const draw = installDraw({
      due: [dueFact.id],
      fresh: [freshFact.id],
      all: [revisitFact.id],
      facts: [dueFact, freshFact, revisitFact],
      encounters,
    })

    const lesson = await chooseLesson(
      archiveFor([dueFact, freshFact, revisitFact], encounters),
      7,
      [],
      ['mcq'],
    )

    expect(lesson?.fact.id).toBe(dueFact.id)
    expect(draw.due).toHaveBeenCalledWith({ count: 20, seed: 7, now: 123_456, kinds: ['mcq'] })
    expect(draw.fresh).toHaveBeenCalledWith({ count: 20, seed: 7, now: 123_456, kinds: ['mcq'] })
  })

  it('falls through from unusable due candidates to fresh, then to deterministic revisits', async () => {
    const unusableDue = fact('neutral-due')
    const freshFact = fact('neutral-fresh')
    const revisitFact = fact('neutral-revisit')
    const freshEncounter = encounter('fresh-question', [freshFact.id])
    const revisitEncounter = encounter('revisit-question', [revisitFact.id])
    const allFacts = [unusableDue, freshFact, revisitFact]

    installDraw({
      due: [unusableDue.id],
      fresh: [freshFact.id],
      all: [revisitFact.id],
      facts: allFacts,
      encounters: [freshEncounter, revisitEncounter],
    })
    expect((await chooseLesson(archiveFor(allFacts, [freshEncounter, revisitEncounter]), 2))?.fact.id)
      .toBe(freshFact.id)

    installDraw({
      due: [unusableDue.id],
      all: [revisitFact.id],
      facts: allFacts,
      encounters: [revisitEncounter],
    })
    expect((await chooseLesson(archiveFor(allFacts, [revisitEncounter]), 2))?.fact.id)
      .toBe(revisitFact.id)
  })

  it('rejects encounters with missing or suspended supporting facts and preserves valid fact order', async () => {
    const lead = fact('neutral-lead')
    const suspended = fact('neutral-suspended')
    const supportB = fact('neutral-support-b', 'rule')
    const supportA = fact('neutral-support-a', 'number')
    const invalidMissing = encounter('missing-support', [lead.id, 'neutral-missing'])
    const invalidSuspended = encounter('suspended-support', [lead.id, suspended.id])
    const valid = encounter('valid-support', [supportB.id, lead.id, supportA.id])
    const facts = [lead, suspended, supportA, supportB]
    const encounters = [invalidMissing, invalidSuspended, valid]
    installDraw({ due: [lead.id], all: facts.map(({ id }) => id), facts, encounters })
    services.amendments = amendments(new Set([suspended.id]))

    const lesson = await chooseLesson(archiveFor(facts, encounters), 0)

    expect(lesson?.encounter.id).toBe(valid.id)
    expect(lesson?.facts.map(({ id }) => id)).toEqual([supportB.id, lead.id, supportA.id])
    expect(lesson?.fact.id).toBe(lead.id)
  })

  it('keeps exclusions while another fact is available, then releases them when a small pack is exhausted', async () => {
    const first = fact('neutral-first')
    const second = fact('neutral-second')
    const encounters = [encounter('first-question', [first.id]), encounter('second-question', [second.id])]
    let draw = installDraw({
      due: [first.id],
      fresh: [second.id],
      all: [first.id, second.id],
      facts: [first, second],
      encounters,
    })

    expect((await chooseLesson(archiveFor([first, second], encounters), 1, [first.id]))?.fact.id)
      .toBe(second.id)
    expect(draw.due).toHaveBeenCalledTimes(1)

    const onlyEncounter = encounter('only-question', [first.id])
    draw = installDraw({
      due: [first.id],
      all: [first.id],
      facts: [first],
      encounters: [onlyEncounter],
    })
    expect((await chooseLesson(archiveFor([first], [onlyEncounter]), 1, [first.id]))?.fact.id)
      .toBe(first.id)
    expect(draw.due).toHaveBeenCalledTimes(2)
    expect(draw.fresh).toHaveBeenCalledTimes(2)
  })

  it('scans past more than twenty excluded due facts before considering fresh material', async () => {
    const excluded = Array.from({ length: 21 }, (_, index) => fact(`neutral-known-${index}`))
    const hiddenDue = fact('neutral-hidden-due')
    const freshFact = fact('neutral-fresh')
    const suspendedSupport = fact('neutral-suspended-support')
    const unusableDue = fact('neutral-unusable-due')
    const validEncounter = encounter('hidden-due-question', [hiddenDue.id])
    const freshEncounter = encounter('fresh-question', [freshFact.id])
    const invalidEncounter = encounter('suspended-support-question', [unusableDue.id, suspendedSupport.id])
    const facts = [...excluded, unusableDue, hiddenDue, freshFact, suspendedSupport]
    const dueIds = [...excluded.map(({ id }) => id), unusableDue.id, hiddenDue.id]
    const draw = installDraw({
      due: dueIds,
      fresh: [freshFact.id],
      all: facts.map(({ id }) => id),
      facts,
      encounters: [invalidEncounter, validEncounter, freshEncounter],
    })
    services.amendments = amendments(new Set([suspendedSupport.id]))

    const lesson = await chooseLesson(
      archiveFor(facts, [invalidEncounter, validEncounter, freshEncounter]),
      3,
      excluded.map(({ id }) => id),
    )

    expect(lesson?.fact.id).toBe(hiddenDue.id)
    expect(lesson?.encounter.id).toBe(validEncounter.id)
    expect(draw.due).toHaveBeenCalledWith({ count: facts.length, seed: 3, now: 123_456, kinds: undefined })
    expect(draw.fresh).toHaveBeenCalledWith({ count: facts.length, seed: 3, now: 123_456, kinds: undefined })
  })

  it('opens zero installed packs as explicitly labeled, neutral invented practice', async () => {
    installDraw()
    const archive = await openArchive()
    const lesson = await chooseLesson(archive, 0, [], ['match'])

    expect(archive).toEqual({ packs: [], practice: true, count: 0 })
    expect(lesson?.practice).toBe(true)
    expect(lesson?.packId).toBe('__fixture__')
    expect(lesson?.sourceTitle).toContain('invented practice')
    expect(lesson?.encounter.kind).toBe('match')
    expect(lesson?.facts.map(({ id }) => id)).toEqual(lesson?.encounter.fact_ids)
  })
})

describe('recallLesson', () => {
  it('checks amended first-miss mercy before recording consumes the first appearance', async () => {
    const source = fact('neutral-revised')
    installDraw({ facts: [source] })
    let recorded = false
    services.amendments = { ...amendments(), firstAmendedAppearance: () => recorded ? null : source.id }
    services.srs = fakeSrs(vi.fn(async () => { recorded = true }))
    services.runEncounter = vi.fn(async () => ({ ...resultFor([source.id]), quality: 0 as const }))
    expect((await recallLesson(lessonFor([source]), 1, 'drill')).amendedFirstMiss).toBe(true)
    expect((await recallLesson(lessonFor([source]), 2, 'drill')).amendedFirstMiss).toBeUndefined()
  })

  it('records each unique, resolvable, eligible result fact in result order', async () => {
    const lead = fact('neutral-lead', 'concept')
    const support = fact('neutral-support', 'rule')
    const suspended = fact('neutral-suspended', 'advice')
    installDraw({ facts: [lead, support, suspended] })
    services.amendments = amendments(new Set([suspended.id]))
    const record = vi.fn(async () => {})
    services.srs = fakeSrs(record)
    services.runEncounter = vi.fn(async () => resultFor([
      lead.id,
      lead.id,
      support.id,
      suspended.id,
      'neutral-missing',
    ]))

    await recallLesson(lessonFor([lead, support]), 19, 'combat')

    expect(record.mock.calls).toEqual([
      [lead.id, 1, 'neutral-encounter', lead.type],
      [support.id, 1, 'neutral-encounter', support.type],
    ])
  })

  it('preserves the current sequential boundary when a later SRS write rejects', async () => {
    const first = fact('neutral-first')
    const second = fact('neutral-second')
    installDraw({ facts: [first, second] })
    const failure = new Error('isolated persistence failure')
    const record = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
    services.srs = fakeSrs(record)
    services.runEncounter = vi.fn(async () => resultFor([first.id, second.id]))

    await expect(recallLesson(lessonFor([first, second]), 5, 'drill')).rejects.toBe(failure)
    expect(record.mock.calls.map(([factId]) => factId)).toEqual([first.id, second.id])
  })

  it('does not persist invented practice or unanswered redraws', async () => {
    const neutral = fact('neutral-practice')
    installDraw({ facts: [neutral] })
    const record = vi.fn(async () => {})
    services.srs = fakeSrs(record)
    services.runEncounter = vi.fn()
      .mockResolvedValueOnce(resultFor([neutral.id]))
      .mockResolvedValueOnce({
        ...resultFor([]),
        redraw: { shownFactIds: [neutral.id] },
      })

    await recallLesson(lessonFor([neutral], true), 1, 'drill')
    await recallLesson(lessonFor([neutral]), 2, 'combat')
    expect(record).not.toHaveBeenCalled()
  })
})

describe('loadJourney', () => {
  it('creates a fresh journey only for an explicit absent result', async () => {
    bridge.getStateStrict.mockResolvedValue({ status: 'absent' })

    expect(await loadJourney()).toEqual(freshJourney())
    expect(bridge.getStateStrict).toHaveBeenCalledWith(JOURNEY_FILE)
    expect(bridge.putState).not.toHaveBeenCalled()
  })

  it('restores a found journey without sharing mutable collections', async () => {
    const saved = { ...freshJourney(), learned: ['neutral-known'], gold: 8 }
    bridge.getStateStrict.mockResolvedValue({ status: 'found', value: saved })

    const restored = await loadJourney()

    expect(restored).toEqual(saved)
    expect(restored).not.toBe(saved)
    expect(restored.learned).not.toBe(saved.learned)
  })

  it.each([
    ['transport', 'network unavailable'],
    ['http', 'State read failed with HTTP 503.'],
    ['invalid-json', 'Unexpected token'],
    ['native', 'permission denied'],
  ] as const)('rejects a %s read failure without creating or writing a fresh journey', async (kind, message) => {
    bridge.getStateStrict.mockResolvedValue({ status: 'error', kind, message })

    await expect(loadJourney()).rejects.toThrow(`Journey save could not be read (${kind}): ${message}`)
    expect(bridge.putState).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...freshJourney(), version: 99 },
  ])('rejects found-but-corrupt journey data without replacing it', async (value) => {
    bridge.getStateStrict.mockResolvedValue({ status: 'found', value })

    await expect(loadJourney()).rejects.toThrow('Unsupported or invalid journey version.')
    expect(bridge.putState).not.toHaveBeenCalled()
  })
})

describe('createJourneySaver', () => {
  it('serializes writes, coalesces pending snapshots, and clones at save time', async () => {
    const gates = [deferred<boolean>(), deferred<boolean>()]
    const writes: Journey[] = []
    let gateIndex = 0
    let inFlight = 0
    let maxInFlight = 0
    bridge.putState.mockImplementation(async (name: string, value: Journey) => {
      expect(name).toBe(JOURNEY_FILE)
      const currentGate = gates[gateIndex]
      gateIndex += 1
      writes.push(value)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const saved = await currentGate.promise
      inFlight -= 1
      return saved
    })
    const statuses: string[] = []
    const saver = createJourneySaver((status) => statuses.push(status))
    const first = freshJourney()
    first.learned.push('neutral-first')
    saver.save(first)
    first.learned.push('mutated-after-save')
    first.position.x = 99

    const superseded = freshJourney()
    superseded.log.push('superseded snapshot')
    saver.save(superseded)
    const latest = freshJourney()
    latest.learned.push('neutral-latest')
    saver.save(latest)
    latest.learned.push('mutated-after-queue')

    expect(bridge.putState).toHaveBeenCalledTimes(1)
    gates[0].resolve(true)
    await vi.waitFor(() => expect(bridge.putState).toHaveBeenCalledTimes(2))
    gates[1].resolve(true)
    await saver.flush()

    expect(maxInFlight).toBe(1)
    expect(writes).toHaveLength(2)
    expect(writes[0].learned).toEqual(['neutral-first'])
    expect(writes[0].position.x).not.toBe(99)
    expect(writes[1].learned).toEqual(['neutral-latest'])
    expect(writes[1].log).not.toContain('superseded snapshot')
    expect(statuses).toEqual(['saving', 'saved', 'saving', 'saved'])
  })

  it('reports false and rejected writes as errors, then recovers on later saves', async () => {
    bridge.putState
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('isolated bridge rejection'))
      .mockResolvedValueOnce(true)
    const statuses: string[] = []
    const saver = createJourneySaver((status) => statuses.push(status))

    saver.save(freshJourney())
    await saver.whenIdle()
    saver.save({ ...freshJourney(), gold: 1 })
    await saver.whenIdle()
    saver.save({ ...freshJourney(), gold: 2 })
    await saver.flush()

    expect(bridge.putState).toHaveBeenCalledTimes(3)
    expect(statuses).toEqual([
      'saving', 'error',
      'saving', 'error',
      'saving', 'saved',
    ])
  })

  it('requests keepalive durability for every serialized journey write', async () => {
    const saver = createJourneySaver(() => {})
    const state = { ...freshJourney(), gold: 4 }

    saver.save(state)
    await saver.flush()

    expect(bridge.putState).toHaveBeenCalledWith(JOURNEY_FILE, state, { keepalive: true })
  })

  it('drains snapshots queued before disposal without later callbacks or subsequent writes', async () => {
    const gates = [deferred<boolean>(), deferred<boolean>()]
    let gateIndex = 0
    bridge.putState.mockImplementation(async () => gates[gateIndex++].promise)
    const statuses: string[] = []
    const saver = createJourneySaver((status) => statuses.push(status))

    saver.save({ ...freshJourney(), gold: 1 })
    saver.save({ ...freshJourney(), gold: 2 })
    saver.dispose()
    saver.save({ ...freshJourney(), gold: 3 })

    gates[0].resolve(true)
    await vi.waitFor(() => expect(bridge.putState).toHaveBeenCalledTimes(2))
    gates[1].resolve(true)
    await saver.whenIdle()
    saver.save({ ...freshJourney(), gold: 4 })
    await saver.flush()

    expect(bridge.putState.mock.calls.map(([, value]) => (value as Journey).gold)).toEqual([1, 2])
    expect(statuses).toEqual(['saving'])
  })
})
