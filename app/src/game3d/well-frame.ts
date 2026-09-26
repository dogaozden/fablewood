import * as T from 'three';

type Point = { x: number; y: number; z: number };
type UV = { u: number; v: number };

type Ring = {
  y: number;
  width: number;
  depth: number;
  chamfer: number;
  bowX: number;
  bowZ: number;
  tone: number;
};

const POST_X = 1.25;
const POST_TOP = 3.3;
const SECTION_SIDES = 8;

/**
 * A hand-hewn timber is built from unequal chamfered rings instead of a
 * perfectly square box. The centerline still lands on the existing post
 * endpoints, while the intervening rings bow by a few centimeters.
 */
function postRings(side: -1 | 1): Ring[] {
  const asymmetry = side < 0 ? 1 : -1;
  return [
    { y: 0, width: .218, depth: .205, chamfer: .030, bowX: 0, bowZ: 0, tone: .56 },
    { y: .12, width: .196, depth: .186, chamfer: .022, bowX: side * .012, bowZ: -.006, tone: .70 },
    { y: .72, width: .211 + asymmetry * .006, depth: .192, chamfer: .029, bowX: side * .048, bowZ: .014, tone: .86 },
    { y: 1.48, width: .187, depth: .216 + asymmetry * .006, chamfer: .021, bowX: side * .026, bowZ: -.020, tone: .94 },
    // A slightly fuller, darker shoulder is the worn socket for the existing
    // crossbeam; the next ring eases it back into the tapered upper timber.
    { y: 2.28, width: .226, depth: .202, chamfer: .036, bowX: side * .055, bowZ: .016, tone: .74 },
    { y: 2.42, width: .218, depth: .196, chamfer: .031, bowX: side * .050, bowZ: .014, tone: .78 },
    { y: 2.96, width: .202 + asymmetry * .005, depth: .209, chamfer: .026, bowX: side * .022, bowZ: .008, tone: .89 },
    { y: POST_TOP, width: .208, depth: .198, chamfer: .030, bowX: 0, bowZ: 0, tone: .93 },
  ];
}

function sectionPoints(side: -1 | 1, ring: Ring): Point[] {
  const centerX = side * POST_X + ring.bowX;
  const centerZ = ring.bowZ;
  const w = ring.width;
  const d = ring.depth;
  const c = Math.min(ring.chamfer, w * .38, d * .38);
  // Clockwise when viewed from above; this makes the reversed ring quads face
  // outward and leaves the cap winding explicit below.
  const local: [number, number][] = [
    [-w / 2 + c, -d / 2],
    [w / 2 - c, -d / 2],
    [w / 2, -d / 2 + c],
    [w / 2, d / 2 - c],
    [w / 2 - c, d / 2],
    [-w / 2 + c, d / 2],
    [-w / 2, d / 2 - c],
    [-w / 2, -d / 2 + c],
  ];
  return local.map(([x, z]) => ({ x: centerX + x, y: ring.y, z: centerZ + z }));
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

function timberColor(tone: number, face: number, crack = false): [number, number, number] {
  if (crack) return [.18, .095, .045];
  const faceTone = [1.00, .93, .99, 1.05, .97, .91, .96, 1.03][face];
  return [
    Math.min(.98, .94 * tone * faceTone),
    Math.min(.90, .88 * tone * faceTone),
    Math.min(.66, .78 * tone * faceTone),
  ];
}

function appendTriangle(
  positions: number[],
  uvs: number[],
  colors: number[],
  points: [Point, Point, Point],
  uv: [UV, UV, UV],
  color: [[number, number, number], [number, number, number], [number, number, number]],
): void {
  const normal = faceNormal(points[0], points[1], points[2]);
  if (normal.x * normal.x + normal.y * normal.y + normal.z * normal.z < 1e-10) return;
  points.forEach((point, index) => {
    positions.push(point.x, point.y, point.z);
    uvs.push(uv[index].u, uv[index].v);
    colors.push(color[index][0], color[index][1], color[index][2]);
  });
}

function appendQuad(
  positions: number[],
  uvs: number[],
  colors: number[],
  points: [Point, Point, Point, Point],
  uv: [UV, UV, UV, UV],
  color: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
): void {
  appendTriangle(positions, uvs, colors,
    [points[0], points[1], points[2]], [uv[0], uv[1], uv[2]], [color[0], color[1], color[2]]);
  appendTriangle(positions, uvs, colors,
    [points[0], points[2], points[3]], [uv[0], uv[2], uv[3]], [color[0], color[2], color[3]]);
}

function postGeometry(side: -1 | 1): T.BufferGeometry {
  const rings = postRings(side);
  const ringPoints = rings.map((ring) => sectionPoints(side, ring));
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const uvOffset = side < 0 ? .18 : .63;

  for (let ringIndex = 0; ringIndex < ringPoints.length - 1; ringIndex += 1) {
    const lower = ringPoints[ringIndex];
    const upper = ringPoints[ringIndex + 1];
    for (let face = 0; face < SECTION_SIDES; face += 1) {
      const next = (face + 1) % SECTION_SIDES;
      const u0 = uvOffset + face / SECTION_SIDES * 1.9;
      const u1 = uvOffset + (face + 1) / SECTION_SIDES * 1.9;
      const lowerV = rings[ringIndex].y * .62;
      const upperV = rings[ringIndex + 1].y * .62;
      const points: [Point, Point, Point, Point] = [lower[face], upper[face], upper[next], lower[next]];
      const uv: [UV, UV, UV, UV] = [
        { u: u0, v: lowerV }, { u: u0, v: upperV },
        { u: u1, v: upperV }, { u: u1, v: lowerV },
      ];
      const color: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] = [
        timberColor(rings[ringIndex].tone, face), timberColor(rings[ringIndex + 1].tone, face),
        timberColor(rings[ringIndex + 1].tone, next), timberColor(rings[ringIndex].tone, next),
      ];
      // The vertical ring order and rising Y axis already give each face its
      // outward winding; keep the UV order paired with that face direction.
      appendQuad(positions, uvs, colors,
        [points[0], points[1], points[2], points[3]],
        [uv[0], uv[1], uv[2], uv[3]],
        [color[0], color[1], color[2], color[3]]);
    }
  }

  const bottom = ringPoints[0];
  const top = ringPoints[ringPoints.length - 1];
  const bottomCenter: Point = { x: side * POST_X, y: 0, z: 0 };
  const topCenter: Point = { x: side * POST_X, y: POST_TOP, z: 0 };
  const capColor = timberColor(.62, 0);
  const topColor = timberColor(.92, 3);
  for (let face = 0; face < SECTION_SIDES; face += 1) {
    const next = (face + 1) % SECTION_SIDES;
    appendTriangle(positions, uvs, colors,
      [bottomCenter, bottom[face], bottom[next]],
      [{ u: side * POST_X * .8 + uvOffset, v: 0 }, { u: bottom[face].x * .8 + uvOffset, v: bottom[face].z * .8 }, { u: bottom[next].x * .8 + uvOffset, v: bottom[next].z * .8 }],
      [capColor, capColor, capColor]);
    appendTriangle(positions, uvs, colors,
      [topCenter, top[next], top[face]],
      [{ u: side * POST_X * .8 + uvOffset, v: POST_TOP * .62 }, { u: top[next].x * .8 + uvOffset, v: top[next].z * .8 }, { u: top[face].x * .8 + uvOffset, v: top[face].z * .8 }],
      [topColor, topColor, topColor]);
  }

  // Two narrow, slightly irregular dark cuts on the outward face provide the
  // scale of hand work without adding separate crack meshes or draw calls.
  const outerX = (y: number) => {
    const i = rings.findIndex(ring => ring.y >= y);
    const a = rings[Math.max(0, i - 1)], b = rings[Math.max(0, i)];
    const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
    return side * POST_X + T.MathUtils.lerp(a.bowX, b.bowX, t)
      + side * (T.MathUtils.lerp(a.width, b.width, t) * .5 + .0015);
  };
  const cracks = [
    { y: 1.08, length: .30, z: -.035, drift: .024 },
    { y: 2.12, length: .25, z: .038, drift: -.030 },
  ];
  for (const crack of cracks) {
    const width = .006;
    const a: Point = { x: outerX(crack.y), y: crack.y, z: crack.z - width };
    const b: Point = { x: outerX(crack.y + crack.length), y: crack.y + crack.length, z: crack.z + crack.drift - width };
    const c: Point = { x: outerX(crack.y + crack.length), y: crack.y + crack.length, z: crack.z + crack.drift + width };
    const d: Point = { x: outerX(crack.y), y: crack.y, z: crack.z + width };
    const crackColor = timberColor(1, 0, true);
    const crackUV: [UV, UV, UV, UV] = [
      { u: uvOffset + .32, v: crack.y * .62 }, { u: uvOffset + .34, v: (crack.y + crack.length) * .62 },
      { u: uvOffset + .36, v: (crack.y + crack.length) * .62 }, { u: uvOffset + .34, v: crack.y * .62 },
    ];
    const normal = faceNormal(a, b, c);
    const crackPoints: [Point, Point, Point, Point] = normal.x * side < 0 ? [a, d, c, b] : [a, b, c, d];
    appendQuad(positions, uvs, colors, crackPoints, crackUV,
      [crackColor, crackColor, crackColor, crackColor]);
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.wellFrame = true;
  return geometry;
}

/** Add the two weathered support timbers around the existing well opening. */
export function addWellFrame(parent: T.Group, wood: T.MeshStandardMaterial): void {
  const frameMaterial = wood.clone();
  frameMaterial.name = 'weathered-well-frame';
  frameMaterial.color.set('#c2ae90');
  frameMaterial.vertexColors = true;
  frameMaterial.metalness = 0;
  frameMaterial.roughness = Math.max(.72, wood.roughness * .92);
  frameMaterial.bumpScale = Math.max(.06, Math.min(.14, wood.bumpScale || .10));

  for (const side of [-1, 1] as const) {
    const timber = new T.Mesh(postGeometry(side), frameMaterial);
    timber.name = side < 0 ? 'weathered-well-frame-left' : 'weathered-well-frame-right';
    timber.castShadow = true;
    timber.receiveShadow = true;
    parent.add(timber);
  }
}
