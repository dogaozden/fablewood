import * as T from 'three';

/** The original bridge's local walking profile. Keep its vertices on this
 * curve rather than approximating it by rotated, overlapping flat slabs. */
export function bridgeDeckHeight(x: number): number {
  return 1.05 * Math.sin((x - 8.5) / 5 * Math.PI);
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Unequal corner fractures leave broad cut faces; there is no rounded-box
 * silhouette or vertex-level noise. The outline remains inside its bed. */
export function hewnOutline(width: number, height: number, seed: number): T.Vector2[] {
  const rand = random(seed);
  const halfW = width * .5, halfH = height * .5;
  const cuts = Array.from({ length: 4 }, (_, index) =>
    Math.min(width, height) * (index === seed % 4 ? .13 + rand() * .09 : .025 + rand() * .07));
  const [bl, br, tr, tl] = cuts;
  return [
    new T.Vector2(-halfW + bl, -halfH + rand() * height * .025),
    new T.Vector2(halfW - br, -halfH + rand() * height * .025),
    new T.Vector2(halfW - rand() * width * .012, -halfH + br),
    new T.Vector2(halfW - rand() * width * .016, halfH - tr),
    new T.Vector2(halfW - tr, halfH - rand() * height * .025),
    new T.Vector2(-halfW + tl, halfH - rand() * height * .025),
    new T.Vector2(-halfW + rand() * width * .016, halfH - tl),
    new T.Vector2(-halfW + rand() * width * .012, -halfH + bl),
  ];
}

/** Pull the arris toward the face centre by a short, uneven distance. This
 * radial construction also handles the shallow concave inner arch edge;
 * intersecting offset lines there could make near-parallel mitres explode. */
function insetOutline(polygon: T.Vector2[], amount: number, rand: () => number): T.Vector2[] {
  const center = polygon.reduce((sum, point) => sum.add(point), new T.Vector2()).multiplyScalar(1 / polygon.length);
  return polygon.map(point => {
    const inward = center.clone().sub(point);
    const distance = inward.length();
    const offset = Math.min(amount * (.7 + rand() * .8), distance * .12);
    return point.clone().addScaledVector(inward, offset / distance);
  });
}

/** A fitted masonry unit, extruded along Z. Four polygon rings describe real
 * worn edges and broad split faces. All faces share the same boundary
 * vertices, so chips never open cracks into the stone or create loose cards. */
export function hewnPrismGeometry(polygon: T.Vector2[], depth: number, seed: number): T.BufferGeometry {
  const rand = random(seed);
  const bounds = new T.Box2().setFromPoints(polygon), size = bounds.getSize(new T.Vector2());
  const bevel = Math.min(.016, size.x * .045, size.y * .05, depth * .085);
  const front = insetOutline(polygon, bevel, rand);
  const back = insetOutline(polygon, bevel * .7, rand);
  const ring = (points: T.Vector2[], z: number) => points.map(p => new T.Vector3(p.x, p.y, z));
  const frontFace = ring(front, depth * .5);
  const frontBed = ring(polygon, depth * .5 - bevel);
  const backBed = ring(polygon, -depth * .5 + bevel * .7);
  const backFace = ring(back, -depth * .5);
  const vertices: number[] = [], uvs: number[] = [];
  const triangle = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    for (const p of [a, b, c]) {
      vertices.push(p.x, p.y, p.z);
      uvs.push(p.x, p.y);
    }
  };
  const connect = (rear: T.Vector3[], forward: T.Vector3[]) => {
    for (let i = 0; i < polygon.length; i += 1) {
      const next = (i + 1) % polygon.length;
      triangle(rear[i], rear[next], forward[next]);
      triangle(rear[i], forward[next], forward[i]);
    }
  };
  connect(backFace, backBed);
  connect(backBed, frontBed);
  connect(frontBed, frontFace);

  const center = polygon.reduce((sum, p) => sum.add(p), new T.Vector2()).multiplyScalar(1 / polygon.length);
  // A shallow, off-centre fracture plane interrupts the face without rounding
  // every stone into a pillow. Its upper surface never exceeds the bed plane.
  center.x += (rand() - .5) * size.x * .14;
  center.y += (rand() - .5) * size.y * .14;
  const frontCenter = new T.Vector3(center.x, center.y, depth * .5 - Math.min(.008, depth * .035));
  const backCenter = new T.Vector3(center.x, center.y, -depth * .5);
  for (let i = 0; i < polygon.length; i += 1) {
    const next = (i + 1) % polygon.length;
    triangle(frontCenter, frontFace[i], frontFace[next]);
    triangle(backCenter, backFace[next], backFace[i]);
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Bend a face-built wall unit onto the existing bridge profile. */
export function layWallStone(geometry: T.BufferGeometry, x: number, bottom: number, height: number): void {
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i) + x;
    positions.setXYZ(i, px, positions.getY(i) + height * .5 + bottom + bridgeDeckHeight(px), positions.getZ(i));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Turn the broad face upward and bend every deck vertex onto the walking
 * curve. Top vertices are within 6 mm of it, with no slab-step approximation. */
export function layDeckStone(geometry: T.BufferGeometry, x: number, z: number, depth: number): void {
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const px = positions.getX(i) + x;
    const py = positions.getZ(i) - depth * .5 + bridgeDeckHeight(px);
    const pz = z - positions.getY(i);
    positions.setXYZ(i, px, py, pz);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
