import { describe, expect, it } from 'vitest';
import { BRIDGE, CREEK_HALF_WIDTH, creekCenter, creekHalfWidth, isCreekPoint, landscapeHeight, woodlandSoilRelief } from './landscape';
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
        expect(landscapeHeight(x, z)).toBeCloseTo(-.04 + woodlandSoilRelief(x, z), 10);
      }
    }
  });

  it('embeds bank stones with low continuous soil while preserving the court and crossing approaches', () => {
    for (const [x,z] of [[4.5,10],[-11.5,-4],[8.5,2],[17.5,2],[3,6]]) {
      expect(woodlandSoilRelief(x,z)).toBe(0);
    }
    for (const z of [7,12,18,-8]) for (const side of [-1,1]) {
      const x=creekCenter(z)+side*(creekHalfWidth(z)+.75);
      expect(woodlandSoilRelief(x,z)).toBeGreaterThan(.14);
      expect(woodlandSoilRelief(x,z)).toBeLessThan(.7);
      expect(isWalkable({x,z},true)).toBe(true);
      // The soil returns smoothly to the existing bank height; no detached
      // overlay or sudden step is introduced at the outer shoulder.
      const outer=creekCenter(z)+side*(creekHalfWidth(z)+2.5);
      expect(Math.abs(landscapeHeight(outer,z)-landscapeHeight(outer+side*.01,z))).toBeLessThan(.01);
    }
    expect(landscapeHeight(-8.6,10.5)).toBeGreaterThan(.9);
    expect(woodlandSoilRelief(-2,-11)).toBeGreaterThan(.15);
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
