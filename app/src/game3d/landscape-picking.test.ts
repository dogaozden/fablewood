import { describe, expect, it } from 'vitest';
import { landscapeHeight } from './landscape';
import { intersectLandscape } from './landscape-picking';

function aimedAt(x: number, z: number, origin = { x: 5, y: 15, z: 30 }) {
  const target = { x, y: landscapeHeight(x, z), z };
  const offset = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
  const length = Math.hypot(offset.x, offset.y, offset.z);
  return { origin, direction: { x: offset.x / length, y: offset.y / length, z: offset.z / length } };
}

describe('walking surface picking', () => {
  it('hits the visible bridge at an oblique camera angle instead of overshooting onto the plane below', () => {
    const ray = aimedAt(13, 2);
    const hit = intersectLandscape(ray)!;
    expect(hit.x).toBeCloseTo(13, 4);
    expect(hit.z).toBeCloseTo(2, 4);
    const flatDistance = -ray.origin.y / ray.direction.y;
    expect(Math.abs(ray.origin.z + ray.direction.z * flatDistance - hit.z)).toBeGreaterThan(1);
  });

  it('targets raised planted soil and the unchanged court through the same surface', () => {
    for (const [x,z] of [[-8.6,10.5],[-6.8,15.4],[4.5,12],[19,12]]) {
      const hit=intersectLandscape(aimedAt(x,z,{x:x+2,y:15,z:z+5}))!;
      expect(hit.x).toBeCloseTo(x,5);
      expect(hit.z).toBeCloseTo(z,5);
    }
  });

  it('takes the near side of a raised bridge when the ray crosses it before its aim point', () => {
    const ray=aimedAt(17,2,{x:3,y:1.7,z:2});
    const hit=intersectLandscape(ray)!;
    expect(hit.x).toBeLessThan(12.5);
    expect(hit.x).toBeGreaterThan(8.75);
    expect(hit.z).toBe(2);
  });

  it('does not create destinations for upward, parallel, or distance-clipped rays', () => {
    const origin={x:4,y:10,z:10};
    expect(intersectLandscape({origin,direction:{x:0,y:1,z:0}})).toBeNull();
    expect(intersectLandscape({origin,direction:{x:1,y:0,z:0}})).toBeNull();
    expect(intersectLandscape({origin,direction:{x:0,y:-1,z:0}},5)).toBeNull();
  });
});
