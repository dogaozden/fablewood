import { landscapeHeight } from './landscape';

interface Vector { x: number; y: number; z: number }
interface Ray { origin: Vector; direction: Vector }

/** Pick the first visible walking surface instead of a plane beneath it.
 * Camera rays are normalized. Sampling brackets the nearest intersection;
 * bisection then gives stable sub-centimetre targeting at an oblique angle. */
export function intersectLandscape(ray: Ray, maxDistance = 150): { x: number; z: number } | null {
  if (ray.direction.y >= 0 || maxDistance <= 0) return null;
  const pointAt = (distance: number) => ({
    x: ray.origin.x + ray.direction.x * distance,
    y: ray.origin.y + ray.direction.y * distance,
    z: ray.origin.z + ray.direction.z * distance,
  });
  const clearance = (distance: number) => {
    const p = pointAt(distance);
    return p.y - landscapeHeight(p.x, p.z);
  };
  if (clearance(0) <= 0) return null;
  let previous = 0;
  for (let distance = .25; previous < maxDistance; distance += .25) {
    const current = Math.min(distance, maxDistance);
    if (clearance(current) <= 0) {
      let near = previous, far = current;
      for (let step = 0; step < 16; step++) {
        const midpoint = (near + far) * .5;
        if (clearance(midpoint) > 0) near = midpoint;
        else far = midpoint;
      }
      const hit = pointAt((near + far) * .5);
      return { x: hit.x, z: hit.z };
    }
    previous = current;
  }
  return null;
}
