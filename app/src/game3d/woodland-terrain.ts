import * as T from 'three';
import { BRIDGE, creekHalfWidth, creekCenter } from './landscape';
import { mossStone } from './stone-surfaces';

/**
 * Irregular court paving and layered creek banks for Lantern Wood.  The module deliberately owns only low terrain,
 * paving, bank rock, seams, and small margin plants.  It does not alter
 * navigation, water, landmarks, or any existing scene object.
 */

export interface WoodlandTerrainCounts {
  pavers: number;
  mossSeams: number;
  largeOutcrops: number;
  mediumOutcrops: number;
  smallOutcrops: number;
  groundcoverMasses: number;
  triangles: number;
  meshes: number;
}

export interface WoodlandTerrainResult {
  meshes: T.Mesh[];
  counts: WoodlandTerrainCounts;
  markerNames: string[];
}

type MaterialTable = Record<string, T.MeshStandardMaterial>;

type Point = { x: number; y: number; z: number };

type UV = { u: number; v: number };

type Vertex = { point: Point; uv: UV; color: [number, number, number] };

type Builder = {
  positions: number[];
  uvs: number[];
  colors: number[];
  surfaceKinds: number[];
  triangles: number;
};

const SURFACE_GENERIC = 0;
const SURFACE_SIDE = 1;
const SURFACE_EXPOSED_CAP = 2;

type PaverSpec = {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  top: number;
  wear: number;
  tone: number;
  footprint?: { x: number; z: number }[];
};

type OutcropSpec = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  topSlope: number;
  tone: number;
  side: -1 | 1;
};

const TAU = Math.PI * 2;
const BRIDGE_GAP_MIN_Z = BRIDGE.minZ;
const BRIDGE_GAP_MAX_Z = BRIDGE.maxZ;
const BRIDGE_GAP_MARGIN = .035;
// Conservative bounds include the continuous rock outline and rotated heel.
// Keep this envelope slightly loose so bridge landings remain clear.
const OUTCROP_PROFILE_MAX = (.88 + .18 + .060 + .038) * 1.01;
const OUTCROP_Z_PROFILE_MAX = (.88 + .18 + .060 + .038) * 1.01 * (.91 + .12);
const OUTCROP_OUTER_BIAS_MAX = .018 + .055;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function rotateXZ(x: number, z: number, rotation: number): { x: number; z: number } {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { x: x * c - z * s, z: x * s + z * c };
}

function point(x: number, y: number, z: number): Point {
  return { x, y, z };
}

function uv(x: number, z: number, offsetU: number, offsetV: number, scale = .55): UV {
  return { u: x * scale + offsetU, v: z * scale + offsetV };
}

function builder(): Builder {
  return { positions: [], uvs: [], colors: [], surfaceKinds: [], triangles: 0 };
}

function addTriangle(target: Builder, a: Vertex, b: Vertex, c: Vertex, surfaceKind = SURFACE_GENERIC): void {
  const abx = b.point.x - a.point.x;
  const aby = b.point.y - a.point.y;
  const abz = b.point.z - a.point.z;
  const acx = c.point.x - a.point.x;
  const acy = c.point.y - a.point.y;
  const acz = c.point.z - a.point.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (nx * nx + ny * ny + nz * nz < 1e-9) return;

  for (const vertex of [a, b, c]) {
    target.positions.push(vertex.point.x, vertex.point.y, vertex.point.z);
    target.uvs.push(vertex.uv.u, vertex.uv.v);
    target.colors.push(vertex.color[0], vertex.color[1], vertex.color[2]);
    target.surfaceKinds.push(surfaceKind);
  }
  target.triangles += 1;
}

function faceNormal(a: Point, b: Point, c: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  return {
    x: aby * acz - abz * acy,
    y: abz * acx - abx * acz,
    z: abx * acy - aby * acx,
  };
}

/** Orient a side face from its actual polygon edge, keeping winding robust
 * when a deliberately chipped outline makes a local edge unusually steep. */
function addOutwardTriangle(target: Builder, a: Vertex, b: Vertex, c: Vertex, center: Point, surfaceKind = SURFACE_GENERIC): void {
  const normal = faceNormal(a.point, b.point, c.point);
  const edgeCenterX = (a.point.x + b.point.x + c.point.x) / 3;
  const edgeCenterZ = (a.point.z + b.point.z + c.point.z) / 3;
  const outward = normal.x * (edgeCenterX - center.x) + normal.z * (edgeCenterZ - center.z);
  if (outward < 0) addTriangle(target, a, c, b, surfaceKind);
  else addTriangle(target, a, b, c, surfaceKind);
}

function addOutwardQuad(target: Builder, a: Vertex, b: Vertex, c: Vertex, d: Vertex, center: Point, surfaceKind = SURFACE_GENERIC): void {
  addOutwardTriangle(target, a, b, c, center, surfaceKind);
  addOutwardTriangle(target, a, c, d, center, surfaceKind);
}

/** Keep exposed stone surfaces front-facing even when a weathered ring has
 * enough height variation to reverse one local triangle. */
function addUpwardTriangle(target: Builder, a: Vertex, b: Vertex, c: Vertex, surfaceKind = SURFACE_GENERIC): void {
  const normal = faceNormal(a.point, b.point, c.point);
  if (normal.y < 0) addTriangle(target, a, c, b, surfaceKind);
  else addTriangle(target, a, b, c, surfaceKind);
}

function addUpwardQuad(target: Builder, a: Vertex, b: Vertex, c: Vertex, d: Vertex, surfaceKind = SURFACE_GENERIC): void {
  addUpwardTriangle(target, a, b, c, surfaceKind);
  addUpwardTriangle(target, a, c, d, surfaceKind);
}

/** UVs for a vertical face: U follows distance around the slab and V follows
 * the actual height. This avoids stretching the rock map from local XZ on
 * steep bank faces. */
function verticalUV(arc: number, y: number, baseY: number, offsetU: number, offsetV: number): UV {
  return { u: offsetU + arc * .30, v: offsetV + (y - baseY) * .72 };
}

/** Share normals across duplicated UV/color seams without welding stones to
 * their neighbors. Creases sharper than 65 degrees keep their carved edge. */
function smoothStoneNormals(geometry: T.BufferGeometry): void {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  const groups = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    const group = groups.get(key) ?? [];
    group.push(i); groups.set(key, group);
  }
  const result = new Float32Array(n.count * 3);
  for (const group of groups.values()) for (const i of group) {
    const sum = new T.Vector3();
    const original = new T.Vector3().fromBufferAttribute(n, i);
    for (const j of group) {
      const neighbor = new T.Vector3().fromBufferAttribute(n, j);
      if (original.dot(neighbor) > .4226) sum.add(neighbor);
    }
    sum.normalize().toArray(result, i * 3);
  }
  geometry.setAttribute('normal', new T.BufferAttribute(result, 3));
}

function finish(target: Builder, stone = false): T.BufferGeometry {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(target.uvs, 2));
  geometry.setAttribute('color', new T.Float32BufferAttribute(target.colors, 3));
  geometry.setAttribute('surfaceKind', new T.Float32BufferAttribute(target.surfaceKinds, 1));
  geometry.computeVertexNormals();
  if (stone) smoothStoneNormals(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function sharedMaterial(
  source: T.MeshStandardMaterial,
  name: string,
  color: string,
  roughness: number,
): T.MeshStandardMaterial {
  const material = source.clone();
  material.name = name;
  material.color.set(color);
  material.roughness = roughness;
  material.vertexColors = true;
  material.transparent = false;
  material.needsUpdate = true;
  return material;
}

function createMesh(
  parent: T.Group,
  name: string,
  geometry: T.BufferGeometry,
  material: T.MeshStandardMaterial,
): T.Mesh {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.woodlandTerrain = true;
  parent.add(mesh);
  return mesh;
}

const COURT_OUTLINE = [
  { x: -4.8, z: 2.2 }, { x: -2.9, z: .58 }, { x: 6.6, z: .58 },
  { x: 8.2, z: 2.2 }, { x: 8.8, z: 13.35 }, { x: 9.9, z: 26.5 },
  { x: -.8, z: 26.5 }, { x: -3.6, z: 14.5 },
];

export function courtContains(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = COURT_OUTLINE.length - 1; i < COURT_OUTLINE.length; j = i++) {
    const a = COURT_OUTLINE[i], b = COURT_OUTLINE[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function inWellClearance(x: number, z: number): boolean {
  return (x - 4.5) ** 2 + (z - 10) ** 2 < 2.02 ** 2;
}

/** Conservative oriented footprint test used before emitting a ribbon stone
 * or moss seam. It checks the primitive's actual rotated bounds, rather than
 * only its center, against the bridge opening. */
function intersectsBridgeCorridor(x: number, z: number, width: number, depth: number, rotation: number): boolean {
  const halfX = Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * depth;
  const halfZ = Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * depth;
  const margin = BRIDGE_GAP_MARGIN + .035;
  return x + halfX > BRIDGE.minX - margin && x - halfX < BRIDGE.maxX + margin
    && z + halfZ > BRIDGE_GAP_MIN_Z - margin && z - halfZ < BRIDGE_GAP_MAX_Z + margin;
}

function appendPaver(target: Builder, spec: PaverSpec, randomValue: () => number): void {
  const sides = spec.footprint?.length ?? 8;
  const points: { x: number; z: number; localX: number; localZ: number }[] = [];
  const edge: { x: number; z: number; localX: number; localZ: number }[] = [];
  const inner: { x: number; z: number; localX: number; localZ: number }[] = [];
  const core: { x: number; z: number; localX: number; localZ: number }[] = [];
  const arcLengths: number[] = [];
  const offsetU = randomValue() * 8;
  const offsetV = randomValue() * 8;
  const phase = randomValue() * TAU;

  for (let index = 0; index < sides; index += 1) {
    const angle = index / sides * TAU + Math.PI / 8;
    const radius = .88 + randomValue() * .18 + Math.sin(angle * 3 + phase) * .045;
    const outlineX = Math.sign(Math.cos(angle)) * Math.pow(Math.abs(Math.cos(angle)), .52);
    const outlineZ = Math.sign(Math.sin(angle)) * Math.pow(Math.abs(Math.sin(angle)), .52);
    const localX = spec.footprint?.[index].x ?? outlineX * spec.width * radius;
    const localZ = spec.footprint?.[index].z ?? outlineZ * spec.depth * radius;
    const rotated = rotateXZ(localX, localZ, spec.rotation);
    points.push({ x: spec.x + rotated.x, z: spec.z + rotated.z, localX, localZ });

    // Boundary cells retain their fitted Voronoi footprint. Only the exposed
    // shoulder is eroded inward, with a small per-corner variation instead of
    // a mechanically equal bevel on every stone.
    const edgeScale = spec.footprint ? .985 + randomValue() * .012 : .965 + randomValue() * .022;
    const edgeX = localX * edgeScale;
    const edgeZ = localZ * edgeScale;
    const edgeRotated = rotateXZ(edgeX, edgeZ, spec.rotation);
    edge.push({ x: spec.x + edgeRotated.x, z: spec.z + edgeRotated.z, localX: edgeX, localZ: edgeZ });

    const innerRadius = spec.footprint ? .92 + randomValue() * .065 : .90 + randomValue() * .08;
    // Inset from the actual chipped outline for both court and path stones.
    // An independent radius could extend past a short outer corner and fold
    // the shoulder back underneath the cap.
    const nestedRadius = Math.min(innerRadius, edgeScale - .012);
    const innerX = localX * nestedRadius;
    const innerZ = localZ * nestedRadius;
    const innerRotated = rotateXZ(innerX, innerZ, spec.rotation);
    inner.push({ x: spec.x + innerRotated.x, z: spec.z + innerRotated.z, localX: innerX, localZ: innerZ });

    const coreScale = spec.footprint ? .47 + randomValue() * .10 : .45 + randomValue() * .16;
    const coreX = localX * coreScale;
    const coreZ = localZ * coreScale;
    const coreRotated = rotateXZ(coreX, coreZ, spec.rotation);
    core.push({ x: spec.x + coreRotated.x, z: spec.z + coreRotated.z, localX: coreX, localZ: coreZ });
  }

  let perimeter = 0;
  for (let index = 0, length = 0; index < sides; index += 1) {
    arcLengths[index] = length;
    const next = (index + 1) % sides;
    length += Math.hypot(points[next].localX - points[index].localX, points[next].localZ - points[index].localZ);
    perimeter = length;
  }

  const topColors: [number, number, number] = [
    clamp(.80 + spec.tone * .085, .74, .93),
    clamp(.77 + spec.tone * .085, .71, .91),
    clamp(.68 + spec.tone * .080, .61, .84),
  ];
  const sideColors: [number, number, number] = [topColors[0] * .78, topColors[1] * .79, topColors[2] * .77];
  const lowerColors: [number, number, number] = [topColors[0] * .60, topColors[1] * .63, topColors[2] * .58];
  // Foot-worn flags can have shallow depressions. Raising every centre above
  // its edges made even narrow bevels read as uniformly inflated panels.
  const centerY = spec.top + (randomValue() - .55) * (.018 + spec.wear);
  const center = point(spec.x + (randomValue() - .5) * .035, centerY + (randomValue() - .5) * .010, spec.z + (randomValue() - .5) * .035);
  // Corner heights are shared by both adjacent faces. Wear stays varied per
  // corner, but no edge receives a second random height for the same vertex.
  const bevelHeights: number[] = [];
  const topHeights: number[] = [];
  const coreHeights: number[] = [];
  for (let index = 0; index < sides; index += 1) {
    const edgeHeight = spec.top + (randomValue() - .5) * .022;
    bevelHeights[index] = edgeHeight - (.010 + randomValue() * .027);
    topHeights[index] = edgeHeight + (randomValue() - .42) * .024;
    coreHeights[index] = centerY + (randomValue() - .5) * Math.min(.012, spec.wear + .006);
  }

  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    const outerA = points[index];
    const outerB = points[next];
    const edgeA = edge[index];
    const edgeB = edge[next];
    const innerA = inner[index];
    const innerB = inner[next];
    const coreA = core[index];
    const coreB = core[next];
    const nextArc = index === sides - 1 ? perimeter : arcLengths[next];
    const bevelA = point(edgeA.x, bevelHeights[index], edgeA.z);
    const bevelB = point(edgeB.x, bevelHeights[next], edgeB.z);
    const topA = point(innerA.x, topHeights[index], innerA.z);
    const topB = point(innerB.x, topHeights[next], innerB.z);
    const bottomA = point(outerA.x, -.055, outerA.z);
    const bottomB = point(outerB.x, -.055, outerB.z);
    const outerUVA = verticalUV(arcLengths[index], bottomA.y, -.055, offsetU, offsetV);
    const outerUVB = verticalUV(nextArc, bottomB.y, -.055, offsetU, offsetV);
    const bevelUVA = verticalUV(arcLengths[index], bevelA.y, -.055, offsetU, offsetV);
    const bevelUVB = verticalUV(nextArc, bevelB.y, -.055, offsetU, offsetV);
    const topUVA = uv(innerA.localX, innerA.localZ, offsetU, offsetV);
    const topUVB = uv(innerB.localX, innerB.localZ, offsetU, offsetV);
    const coreUVA = uv(coreA.localX, coreA.localZ, offsetU, offsetV);
    const coreUVB = uv(coreB.localX, coreB.localZ, offsetU, offsetV);
    const topVariation = .985 + Math.sin(index * 1.37 + phase) * .012;
    const weatheredTop: [number, number, number] = [
      topColors[0] * topVariation,
      topColors[1] * topVariation,
      topColors[2] * topVariation,
    ];

    // Court edges are shallow exposed relief rather than collision walls; keep
    // both rings front-facing so the existing top-surface invariant remains
    // meaningful for the full paver mesh.
    addUpwardQuad(
      target,
      { point: bottomA, uv: outerUVA, color: lowerColors },
      { point: bevelA, uv: bevelUVA, color: sideColors },
      { point: bevelB, uv: bevelUVB, color: sideColors },
      { point: bottomB, uv: outerUVB, color: lowerColors },
    );
    addUpwardQuad(
      target,
      { point: bevelA, uv: bevelUVA, color: sideColors },
      { point: topA, uv: topUVA, color: weatheredTop },
      { point: topB, uv: topUVB, color: weatheredTop },
      { point: bevelB, uv: bevelUVB, color: sideColors },
    );
    addUpwardQuad(target,
      { point: topB, uv: topUVB, color: weatheredTop },
      { point: topA, uv: topUVA, color: weatheredTop },
      { point: point(coreA.x, coreHeights[index], coreA.z), uv: coreUVA, color: topColors },
      { point: point(coreB.x, coreHeights[next], coreB.z), uv: coreUVB, color: topColors },
    );
    addUpwardTriangle(target,
      { point: point(coreB.x, coreHeights[next], coreB.z), uv: coreUVB, color: topColors },
      { point: point(coreA.x, coreHeights[index], coreA.z), uv: coreUVA, color: topColors },
      { point: center, uv: uv(0, 0, offsetU, offsetV), color: weatheredTop },
    );
  }
}

function appendMossStrip(
  target: Builder,
  x: number,
  z: number,
  length: number,
  width: number,
  rotation: number,
  tone: number,
  offset: number,
): void {
  const along = rotateXZ(length * .5, 0, rotation);
  const across = rotateXZ(0, width * .5, rotation);
  const a = point(x - along.x - across.x, .006, z - along.z - across.z);
  const b = point(x + along.x - across.x, .006, z + along.z - across.z);
  const c = point(x + along.x + across.x, .009, z + along.z + across.z);
  const d = point(x - along.x + across.x, .009, z - along.z + across.z);
  const ridgeHeight = .011 + Math.sin(offset * .17 + x * .23 + z * .11) * .0025;
  const ridgeA = point(x - along.x * .88, ridgeHeight, z - along.z * .88);
  const ridgeB = point(x + along.x * .88, ridgeHeight + .0015, z + along.z * .88);
  const color: [number, number, number] = [
    clamp(.28 + tone * .13, .22, .48),
    clamp(.37 + tone * .16, .28, .62),
    clamp(.19 + tone * .08, .14, .35),
  ];
  const dark: [number, number, number] = [color[0] * .72, color[1] * .72, color[2] * .72];
  const vertex = (p: Point, u: number, v: number, c = color): Vertex => ({ point: p, uv: { u: u + offset, v: v + offset * .31 }, color: c });
  // A shallow ridge fills the crevice without becoming a second coplanar tile
  // layer. The split also catches a restrained wet highlight along the seam.
  addUpwardQuad(target, vertex(a, 0, 0, dark), vertex(d, 0, width), vertex(ridgeA, length * .22, width * .50), vertex(ridgeB, length * .31, width * .50));
  addUpwardQuad(target, vertex(ridgeB, length * .31, width * .50), vertex(ridgeA, length * .22, width * .50), vertex(c, length * .5, width), vertex(b, length * .5, 0));
}

/** Clip one cell against a half-plane, retaining shared masonry edges. */
function clipCell(polygon: { x: number; z: number }[], nx: number, nz: number, limit: number) {
  const result: { x: number; z: number }[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a.x * nx + a.z * nz - limit;
    const db = b.x * nx + b.z * nz - limit;
    if (da <= 0) result.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      result.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
    }
  }
  return result;
}

function addPaverField(randomValue: () => number, target: Builder, dampTarget: Builder | undefined, moss: Builder): { pavers: number; seams: number } {
  const centers: { x: number; z: number; radius: number }[] = [];
  // Variable-radius blue noise makes large flags, narrow wedges and small
  // infill share the same fitted field. Equal-radius packing produced an
  // obvious honeycomb even after its grid had been removed.
  const buckets = new Map<string, typeof centers>();
  const cellSize = .60;
  for (let attempt = 0; attempt < 16000; attempt++) {
    const candidate = { x: -4.8 + randomValue() * 14.7, z: .58 + randomValue() * 25.92,
      radius: .20 + randomValue() ** .55 * .30 };
    if (!courtContains(candidate.x, candidate.z)) continue;
    const gx = Math.floor(candidate.x / cellSize), gz = Math.floor(candidate.z / cellSize);
    let close = false;
    for (let dx = -2; dx <= 2 && !close; dx++) for (let dz = -2; dz <= 2 && !close; dz++) {
      close = (buckets.get(`${gx + dx},${gz + dz}`) ?? []).some(p =>
        (p.x - candidate.x) ** 2 + (p.z - candidate.z) ** 2 < ((p.radius + candidate.radius) * .74) ** 2);
    }
    if (close) continue;
    centers.push(candidate);
    const key = `${gx},${gz}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate); buckets.set(key, bucket);
  }
  let pavers = 0, seams = 0;
  for (const center of centers) {
    // A lightly chamfered court outline, with individual boundary stones worn
    // back into the soil. Full Voronoi cells fit together without a tile grid.
    let cell = [...COURT_OUTLINE];
    for (const other of centers) {
      if (other === center) continue;
      const nx = other.x - center.x, nz = other.z - center.z;
      if (nx * nx + nz * nz > 12) continue;
      cell = clipCell(cell, nx, nz, (other.x ** 2 + other.z ** 2 - center.x ** 2 - center.z ** 2) * .5);
      if (cell.length < 3) break;
    }
    if (cell.length < 3 || randomValue() < .028) continue;
    const cx = cell.reduce((sum, p) => sum + p.x, 0) / cell.length;
    const cz = cell.reduce((sum, p) => sum + p.z, 0) / cell.length;
    const inset = .016 + randomValue() * .030;
    const corners = cell.map(p => {
      const dx = p.x - cx, dz = p.z - cz, length = Math.hypot(dx, dz);
      const scale = Math.max(.65, 1 - inset / Math.max(.05, length));
      return { x: dx * scale, z: dz * scale };
    });
    const footprint: { x: number; z: number }[] = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      footprint.push(a);
      // Longer edges have a small worn bite. This retains shared mortar space
      // while breaking the perfect straight perimeter of a Voronoi cell.
      if (Math.hypot(a.x - b.x, a.z - b.z) > .32 && randomValue() < .55) {
        const t = .3 + randomValue() * .4;
        const erosion = .95 - randomValue() * .05;
        footprint.push({ x: lerp(a.x, b.x, t) * erosion, z: lerp(a.z, b.z, t) * erosion });
      }
    }
    const paverTarget = dampTarget && randomValue() < .24 ? dampTarget : target;
    appendPaver(paverTarget, { x: cx, z: cz, width: 1, depth: 1, rotation: 0,
      top: .019 + randomValue() * .038, wear: .008 + randomValue() * .036,
      tone: -.55 + randomValue() * 1.5, footprint }, randomValue);
    pavers += 1;
    if (pavers % 4 === 0) {
      const a = cell[0], b = cell[1];
      appendMossStrip(moss, (a.x + b.x) * .5, (a.z + b.z) * .5,
        Math.hypot(b.x - a.x, b.z - a.z) * .7, .035,
        Math.atan2(b.z - a.z, b.x - a.x), randomValue(), pavers);
      seams += 1;
    }
  }
  return { pavers, seams };
}

function addRibbon(
  target: Builder,
  moss: Builder,
  randomValue: () => number,
  points: { x: number; z: number }[],
  width: number,
  dampTarget: Builder | undefined,
  paversRef: { value: number },
  seamsRef: { value: number },
): void {
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const start = points[segment];
    const end = points[segment + 1];
    const dx = end.x - start.x, dz = end.z - start.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / 1.34));
    const tangent = { x: dx / distance, z: dz / distance };
    const normal = { x: -tangent.z, z: tangent.x };
    for (let step = 0; step < steps; step += 1) {
      const amount = (step + .43 + randomValue() * .18) / steps;
      const centerX = lerp(start.x, end.x, amount);
      const centerZ = lerp(start.z, end.z, amount);
      const acrossCount = Math.max(2, Math.ceil(width / .92));
      for (let across = 0; across < acrossCount; across += 1) {
        const lane = (across + .5) / acrossCount - .5;
        const cx = centerX + normal.x * lane * width + (randomValue() - .5) * .16;
        const cz = centerZ + normal.z * lane * width + (randomValue() - .5) * .16;
        // The road joins the court; overlapping a second layer of stones here
        // caused coplanar faces and dark flicker between the two courses.
        const insideCourt = courtContains(cx, cz);
        const rotation = Math.atan2(tangent.z, tangent.x) + (randomValue() - .5) * .18;
        if (intersectsBridgeCorridor(cx, cz, .68, .48, rotation) || insideCourt) continue;
        const paverTarget = dampTarget && randomValue() < .20 ? dampTarget : target;
        appendPaver(paverTarget, {
          x: cx,
          z: cz,
          width: .53 + randomValue() * .14,
          depth: .36 + randomValue() * .11,
          rotation,
          top: .016 + randomValue() * .025,
          wear: randomValue() < .18 ? .028 + randomValue() * .018 : randomValue() * .010,
          tone: .05 + randomValue() * .9,
        }, randomValue);
        paversRef.value += 1;
      }
      if (step % 2 === 0) {
        const sx = centerX + normal.x * (randomValue() - .5) * width;
        const sz = centerZ + normal.z * (randomValue() - .5) * width;
        const seamRotation = Math.atan2(tangent.z, tangent.x) + Math.PI / 2;
        const seamLength = width * .72;
        const seamWidth = .05 + randomValue() * .028;
        if (intersectsBridgeCorridor(sx, sz, seamLength * .5, seamWidth * .5, seamRotation)) continue;
        appendMossStrip(moss, sx, sz, seamLength, seamWidth, seamRotation, randomValue(), step + segment * 17);
        seamsRef.value += 1;
      }
    }
  }
}

// Six authored fracture outlines: a long split slab, a stepped wedge, a broad
// shelf, a broken corner, a tapered heel and a compact fallen block. Their
// straight cleavage faces replace the radial lobes of the old rounded stones.
// Every point stays inside the conservative bridge-clearance envelope above.
const OUTCROP_FORMS = [
  [[.96,.45],[.65,.86],[-.48,.92],[-.92,.47],[-.84,-.66],[-.35,-.94],[.68,-.79],[.98,-.29]],
  [[.94,.14],[.48,.93],[-.64,.73],[-.95,.20],[-.72,-.71],[-.06,-.96],[.69,-.68],[.86,-.29]],
  [[.83,.68],[.24,.96],[-.81,.71],[-.96,-.11],[-.65,-.86],[.12,-.93],[.95,-.51],[.94,.23]],
  [[.96,.35],[.46,.91],[-.18,.87],[-.83,.48],[-.94,-.57],[-.47,-.92],[.70,-.77],[.85,-.20]],
  [[.80,.82],[.04,.95],[-.52,.69],[-.95,-.36],[-.71,-.80],[.02,-.94],[.87,-.66],[.96,.04]],
  [[.92,.51],[.51,.90],[-.66,.83],[-.92,.38],[-.87,-.54],[-.37,-.89],[.62,-.94],[.94,-.32]],
] as const;

/** A buried fracture with a sloped shoulder and an offset cleavage crown.
 * Nested outlines keep adjacent layers from folding through one another;
 * their unequal crown heights break the upright masonry silhouette. */
function addOutcrop(target: Builder, spec: OutcropSpec, randomValue: () => number): void {
  const form = OUTCROP_FORMS[Math.floor(randomValue() * OUTCROP_FORMS.length)];
  const sides = form.length;
  const phase = randomValue() * TAU;
  const offsetU = randomValue() * 11, offsetV = randomValue() * 11;
  const baseY = -.36 + randomValue() * .06;
  const top = spec.height * (.88 + randomValue() * .12);
  const height = (x: number, z: number, level: number) => {
    const ridge = Math.sin(x * 4.1 + phase + Math.sin(z * 2.1)) * .014
      + Math.cos(z * 5.3 - phase) * .011;
    return baseY + top * level + ridge * Math.sin(level * Math.PI * .85)
      + spec.topSlope * x / Math.max(.2, spec.width) * level;
  };
  const levels = [0, .23, .58, .85, .985];
  const radii = [.91, 1, .95, .82, .57];
  const mirror = randomValue() < .5 ? -1 : 1;
  // Reverse mirrored outlines to retain their winding. The crown is lower
  // toward the water, exposing a fractured shoulder instead of a vertical wall.
  const outline = [...form].map(([x,z]) => ({ x: x * spec.width * mirror, z: z * spec.depth }));
  if (mirror < 0) outline.reverse();
  const rings = levels.map((level, ring) => outline.map(p => {
    const x = p.x * radii[ring], z = p.z * radii[ring];
    const rotated = rotateXZ(x, z, spec.rotation);
    return point(spec.x + rotated.x, height(x, z, level), spec.z + rotated.z);
  }));
  const arc: number[] = [0];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    arc.push(arc[i] + Math.hypot(outline[next].x - outline[i].x, outline[next].z - outline[i].z));
  }
  const center = point(spec.x, 0, spec.z);
  const color = (p: Point): [number, number, number] => {
    const dry = clamp((p.y - baseY) / .58, 0, 1);
    const variation = 1 + .045 * Math.sin(p.x * 3.7 + p.z * 2.4 + phase);
    const tone = (.53 + spec.tone * .17) * (.65 + dry * .35) * variation;
    return [tone, tone * 1.02, tone * .96];
  };
  const vertex = (p: Point, u: number, cap: boolean): Vertex => ({
    point: p,
    uv: cap ? uv(p.x - spec.x, p.z - spec.z, offsetU, offsetV, .34)
      : verticalUV(u, p.y, baseY, offsetU, offsetV),
    color: color(p),
  });
  for (let row = 0; row < rings.length - 1; row++) {
    const cap = row >= 2;
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      const a = vertex(rings[row][i], arc[i], cap);
      const b = vertex(rings[row][next], arc[i + 1], cap);
      const c = vertex(rings[row + 1][next], arc[i + 1], cap);
      const d = vertex(rings[row + 1][i], arc[i], cap);
      if (cap) addUpwardQuad(target, a, b, c, d, SURFACE_EXPOSED_CAP);
      else addOutwardQuad(target, a, b, c, d, center, SURFACE_SIDE);
    }
  }
  const peak = point(spec.x, height(0, 0, 1), spec.z);
  for (let i = 0; i < sides; i++) {
    addUpwardTriangle(target,
      vertex(rings[4][i], arc[i], true),
      vertex(rings[4][(i + 1) % sides], arc[i + 1], true),
      vertex(peak, 0, true), SURFACE_EXPOSED_CAP);
  }
}

function appendGroundcoverMass(target: Builder, x: number, z: number, scale: number, randomValue: () => number): void {
  const blades = 5 + Math.floor(randomValue() * 4);
  const green: [number, number, number] = [.20 + randomValue() * .10, .35 + randomValue() * .15, .14 + randomValue() * .07];
  for (let index = 0; index < blades; index += 1) {
    const angle = randomValue() * TAU;
    const length = scale * (.26 + randomValue() * .26);
    const width = scale * (.07 + randomValue() * .05);
    const lean = rotateXZ(length, 0, angle);
    const side = rotateXZ(0, width, angle);
    const base = point(x + (randomValue() - .5) * scale * .34, .008, z + (randomValue() - .5) * scale * .34);
    const tip = point(base.x + lean.x, .06 + length * (.62 + randomValue() * .28), base.z + lean.z);
    const left = point(base.x + side.x, base.y + .015, base.z + side.z);
    const right = point(base.x - side.x, base.y + .015, base.z - side.z);
    const tipVertex: Vertex = { point: tip, uv: { u: index * .17, v: 1 }, color: green };
    addTriangle(target,
      { point: left, uv: { u: 0, v: 0 }, color: green },
      tipVertex,
      { point: right, uv: { u: 1, v: 0 }, color: green },
    );
    addTriangle(target,
      { point: right, uv: { u: 1, v: 0 }, color: green },
      tipVertex,
      { point: left, uv: { u: 0, v: 0 }, color: green },
    );
  }
}

/**
 * Keep every emitted bank primitive outside the bridge corridor by bounding
 * its actual rotated XZ radius, rather than relying on the primitive center.
 * Near the landing, depth is shortened first so the bank tapers naturally;
 * only a very narrow chip is repositioned when no depth remains.
 */
function keepOutcropOutsideBridgeGap(spec: OutcropSpec): OutcropSpec {
  const copy = { ...spec };
  // Bound the actual rotated XZ footprint of every emitted ring. The lower
  // ring dominates, while the shoulder's 1.01 scale and the upper-ring bias
  // are included explicitly; depth remains linear so it can be shortened
  // without changing the bank course.
  const widthZExtent = Math.abs(Math.sin(spec.rotation))
    * (spec.width * OUTCROP_PROFILE_MAX + OUTCROP_OUTER_BIAS_MAX);
  const zFactor = Math.max(.0001, Math.abs(Math.cos(spec.rotation)) * OUTCROP_Z_PROFILE_MAX);
  const safety = BRIDGE_GAP_MARGIN + .045;
  const lowerLimit = BRIDGE_GAP_MIN_Z - safety;
  const upperLimit = BRIDGE_GAP_MAX_Z + safety;
  const lowerSide = spec.z < (BRIDGE_GAP_MIN_Z + BRIDGE_GAP_MAX_Z) * .5;
  const availableDepth = (boundary: number, direction: -1 | 1): number => {
    const distance = direction < 0 ? boundary - spec.z - widthZExtent : spec.z - boundary - widthZExtent;
    return distance / zFactor;
  };

  if (lowerSide) {
    const available = availableDepth(lowerLimit, -1);
    if (available >= .16) {
      copy.depth = Math.min(copy.depth, available);
    } else {
      copy.depth = .16;
      copy.z = lowerLimit - widthZExtent - copy.depth * zFactor;
    }
  } else {
    const available = availableDepth(upperLimit, 1);
    if (available >= .16) {
      copy.depth = Math.min(copy.depth, available);
    } else {
      copy.depth = .16;
      copy.z = upperLimit + widthZExtent + copy.depth * zFactor;
    }
  }
  return copy;
}

function bankOutcrops(randomValue: () => number, rocks: Builder, strata: Builder, moss: Builder): { large: number; medium: number; small: number } {
  let large = 0, medium = 0, small = 0;
  const bankSections: { side: -1 | 1; start: number; end: number }[] = [
    { side: -1, start: -24, end: -.65 },
    { side: -1, start: 4.65, end: 24 },
    { side: 1, start: -24, end: -.65 },
    { side: 1, start: 4.65, end: 24 },
  ];

  for (const section of bankSections) {
    let z = section.start + .3 + randomValue() * .35;
    while (z < section.end) {
      const side = section.side;
      const innerX = creekCenter(z) + side * (creekHalfWidth(z) - .22);
      const bankX = innerX + side * (.56 + randomValue() * .36);
      const mainDepth = .70 + randomValue() ** 1.2 * 1.65;
      const mainWidth = .55 + randomValue() * .78;
      const mainHeight = .44 + randomValue() ** 1.3 * (side < 0 ? .54 : .67);
      const spec = keepOutcropOutsideBridgeGap({
        side,
        x: bankX + (randomValue() - .5) * .52,
        z: z + (randomValue() - .5) * .35,
        width: mainWidth,
        depth: mainDepth,
        height: mainHeight,
        rotation: side * (randomValue() - .5) * .42,
        topSlope: side * (.07 + randomValue() * .13),
        tone: .12 + randomValue() * .88,
      });
      addOutcrop(rocks, spec, randomValue);
      // A few smaller water-worn stones interrupt the foot of the bank. These
      // are complete pieces embedded in the bed, replacing floating strata strips.
      if (randomValue() < .7) addOutcrop(strata, keepOutcropOutsideBridgeGap({
        ...spec, x: spec.x - side * spec.width * .76,
        z: spec.z + (randomValue() - .5) * spec.depth,
        width: .24 + randomValue() * .28, depth: .32 + randomValue() * .40,
        height: .29 + randomValue() * .16,
      }), randomValue);
      if (randomValue() > .25) {
        const mossX = spec.x + side * .08;
        const mossZ = spec.z + (randomValue() - .5) * spec.depth;
        const mossLength = spec.depth * .45;
        const mossWidth = .08 + randomValue() * .05;
        const mossRotation = Math.PI / 2 + spec.rotation;
        if (!intersectsBridgeCorridor(mossX, mossZ, mossLength * .5, mossWidth * .5, mossRotation)) {
          appendMossStrip(moss, mossX, mossZ, mossLength, mossWidth, mossRotation, .15 + randomValue() * .5, z + side * 4);
        }
      }
      large += 1;

      // Unequal fracture clusters bury the long shelves at different depths.
      // Their placement is tied to each shelf rather than another river row.
      const fragments = 1 + Math.floor(randomValue() * 3);
      for (let mediumIndex = 0; mediumIndex < fragments; mediumIndex += 1) {
        const offset = side * mainWidth * (mediumIndex ? -.40 : .58);
        addOutcrop(rocks, keepOutcropOutsideBridgeGap({
          side,
          x: spec.x + offset,
          z: spec.z + (randomValue() - .5) * mainDepth * 1.6,
          width: .28 + randomValue() * .32,
          depth: .35 + randomValue() * .43,
          height: .30 + randomValue() * .25,
          rotation: spec.rotation + (randomValue() - .5) * .38,
          topSlope: (randomValue() - .5) * .06,
          tone: .10 + randomValue() * .82,
        }), randomValue);
        medium += 1;
      }
      // Small wedges and chips partly bury the foot of the outcrop.
      for (let chip = 0; chip < 1 + Math.floor(randomValue() * 3); chip += 1) {
        addOutcrop(rocks, keepOutcropOutsideBridgeGap({
          side,
          x: spec.x + side * (randomValue() - .5) * 1.45,
          z: spec.z + (randomValue() - .5) * mainDepth * 1.35,
          width: .20 + randomValue() * .23,
          depth: .27 + randomValue() * .28,
          height: .22 + randomValue() * .15,
          rotation: randomValue() * TAU,
          topSlope: (randomValue() - .5) * .04,
          tone: .05 + randomValue() * .80,
        }), randomValue);
        small += 1;
      }
      z += Math.max(.64, mainDepth * (.72 + randomValue() * .45));
    }
  }

  return { large, medium, small };
}

function marginGroundcover(randomValue: () => number, target: Builder): number {
  const candidateLocations: { x: number; z: number; scale: number }[] = [
    { x: -9.30, z: 2.0, scale: .72 },
    { x: -8.70, z: 6.2, scale: .64 },
    { x: -8.95, z: 11.0, scale: .76 },
    { x: -7.45, z: 14.25, scale: .68 },
    { x: 6.95, z: 2.0, scale: .60 },
    { x: 7.15, z: 6.4, scale: .62 },
    { x: 7.15, z: 12.2, scale: .72 },
    { x: 5.95, z: 14.7, scale: .62 },
    { x: 7.35, z: -1.4, scale: .60 },
    { x: 18.1, z: 7.8, scale: .72 },
    { x: 18.0, z: -1.2, scale: .60 },
    { x: 20.0, z: -8.4, scale: .78 },
    { x: 6.90, z: -4.2, scale: .56 },
  ];
  let masses = 0;
  for (const candidate of candidateLocations) {
    if (inWellClearance(candidate.x, candidate.z)) continue;
    if (Math.hypot(candidate.x - 3, candidate.z - 11) < 2.15) continue;
    appendGroundcoverMass(target, candidate.x + (randomValue() - .5) * .3, candidate.z + (randomValue() - .5) * .3, candidate.scale, randomValue);
    masses += 1;
  }
  return masses;
}

/**
 * Build the low terrain pass.  `seed` is optional but explicit so
 * capture runs and future integration can reproduce identical geometry.
 *
 * The return value exposes counts for the root agent's independent review;
 * all meshes are already attached to `parent` and use shared material clones.
 */
export function buildWoodlandTerrain(
  parent: T.Group,
  materials: MaterialTable,
  seed = 1607,
): WoodlandTerrainResult {
  const randomValue = random(seed);
  const courtMaterial = sharedMaterial(materials.cobble ?? materials.stone, 'woodland-court-stone', '#dfd5bb', .62);
  courtMaterial.bumpScale = .075;
  courtMaterial.metalness = 0;
  const dampCourtMaterial = sharedMaterial(materials.cobble ?? materials.stone, 'woodland-court-stone-damp', '#d0c39f', .51);
  dampCourtMaterial.bumpScale = .086;
  dampCourtMaterial.metalness = 0;
  const bankMaterial = sharedMaterial(materials.rock ?? materials.stone, 'woodland-bank-rock', '#c5c7b4', .78);
  if(materials.moss?.map)mossStone(bankMaterial,materials.moss.map);
  const strataMaterial = sharedMaterial(materials.rock ?? materials.stone, 'woodland-bank-strata', '#aeb8a9', .58);
  const mossMaterial = sharedMaterial(materials.moss ?? materials.ground, 'woodland-moss-seams', '#5d7147', .96);
  const groundcoverMaterial = sharedMaterial(materials.fern ?? materials.moss ?? materials.ground, 'woodland-margin-groundcover', '#55743f', .91);

  const paverGeometry = builder();
  const dampPaverGeometry = builder();
  const mossGeometry = builder();
  const bankGeometry = builder();
  const strataGeometry = builder();
  const groundcoverGeometry = builder();

  const paverCounts = addPaverField(randomValue, paverGeometry, dampPaverGeometry, mossGeometry);
  const paversRef = { value: paverCounts.pavers };
  const seamsRef = { value: paverCounts.seams };
  addRibbon(paverGeometry, mossGeometry, randomValue, [
    { x: -10.2, z: 1.05 },
    { x: -8.4, z: 1.45 },
    { x: -5.8, z: 2.25 },
    { x: -2.4, z: 3.08 },
    { x: 1.3, z: 3.62 },
    { x: 5.2, z: 3.92 },
    { x: 8.15, z: 2.00 },
  ], 2.65, dampPaverGeometry, paversRef, seamsRef);
  addRibbon(paverGeometry, mossGeometry, randomValue, [
    { x: 18.0, z: 2.00 },
    { x: 19.0, z: 1.25 },
    { x: 20.0, z: -.65 },
    { x: 21.0, z: -3.75 },
    { x: 23.0, z: -6.85 },
    { x: 25.1, z: -10.1 },
    { x: 28.3, z: -15.05 },
  ], 2.80, dampPaverGeometry, paversRef, seamsRef);

  addRibbon(paverGeometry, mossGeometry, randomValue, [
    { x: 2.2, z: -.4 }, { x: 1.9, z: -4.8 }, { x: 4.0, z: -9.5 },
    { x: 3.1, z: -14.5 }, { x: 5.0, z: -22.5 },
  ], 2.2, dampPaverGeometry, paversRef, seamsRef);

  const outcropCounts = bankOutcrops(randomValue, bankGeometry, strataGeometry, mossGeometry);
  const groundcoverMasses = marginGroundcover(randomValue, groundcoverGeometry);

  const meshes = [
    createMesh(parent, 'woodland-court-paving', finish(paverGeometry, true), courtMaterial),
    createMesh(parent, 'woodland-court-paving-damp', finish(dampPaverGeometry, true), dampCourtMaterial),
    createMesh(parent, 'woodland-court-moss-seams', finish(mossGeometry), mossMaterial),
    createMesh(parent, 'woodland-creek-bank-outcrops', finish(bankGeometry, true), bankMaterial),
    createMesh(parent, 'woodland-creek-bank-strata', finish(strataGeometry, true), strataMaterial),
    createMesh(parent, 'woodland-margin-groundcover', finish(groundcoverGeometry), groundcoverMaterial),
  ];

  const counts: WoodlandTerrainCounts = {
    pavers: paversRef.value,
    mossSeams: seamsRef.value,
    largeOutcrops: outcropCounts.large,
    mediumOutcrops: outcropCounts.medium,
    smallOutcrops: outcropCounts.small,
    groundcoverMasses,
    triangles: paverGeometry.triangles + dampPaverGeometry.triangles + mossGeometry.triangles + bankGeometry.triangles + strataGeometry.triangles + groundcoverGeometry.triangles,
    meshes: meshes.length,
  };

  return {
    meshes,
    counts,
    markerNames: meshes.map((mesh) => mesh.name),
  };
}
