import { describe, expect, it } from 'vitest';
import { BRIDGE, CREEK_HALF_WIDTH, creekCenter, isCreekPoint, landscapeHeight } from './landscape';
import { isWalkable } from './navigation';

describe('shared woodland landscape', () => {
  it('keeps the curved channel blocked away from the bridge and leaves both banks walkable', () => {
    for (const z of [-10, -5, 6, 10, 12]) {
      const center = creekCenter(z);
      expect(isCreekPoint(center, z)).toBe(true);
      expect(isWalkable({ x: center, z }, true)).toBe(false);
      expect(landscapeHeight(center, z)).toBe(-.55);
      for (const side of [-1, 1]) {
        const x = center + side * (CREEK_HALF_WIDTH + .4);
        expect(isCreekPoint(x, z)).toBe(false);
        expect(isWalkable({ x, z }, true)).toBe(true);
        expect(landscapeHeight(x, z)).toBe(-.04);
      }
    }
  });

  it('uses the modeled bridge arch for walking height throughout the crossing', () => {
    for (let x = BRIDGE.minX + .1; x < BRIDGE.maxX; x += .2) {
      const sourceX = (x - BRIDGE.centerX) / BRIDGE.scaleX + 11;
      const modeledDeck = 1.05 * Math.sin((sourceX - 8.5) / 5 * Math.PI);
      expect(landscapeHeight(x, BRIDGE.centerZ)).toBeCloseTo(modeledDeck, 8);
      expect(isWalkable({ x, z: BRIDGE.centerZ }, true)).toBe(true);
      if (isCreekPoint(x, BRIDGE.centerZ)) expect(isWalkable({ x, z: BRIDGE.centerZ }, false)).toBe(false);
    }
    expect(landscapeHeight(BRIDGE.centerX, BRIDGE.centerZ)).toBeCloseTo(1.05);
  });
});
