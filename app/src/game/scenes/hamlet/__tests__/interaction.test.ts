import { describe, it, expect } from 'vitest';
import { pickInteraction, facingVec, type Interactable } from '../interaction';

const loc: Interactable = {
  id: 'tavern',
  door: { x: 100, y: 100 },
  center: { x: 100, y: 70 }, // building is above the door
};

describe('pickInteraction', () => {
  it('targets a location when near the door and facing it', () => {
    // standing just below the door, facing up toward the building
    const hit = pickInteraction([loc], 100, 108, facingVec('up'));
    expect(hit?.id).toBe('tavern');
  });

  it('returns null when out of range', () => {
    expect(pickInteraction([loc], 100, 200, facingVec('up'))).toBeNull();
  });

  it('returns null when facing away', () => {
    expect(pickInteraction([loc], 100, 108, facingVec('down'))).toBeNull();
  });

  it('targets when standing on the door facing the building', () => {
    const hit = pickInteraction([loc], 100, 100, facingVec('up'));
    expect(hit?.id).toBe('tavern');
  });

  it('picks the nearest of several eligible locations', () => {
    const near: Interactable = { id: 'near', door: { x: 104, y: 104 }, center: { x: 104, y: 80 } };
    const far: Interactable = { id: 'far', door: { x: 118, y: 100 }, center: { x: 118, y: 76 } };
    const hit = pickInteraction([far, near], 104, 110, facingVec('up'), 40);
    expect(hit?.id).toBe('near');
  });
});

describe('facingVec', () => {
  it('maps directions to unit vectors', () => {
    expect(facingVec('up')).toEqual({ x: 0, y: -1 });
    expect(facingVec('down')).toEqual({ x: 0, y: 1 });
    expect(facingVec('left')).toEqual({ x: -1, y: 0 });
    expect(facingVec('right')).toEqual({ x: 1, y: 0 });
  });
});
