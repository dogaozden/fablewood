import type { Fact, Encounter, EncounterKind, Pack } from '../packs/types';

export interface InstalledPack { id: string; pack: Pack }

export interface DrawIndex {
  factById: Map<string, Fact>;
  packIdByFactId: Map<string, string>;
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
}

export interface DrawOpts {
  count: number;
  seed: number;
  now: number;
  kinds?: EncounterKind[]; // when set, only facts with >=1 encounter of an allowed kind
}
