import { describe, it, expect } from 'vitest';
import { alderConv, PROVINCE_DISPLAY_TITLES, type Province } from './content';
// T2 Task 4 Step 0: use the engine registry's own id rather than a fourth spelling of it
// (beats.ts's ROAD_SPEC and beats.test.ts's ROAD are the other two duplicates; this is a
// lateral import within game/scenes/, not the story/-must-not-import-scenes direction).
import { ROAD_SPEC_ID } from '../dungeon/engineSpecs';

const provinces: Province[] = [{ id: 'vc-law', title: 'The Venture Coast — Term Sheet Economics', factIds: [] }];

describe('the south gate as a destination choice', () => {
  it('renders packs by their «Onward» display title, unchanged', () => {
    const choices = alderConv(provinces).choices!;
    expect(choices.map((c) => c.label)).toEqual([PROVINCE_DISPLAY_TITLES['vc-law'], 'Not yet']);
    expect(choices.map((c) => c.value)).toEqual(['vc-law', '__cancel__']);
  });

  it('appends engine destinations after the packs, namespaced so ids can never collide', () => {
    const choices = alderConv(provinces, [{ id: ROAD_SPEC_ID, title: '[T2-PLACEHOLDER] The Road South' }]).choices!;
    expect(choices.map((c) => c.value)).toEqual(['vc-law', `spec:${ROAD_SPEC_ID}`, '__cancel__']);
    expect(choices[1].label).toBe('[T2-PLACEHOLDER] The Road South');
  });

  it('offers engine destinations even when no pack is installed', () => {
    const conv = alderConv([], [{ id: ROAD_SPEC_ID, title: '[T2-PLACEHOLDER] The Road South' }]);
    expect(conv.choices?.map((c) => c.value)).toEqual([`spec:${ROAD_SPEC_ID}`, '__cancel__']);
  });

  it('still says the roads are quiet when there is nowhere at all to go', () => {
    expect(alderConv([], []).choices).toBeUndefined();
  });
});
