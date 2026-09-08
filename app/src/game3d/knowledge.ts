import { getPacks, getStateStrict, putState } from '../bridge/client'
import { seededShuffle } from '../draw/index'
import { services, type EncounterResult } from '../game/contracts'
import { FIXTURE_PACK } from '../game/encounters/fixtures'
import type { Encounter, EncounterKind, Fact, Pack } from '../packs/types'
import { freshJourney, restoreJourney, type Journey } from './model'

export interface Lesson {
  /** Compatibility head: the candidate fact that led the draw to this encounter. */
  fact: Fact
  /** Every fact required by the encounter, in encounter.fact_ids order. */
  facts: Fact[]
  encounter: Encounter
  packId: string
  sourceTitle: string
  practice: boolean
}

export interface RealmArchive {
  packs: Pack[]
  practice: boolean
  count: number
}

export async function openArchive(): Promise<RealmArchive> {
  await services.draw.ready()
  const { packs } = await getPacks()
  const valid = packs
    .map((entry) => entry.pack as Pack)
    .filter((pack) => Array.isArray(pack.facts) && Array.isArray(pack.encounters))
  return {
    packs: valid,
    practice: valid.length === 0,
    count: valid.reduce((count, pack) => count + pack.facts.length, 0),
  }
}

const indexedFactsFor = (encounter: Encounter): Fact[] | null => {
  const facts: Fact[] = []
  for (const factId of encounter.fact_ids) {
    const fact = services.draw.factOf(factId)
    if (!fact || services.amendments.isSuspended(factId)) return null
    facts.push(fact)
  }
  return facts
}

const fixtureFactsFor = (encounter: Encounter): Fact[] | null => {
  const facts: Fact[] = []
  for (const factId of encounter.fact_ids) {
    const fact = FIXTURE_PACK.facts.find((candidate) => candidate.id === factId)
    if (!fact) return null
    facts.push(fact)
  }
  return facts
}

/** Seventh draw consumer: due -> fresh -> deterministic eligible revisit pool.
 * The same picker serves discovery, waystones and battle so every action shares
 * amendment suspension and global source resolution. */
export async function chooseLesson(
  archive: RealmArchive,
  seed: number,
  exclude: string[] = [],
  kinds?: EncounterKind[],
): Promise<Lesson | null> {
  await services.draw.ready()
  const allowed = (fact: Fact): boolean => !exclude.includes(fact.id) && !services.amendments.isSuspended(fact.id)
  const allFactIds = services.draw.allFactIds()
  // Filtering after a short draw window can let excluded facts conceal a later
  // due fact and incorrectly promote fresh/revisit material. Scan the complete
  // indexed pool so due -> fresh -> revisit remains true after exclusions.
  const scanCount = Math.max(20, allFactIds.length, exclude.length + 1)
  const now = Date.now()
  const due = services.draw.due({ count: scanCount, seed, now, kinds })
  const fresh = services.draw.fresh({ count: scanCount, seed, now, kinds })
  const revisit = seededShuffle(allFactIds, seed)
  const ordered = [...new Set([...due, ...fresh, ...revisit])]

  for (const factId of ordered) {
    const fact = services.draw.factOf(factId)
    if (!fact || !allowed(fact)) continue
    const candidates = services.draw.encountersOf(factId)
      .filter((encounter) => !kinds || kinds.includes(encounter.kind))
      .map((encounter) => ({ encounter, facts: indexedFactsFor(encounter) }))
      .filter((candidate): candidate is { encounter: Encounter; facts: Fact[] } => candidate.facts !== null)
    const selected = candidates[Math.abs(seed) % candidates.length]
    if (!selected) continue
    const packId = services.draw.sourceOf(factId) ?? ''
    const pack = archive.packs.find((candidate) => candidate.meta.id === packId)
    return {
      fact,
      facts: selected.facts,
      encounter: selected.encounter,
      packId,
      sourceTitle: pack?.meta.title ?? 'Library source',
      practice: false,
    }
  }

  if (archive.practice) {
    const candidates = FIXTURE_PACK.encounters
      .filter((encounter) => !kinds || kinds.includes(encounter.kind))
      .map((encounter) => ({ encounter, facts: fixtureFactsFor(encounter) }))
      .filter((candidate): candidate is { encounter: Encounter; facts: Fact[] } => candidate.facts !== null)
    const selected = candidates[Math.abs(seed) % candidates.length]
    if (!selected) return null
    return {
      fact: selected.facts[0],
      facts: selected.facts,
      encounter: selected.encounter,
      packId: FIXTURE_PACK.meta.id,
      sourceTitle: 'The Green Compendium · invented practice',
      practice: true,
    }
  }

  if (exclude.length > 0) return chooseLesson(archive, seed, [], kinds)
  return null
}

export async function recallLesson(
  lesson: Lesson,
  seed: number,
  context: 'drill' | 'combat' | 'boss',
): Promise<EncounterResult & { amendedFirstMiss?: boolean }> {
  const result = await services.runEncounter({
    context,
    packId: lesson.packId,
    encounterId: lesson.encounter.id,
    factIds: lesson.encounter.fact_ids,
    seed,
    flair: context === 'drill' ? 'Renew the waystone' : 'Lantern recall',
  })
  // Read before recording: the first history row consumes this one-time mercy.
  const amendedFirstMiss = !lesson.practice && result.quality === 0 && !result.redraw &&
    services.amendments.firstAmendedAppearance(result.factIds) !== null
  if (!lesson.practice && !result.redraw && result.encounterId !== 'none') {
    for (const factId of new Set(result.factIds)) {
      const fact = services.draw.factOf(factId)
      if (fact && !services.amendments.isSuspended(factId)) {
        await services.srs.record(factId, result.quality, result.encounterId, fact.type)
      }
    }
  }
  return amendedFirstMiss ? { ...result, amendedFirstMiss: true } : result
}

export const JOURNEY_FILE = 'journey-3d-v1.json'

export async function loadJourney(): Promise<Journey> {
  const result = await getStateStrict(JOURNEY_FILE)
  if (result.status === 'absent') return freshJourney()
  if (result.status === 'error') {
    throw new Error(`Journey save could not be read (${result.kind}): ${result.message}`)
  }
  return restoreJourney(result.value)
}

export type JourneySaveStatus = 'saving' | 'saved' | 'error'

export interface JourneySaver {
  save(value: Journey): void
  /** Starts a drain if needed and resolves once every currently queued write is settled. */
  flush(): Promise<void>
  /** Resolves at the same serialized idle boundary as flush(). */
  whenIdle(): Promise<void>
  /** Stops status callbacks and future saves; already queued snapshots still drain. */
  dispose(): void
}

export function createJourneySaver(onStatus: (state: JourneySaveStatus) => void): JourneySaver {
  let pending: Journey | null = null
  let active: Promise<void> | null = null
  let disposed = false

  const notify = (status: JourneySaveStatus): void => {
    if (!disposed) onStatus(status)
  }

  const drain = async (): Promise<void> => {
    while (pending) {
      const value = pending
      pending = null
      notify('saving')
      let saved = false
      try {
        saved = await putState(JOURNEY_FILE, value, { keepalive: true })
      } catch {
        saved = false
      }
      notify(saved ? 'saved' : 'error')
    }
  }

  const ensureDrain = (): Promise<void> => {
    if (!active) {
      active = drain().finally(() => {
        active = null
        if (pending) void ensureDrain()
      })
    }
    return active
  }

  const whenIdle = async (): Promise<void> => {
    while (pending || active) {
      if (pending && !active) ensureDrain()
      if (active) await active
    }
  }

  return {
    save(value) {
      if (disposed) return
      pending = structuredClone(value)
      void ensureDrain()
    },
    flush: whenIdle,
    whenIdle,
    dispose() {
      disposed = true
      if (pending && !active) void ensureDrain()
    },
  }
}
