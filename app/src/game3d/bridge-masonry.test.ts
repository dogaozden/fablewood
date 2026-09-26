import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { bridgeDeckHeight, hewnOutline, hewnPrismGeometry } from './bridge-masonry';
import { BRIDGE, landscapeHeight } from './landscape';
import { buildBridge } from './ruins';

function bridge() {
  const parent = new T.Group();
  const stone = new T.MeshStandardMaterial();
  const moss = new T.MeshStandardMaterial({ map: new T.Texture() });
  buildBridge(parent, { stone, rock: stone, stoneDark: new T.MeshStandardMaterial(), moss, brass: stone, glow: stone });
  parent.updateWorldMatrix(true, true);
  const stones: T.Mesh[] = [];
  parent.traverse(object => {
    if (object instanceof T.Mesh && /bridge-.*-stone/.test(object.name)) stones.push(object);
  });
  return { parent, stones };
}

function inspectSolid(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const edges = new Map<string, { count: number; direction: number }>();
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  let volume = 0;
  const key = (p: T.Vector3) => p.toArray().map(value => Math.round(value * 1e5)).join(',');
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    expect([...a.toArray(), ...b.toArray(), ...c.toArray()].every(Number.isFinite)).toBe(true);
    expect(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()).toBeGreaterThan(1e-13);
    volume += a.dot(b.clone().cross(c)) / 6;
    for (let vertex = i; vertex < i + 3; vertex += 1) {
      expect(new T.Vector3().fromBufferAttribute(normals, vertex).length()).toBeCloseTo(1, 5);
    }
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const startKey = key(start), endKey = key(end);
      const ordered = startKey < endKey;
      const edgeKey = ordered ? `${startKey}/${endKey}` : `${endKey}/${startKey}`;
      const edge = edges.get(edgeKey) ?? { count: 0, direction: 0 };
      edge.count += 1;
      edge.direction += ordered ? 1 : -1;
      edges.set(edgeKey, edge);
    }
  }
  expect(volume).toBeGreaterThan(0);
  for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
}

describe('fitted bridge masonry', () => {
  it('keeps varied chipped units closed, consistently wound, and inside their fitted beds', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const width = .29 + seed * .019, height = .14 + seed * .011, depth = .16 + seed * .012;
      const geometry = hewnPrismGeometry(hewnOutline(width, height, seed), depth, seed);
      inspectSolid(geometry);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      expect(bounds.min.x).toBeGreaterThanOrEqual(-width * .5 - 1e-7);
      expect(bounds.max.x).toBeLessThanOrEqual(width * .5 + 1e-7);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-height * .5 - 1e-7);
      expect(bounds.max.y).toBeLessThanOrEqual(height * .5 + 1e-7);
      geometry.dispose();
    }
  });

  it('fits real arch and parapet stones without open seams inside a unit or collapsed springings', () => {
    const { stones } = bridge();
    expect(stones.some(stone => stone.name === 'bridge-arch-stone')).toBe(true);
    expect(stones.some(stone => stone.name === 'bridge-parapet-stone')).toBe(true);
    for (const stone of stones) inspectSolid(stone.geometry);
    const triangles = stones.reduce((sum, stone) => sum + stone.geometry.getAttribute('position').count / 3, 0);
    expect(triangles).toBeLessThan(18000);
    // All units share one surface material, so batching adds one stone draw.
    expect(new Set(stones.map(stone => stone.material)).size).toBe(1);
  });

  it('preserves the traversal transform/profile and separates each fitted deck bed', () => {
    const { parent, stones } = bridge();
    const group = parent.children[0];
    expect(group.scale.x).toBe(BRIDGE.scaleX);
    expect(group.position.x).toBe(BRIDGE.centerX - 11 * BRIDGE.scaleX);
    expect(group.position.z).toBe(BRIDGE.centerZ - 4);
    const deck = stones.filter(stone => stone.name === 'bridge-deck-stone');
    const boxes: T.Box3[] = [];
    for (const stone of deck) {
      stone.geometry.computeBoundingBox();
      boxes.push(stone.geometry.boundingBox!.clone());
      const positions = stone.geometry.getAttribute('position');
      let profileVertices = 0;
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const error = bridgeDeckHeight(x) - y;
        expect(error).toBeGreaterThanOrEqual(-1e-6);
        if (Math.abs(error) < 1e-6) profileVertices += 1;
        const worldX = x * BRIDGE.scaleX + group.position.x;
        if (worldX > BRIDGE.minX && worldX < BRIDGE.maxX) {
          expect(bridgeDeckHeight(x)).toBeCloseTo(landscapeHeight(worldX, z + group.position.z), 10);
        }
      }
      expect(profileVertices).toBeGreaterThan(12);
    }
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j];
      expect(a.max.x < b.min.x || b.max.x < a.min.x || a.max.z < b.min.z || b.max.z < a.min.z).toBe(true);
    }
  });
});
