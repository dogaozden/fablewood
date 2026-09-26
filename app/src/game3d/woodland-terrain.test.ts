import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { BRIDGE } from './landscape';
import { buildWoodlandTerrain } from './woodland-terrain';

const faceNormalY = (positions: T.BufferAttribute | T.InterleavedBufferAttribute, offset: number) => {
  const a = new T.Vector3().fromBufferAttribute(positions, offset);
  const b = new T.Vector3().fromBufferAttribute(positions, offset + 1);
  const c = new T.Vector3().fromBufferAttribute(positions, offset + 2);
  return b.sub(a).cross(c.sub(a)).normalize().y;
};

const inBridgeRectangle = (x: number, z: number) =>
  x > BRIDGE.minX && x < BRIDGE.maxX && z > BRIDGE.minZ && z < BRIDGE.maxZ;

describe('woodland terrain materials', () => {
  for (const seed of [1607, 1, 0xffffffff]) {
    it(`emits finite bounded geometry with an open bridge corridor for seed ${seed}`, () => {
      const base = new T.MeshStandardMaterial();
      const group = new T.Group();
      const result = buildWoodlandTerrain(group, { stone: base, ground: base }, seed);
      let triangleCount = 0;
      let corridorVertices = 0;
      let courtDownwardFaces = 0;
      let taggedCapTriangles = 0;
      let taggedCapDownward = 0;
      let taggedSideTriangles = 0;
      let taggedSideUvFailures = 0;
      let duplicateCourtTriangles = 0;
      const courtRoughness = new Set<number>();
      const courtTriangleKeys = new Set<string>();

      expect(result.meshes.length).toBeLessThanOrEqual(6);
      expect(new Set(result.markerNames).size).toBe(result.markerNames.length);

      for (const mesh of result.meshes) {
        const positions = mesh.geometry.getAttribute('position');
        const uvs = mesh.geometry.getAttribute('uv');
        triangleCount += positions.count / 3;
        for (const attribute of Object.values(mesh.geometry.attributes)) {
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
          if (inBridgeRectangle(positions.getX(vertex), positions.getZ(vertex))) corridorVertices += 1;
        }

        if (mesh.name.includes('court-paving')) {
          const material = mesh.material as T.MeshStandardMaterial;
          expect(material.metalness).toBe(0);
          expect(material.roughness).toBeGreaterThanOrEqual(.45);
          expect(material.roughness).toBeLessThanOrEqual(.70);
          expect(material.bumpScale).toBeGreaterThan(.05);
          courtRoughness.add(material.roughness);
          for (let triangle = 0; triangle < positions.count; triangle += 3) {
            if (faceNormalY(positions, triangle) < -.001) courtDownwardFaces += 1;
            const vertices = [triangle, triangle + 1, triangle + 2].map((vertex) => [
              positions.getX(vertex).toFixed(5),
              positions.getY(vertex).toFixed(5),
              positions.getZ(vertex).toFixed(5),
            ].join(','));
            const key = vertices.sort().join('|');
            if (courtTriangleKeys.has(key)) duplicateCourtTriangles += 1;
            courtTriangleKeys.add(key);
          }
        }

        if (mesh.name.includes('creek-bank-')) {
          const surfaceKinds = mesh.geometry.getAttribute('surfaceKind');
          expect(surfaceKinds).toBeDefined();
          for (let triangle = 0; triangle < positions.count; triangle += 3) {
            const kind = surfaceKinds!.getX(triangle);
            if (kind === 2) {
              taggedCapTriangles += 1;
              if (faceNormalY(positions, triangle) <= 0) taggedCapDownward += 1;
            } else if (kind === 1) {
              taggedSideTriangles += 1;
              const ys = [positions.getY(triangle), positions.getY(triangle + 1), positions.getY(triangle + 2)];
              const heightSpan = Math.max(...ys) - Math.min(...ys);
              const vs = [uvs.getY(triangle), uvs.getY(triangle + 1), uvs.getY(triangle + 2)];
              const uvSpan = Math.max(...vs) - Math.min(...vs);
              if (heightSpan <= 0 || Math.abs(uvSpan - heightSpan * .72) > 1e-4 + heightSpan * .005) taggedSideUvFailures += 1;
            }
          }
        }
      }

      expect(triangleCount).toBeLessThanOrEqual(100000);
      expect(corridorVertices).toBe(0);
      expect(courtDownwardFaces).toBe(0);
      expect(duplicateCourtTriangles).toBe(0);
      expect(courtRoughness.size).toBeGreaterThanOrEqual(2);
      expect(taggedCapTriangles).toBeGreaterThan(100);
      expect(taggedCapDownward).toBe(0);
      expect(taggedSideTriangles).toBeGreaterThan(1000);
      expect(taggedSideUvFailures).toBe(0);

      for (const mesh of result.meshes) {
        mesh.geometry.dispose();
        (mesh.material as T.Material).dispose();
      }
      base.dispose();
    });
  }
});
