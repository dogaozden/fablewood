import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_SPECS, ROAD_SPEC_ID, engineSpecById } from './engineSpecs';
import { isDungeonSpec, archetypeError, relicError, bossRelicId } from './specResolve';

describe('the engine-spec registry', () => {
  it('resolves arc01-road and refuses an unknown id without throwing', () => {
    expect(Object.keys(ENGINE_SPECS)).toEqual([ROAD_SPEC_ID]);
    expect(engineSpecById(ROAD_SPEC_ID)?.id).toBe('arc01-road');
    expect(engineSpecById('no-such-spec')).toBeNull();
  });

  it('the road passes the same load-time gates a pack map passes', () => {
    const spec = engineSpecById(ROAD_SPEC_ID)!;
    expect(isDungeonSpec(spec)).toBe(true);
    expect(archetypeError(spec, ROAD_SPEC_ID)).toBeNull();
    expect(relicError(spec, ROAD_SPEC_ID)).toBeNull();
  });

  it('is the linear road the design fixes: three waystone gates, two middles, the Span', () => {
    const spec = engineSpecById(ROAD_SPEC_ID)!;
    expect(spec.rooms.map((r) => r.id)).toEqual(['ws-1', 'mid-1', 'ws-2', 'mid-2', 'ws-3', 'span']);
    for (const id of ['ws-1', 'ws-2', 'ws-3']) {
      expect(spec.rooms.find((r) => r.id === id)?.gate, `${id} is a gate room`).toBeTruthy();
    }
    expect(spec.rooms.find((r) => r.id === 'mid-1')!.enemies.map((e) => e.archetype)).toEqual(['wisp', 'wisp']);
    expect(spec.rooms.find((r) => r.id === 'mid-2')!.enemies.map((e) => e.archetype)).toEqual(['wisp', 'wraith']);
  });

  it('the Toll-Warden is a 3-shield / 3-phase boss carrying a real catalog relic', () => {
    const span = engineSpecById(ROAD_SPEC_ID)!.rooms.find((r) => r.id === 'span')!;
    expect(span.boss?.shields).toBe(3);
    expect(span.boss?.phases).toHaveLength(3);
    // Recorded per spec §4.1: the road names its own relic rather than taking
    // specResolve's Warden's-Signet fallback. waymark-heel is a real catalog relic
    // (inventory/catalog.ts:145) whose passive — party movement base +1 — is the
    // road's own passive, so relicError passes and bossLoot grants it directly.
    expect(bossRelicId(span)).toBe('waymark-heel');
  });

  it('every player-visible string on the road is a T2 placeholder (ruling R20)', () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, '__fixtures__', 'arc01.road.json'), 'utf8'),
    ) as { name: string; region: string; rooms: { name: string; blurb?: string; boss?: { name: string } }[] };
    const prose = [
      raw.name,
      raw.region,
      ...raw.rooms.flatMap((r) => [r.name, ...(r.blurb ? [r.blurb] : []), ...(r.boss ? [r.boss.name] : [])]),
    ];
    for (const s of prose) expect(s, s).toMatch(/^\[T2-PLACEHOLDER\] /);
  });
});
