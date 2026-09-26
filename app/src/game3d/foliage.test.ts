import { describe, expect, it } from 'vitest';
import { fernGeometry, woodlandPlantGeometry } from './foliage';

describe('woodland plant silhouettes', () => {
  it('provides upright, non-degenerate geometry for all three plant families', () => {
    const plants=[fernGeometry(7),woodlandPlantGeometry('broadleaf',11),woodlandPlantGeometry('grass',23)];
    for(const geometry of plants){
      for(const attribute of Object.values(geometry.attributes))expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y-geometry.boundingBox!.min.y).toBeGreaterThan(.3);
      const normals=geometry.getAttribute('normal');
      for(let i=0;i<normals.count;i++)expect(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))).toBeCloseTo(1,4);
      geometry.dispose();
    }
  });
});
