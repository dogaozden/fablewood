import type { Fact, Encounter, EncounterKind, Pack } from '../packs/types';
import type { FactAliasIndex } from '../packs/aliases';

export interface InstalledPack { id: string; pack: Pack }

export interface DrawIndex extends FactAliasIndex {
  factById: Map<string, Fact>;
  packIdByFactId: Map<string, string>;
  /** Encounters as authored, including encounters that require an alias. */
  rawEncountersByFactId: Map<string, Encounter[]>;
  /** Picker-facing encounters; any encounter requiring an alias is omitted. */
  encountersByFactId: Map<string, Encounter[]>;
  packIds: string[]; // installation order, drives rotation
}

export interface DrawDeps {
  /** Order the given fact ids most-due-first (thin adapter over services.srs.dueQueue). */
  dueOrder(factIds: string[], now: number): string[];
  /** Amendment-suspension filter (adapter over srs/amendments eligible predicate). */
  eligible(factId: string): boolean;
  /** True if the fact has any SRS record (i.e. has been introduced). */
  hasRecord(factId: string): boolean;
  /** Epoch-ms next-due of a recorded fact; undefined if it has none (adapter over
   *  services.srs.nextDueOf). Drives the calendar-day tie buckets due-first ordering
   *  spreads sources within. */
  dueOf: (factId: string) => number | undefined;
}

export interface DrawOpts {
  count: number;
  seed: number;
  now: number;
  kinds?: EncounterKind[]; // when set, only facts with >=1 encounter of an allowed kind
}
