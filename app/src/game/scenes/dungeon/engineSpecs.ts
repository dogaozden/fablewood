/**
 * Engine-side dungeon specs — arc content that ships IN the engine, not in a pack
 * (universe design §9: "arc dungeon/scene specs are engine assets, like the dev fixture
 * precedent, never pack assets"). Loaded by id through DungeonScene's packless path, the
 * same one `?dev=1` already walks for dev.dungeon.json.
 *
 * A registry of thunks, not a bare object, so each spec's JSON is resolved on demand and
 * a future arc's spec is one line here. NOT a scene registry — `scenes/index.ts` is
 * orchestrator-owned and this adds no scene.
 */
import type { DungeonSpec } from '../../contracts';
import roadJson from './__fixtures__/arc01.road.json';

/** «Onward» Arc 1 — the road south, its waystones, and the Span. */
export const ROAD_SPEC_ID = 'arc01-road';

export const ENGINE_SPECS: Record<string, () => DungeonSpec> = {
  [ROAD_SPEC_ID]: () => roadJson as unknown as DungeonSpec,
};

/** The engine spec with this id, or null — never throws on an unknown/absent id, so a
 *  stale `?spec=` in a bookmark degrades to the ordinary pack path instead of a crash. */
export function engineSpecById(id: string | null | undefined): DungeonSpec | null {
  if (!id) return null;
  const make = ENGINE_SPECS[id];
  return make ? make() : null;
}
