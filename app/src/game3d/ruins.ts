import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Materials = Record<string, T.MeshStandardMaterial>;

const TAU = Math.PI * 2;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function addMesh(
  parent: T.Object3D,
  geometry: T.BufferGeometry,
  material: T.Material,
  x = 0,
  y = 0,
  z = 0,
) {
  const result = new T.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function stoneBlock(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  const geometry = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(.055, sx * .09, sy * .1, sz * .09));
  const result = addMesh(parent, geometry, material, x, y, z);
  result.rotation.set(rx, ry, rz);
  return result;
}

/** A hand-cut block with one crushed corner and an uneven weathered skin. */
function fracturedStoneGeometry(sx: number, sy: number, sz: number, seed: number) {
  const geometry = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(.065, sx * .11, sy * .11, sz * .11));
  const position = geometry.getAttribute('position');
  const cornerX = seed % 2 === 0 ? -1 : 1;
  const cornerZ = Math.floor(seed / 2) % 2 === 0 ? -1 : 1;
  for (let index = 0; index < position.count; index += 1) {
    let x = position.getX(index);
    let y = position.getY(index);
    let z = position.getZ(index);
    const nx = x / (sx * .5);
    const ny = y / (sy * .5);
    const nz = z / (sz * .5);
    const noise = Math.sin(nx * 12.9898 + ny * 23.233 + nz * 37.719 + seed * 1.618) * .5 + .5;
    x *= .965 + noise * .045;
    z *= .965 + (1 - noise) * .04;
    if (ny > .32 && Math.sign(nx) === cornerX && Math.sign(nz) === cornerZ && Math.abs(nx) + Math.abs(nz) > 1.12) {
      x *= .86;
      z *= .86;
      y -= sy * (.075 + noise * .07);
    } else if (ny > .65) {
      y -= sy * noise * .025;
    }
    position.setXYZ(index, x, y, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function fracturedBlock(
  parent: T.Object3D,
  material: T.Material,
  seed: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  const result = addMesh(parent, fracturedStoneGeometry(sx, sy, sz, seed), material, x, y, z);
  result.rotation.set(rx, ry, rz);
  return result;
}

function beam(
  parent: T.Object3D,
  material: T.Material,
  start: T.Vector3,
  end: T.Vector3,
  radius: number,
  sides = 7,
) {
  const result = addMesh(parent, new T.CylinderGeometry(radius * .88, radius, start.distanceTo(end), sides), material);
  result.position.copy(start).add(end).multiplyScalar(.5);
  result.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  return result;
}

function wedgeGeometry(
  centerX: number,
  centerY: number,
  innerRadiusX: number,
  innerRadiusY: number,
  outerRadiusX: number,
  outerRadiusY: number,
  startAngle: number,
  endAngle: number,
  depth: number,
) {
  const point = (radiusX: number, radiusY: number, angle: number) =>
    new T.Vector2(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY);
  const shape = new T.Shape();
  const innerStart = point(innerRadiusX, innerRadiusY, startAngle);
  const outerStart = point(outerRadiusX, outerRadiusY, startAngle);
  const outerEnd = point(outerRadiusX, outerRadiusY, endAngle);
  const innerEnd = point(innerRadiusX, innerRadiusY, endAngle);
  shape.moveTo(innerStart.x, innerStart.y);
  shape.lineTo(outerStart.x, outerStart.y);
  shape.lineTo(outerEnd.x, outerEnd.y);
  shape.lineTo(innerEnd.x, innerEnd.y);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSize: .018,
    bevelThickness: .022,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function irregularPatchGeometry(width: number, depth: number, seed: number) {
  const rand = random(seed);
  const shape = new T.Shape();
  const points: T.Vector2[] = [];
  const count = 10;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU;
    const uneven = .72 + rand() * .28;
    points.push(new T.Vector2(Math.cos(angle) * width * .5 * uneven, Math.sin(angle) * depth * .5 * uneven));
  }
  shape.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) shape.lineTo(points[index].x, points[index].y);
  shape.closePath();
  return new T.ShapeGeometry(shape);
}

function bridgeDeckHeight(x: number) {
  return 1.05 * Math.sin((x - 8.5) / 5 * Math.PI);
}

function bridgeArchBody(material: T.Material, parent: T.Object3D) {
  const shape = new T.Shape();
  const segments = 28;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const x = T.MathUtils.lerp(8.2, 13.8, t);
    const y = bridgeDeckHeight(x) - .14;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let index = segments; index >= 0; index -= 1) {
    const t = index / segments;
    const x = T.MathUtils.lerp(8.2, 13.8, t);
    const y = -.68 + 1.3 * Math.sin(t * Math.PI);
    shape.lineTo(x, y);
  }
  shape.closePath();
  const body = new T.ExtrudeGeometry(shape, {
    depth: 3.7,
    steps: 1,
    bevelEnabled: true,
    bevelSize: .035,
    bevelThickness: .045,
    bevelSegments: 2,
  });
  body.translate(0, 0, 2.15);
  addMesh(parent, body, material);
}

function addBridgeArchStones(parent: T.Object3D, materials: Materials) {
  const rand = random(0x6d2b79f5);
  const count = 15;
  for (const z of [2, 6]) {
    for (let index = 0; index < count; index += 1) {
      const gap = .018 + rand() * .012;
      const start = index / count * Math.PI + gap;
      const end = (index + 1) / count * Math.PI - gap;
      const innerX = 2.66 + (rand() - .5) * .06;
      const innerY = 1.26 + (rand() - .5) * .04;
      const thickness = .34 + rand() * .12;
      const geometry = wedgeGeometry(11, -.67, innerX, innerY, innerX + thickness, innerY + thickness * .72, start, end, .29);
      const stone = addMesh(parent, geometry, materials.rock);
      stone.position.z = z;
      stone.rotation.z = (rand() - .5) * .012;
      stone.scale.set(1 + (rand() - .5) * .05, 1 + (rand() - .5) * .06, 1);
    }
  }
}

function addBridgeDeck(parent: T.Object3D, materials: Materials) {
  const rand = random(0x8f13ab21);
  const along = 13;
  const across = 5;
  const span = 5.6 / along;
  const lane = 3.7 / across;
  for (let row = 0; row < along; row += 1) {
    const x = 8.2 + (row + .5) * span;
    const tangent = Math.atan(1.05 * Math.PI / 5 * Math.cos((x - 8.5) / 5 * Math.PI));
    for (let column = 0; column < across; column += 1) {
      const z = 2.15 + (column + .5) * lane + (row % 2 ? .08 : -.08);
      const slab = stoneBlock(
        parent,
        materials.rock,
        x + (rand() - .5) * .04,
        bridgeDeckHeight(x) - .095,
        z,
        span * (.9 + rand() * .1),
        .17 + rand() * .035,
        lane * (.82 + rand() * .1),
        0,
        (rand() - .5) * .045,
        tangent + (rand() - .5) * .015,
      );
      slab.receiveShadow = true;
    }
  }
}

function addBridgeParapets(parent: T.Object3D, materials: Materials) {
  const rand = random(0x243f6a88);
  const stones = 12;
  for (const z of [1.77, 6.23]) {
    for (let index = 0; index < stones; index += 1) {
      const x = 8.2 + (index + .5) * 5.6 / stones;
      const deckY = bridgeDeckHeight(x);
      const slope = Math.atan(1.05 * Math.PI / 5 * Math.cos((x - 8.5) / 5 * Math.PI));
      const broken = z < 3 ? index === 7 || index === 8 : index === 3 || index === 10;
      if (!broken) {
        const lowerHeight = .43 + rand() * .23;
        const lowerWidth = .43 + rand() * .17;
        fracturedBlock(
          parent,
          materials.rock,
          index + (z > 3 ? 100 : 0),
          x + (rand() - .5) * .035,
          deckY + lowerHeight * .45,
          z,
          lowerWidth,
          lowerHeight,
          .38 + rand() * .035,
          (rand() - .5) * .055,
          (rand() - .5) * .035,
          slope + (rand() - .5) * .045,
        );
        if ((index + (z > 3 ? 1 : 0)) % 5 !== 0) {
          fracturedBlock(
            parent,
            materials.rock,
            index + (z > 3 ? 160 : 60),
            x + (rand() - .5) * .05,
            deckY + lowerHeight + .07,
            z + (rand() - .5) * .025,
            lowerWidth * (.93 + rand() * .18),
            .14 + rand() * .065,
            .42 + rand() * .035,
            (rand() - .5) * .06,
            (rand() - .5) * .045,
            slope + (rand() - .5) * .04,
          );
        }
      } else {
        const fallen = fracturedBlock(parent, materials.rock, 220 + index, x + (z < 3 ? -.1 : .12), deckY + .03, z + (z < 3 ? -.32 : .32), .58, .28, .47);
        fallen.rotation.set(.22, .4, slope + .34);
      }
    }
  }

  for (const [x, z, width, depth, seed] of [
    [8.82, 1.77, 1.15, .34, 13],
    [9.78, 1.77, 1.48, .36, 19],
    [11.0, 6.23, 1.72, .36, 29],
    [12.18, 1.77, 1.44, .35, 41],
    [12.92, 6.23, 1.16, .34, 51],
    [13.48, 6.23, .8, .32, 57],
  ] as const) {
    const patch = addMesh(parent, irregularPatchGeometry(width, depth, seed), materials.moss, x, bridgeDeckHeight(x) + .64, z);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = Math.atan(1.05 * Math.PI / 5 * Math.cos((x - 8.5) / 5 * Math.PI));
    patch.castShadow = false;
  }

  // Thin hanging sheets make the moss read on the front faces as well as from above.
  for (const [x, y, z, width, height, seed] of [
    [9.45, .37, 1.986, 1.35, .44, 301],
    [11.65, .72, 6.014, 1.75, .38, 307],
    [13.15, .12, 1.986, .92, .34, 313],
  ] as const) {
    const patch = addMesh(parent, irregularPatchGeometry(width, height, seed), materials.moss, x, bridgeDeckHeight(x) + y, z);
    patch.castShadow = false;
  }
}

function addBridgeBanks(parent: T.Object3D, materials: Materials) {
  const rand = random(0xbb67ae85);
  for (const x of [7.82, 14.18]) {
    for (const z of [1.55, 6.45]) {
      for (let index = 0; index < 5; index += 1) {
        const stone = addMesh(
          parent,
          new T.DodecahedronGeometry(.34 + rand() * .18, 1),
          index % 4 === 0 ? materials.moss : materials.rock,
          x + (rand() - .5) * .62,
          .18 + rand() * .28,
          z + (rand() - .5) * .56,
        );
        stone.scale.set(1 + rand() * .35, .55 + rand() * .35, .85 + rand() * .35);
        stone.rotation.set(rand(), rand(), rand());
      }
    }
  }
}

function bridgeLantern(parent: T.Object3D, materials: Materials, x: number, z: number) {
  const baseY = bridgeDeckHeight(x);
  const post = stoneBlock(parent, materials.rock, x, baseY + .7, z, .42, 1.32, .42, 0, .03, -.018);
  post.scale.x = .94;
  stoneBlock(parent, materials.rock, x, baseY + 1.37, z, .54, .17, .54, 0, -.03, .02);
  stoneBlock(parent, materials.brass, x, baseY + 1.67, z, .32, .08, .32);
  stoneBlock(parent, materials.glow, x, baseY + 1.91, z, .22, .4, .22);
  stoneBlock(parent, materials.brass, x, baseY + 2.15, z, .36, .08, .36);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stoneBlock(parent, materials.brass, x + sx * .13, baseY + 1.91, z + sz * .13, .025, .46, .025);
  }
  const cap = addMesh(parent, new T.ConeGeometry(.28, .2, 4), materials.brass, x, baseY + 2.29, z);
  cap.rotation.y = Math.PI / 4;
  const light = new T.PointLight('#ffb65b', 11, 4.8, 2);
  light.position.set(x, baseY + 1.91, z);
  light.castShadow = false;
  parent.add(light);
}

/** Builds the traversable, single-vault woodland bridge at its fixed world location. */
export function buildBridge(parent: T.Object3D, materials: Record<string, T.MeshStandardMaterial>): void {
  const m: Materials = {
    ...materials,
    stoneDark: materials.stoneDark ?? materials.stone,
    rock: materials.rock ?? materials.stoneDark ?? materials.stone,
    moss: materials.moss ?? materials.rock ?? materials.stone,
  };
  const group = new T.Group();
  parent.add(group);
  bridgeArchBody(m.stoneDark, group);
  addBridgeArchStones(group, m);
  addBridgeDeck(group, m);
  addBridgeParapets(group, m);
  addBridgeBanks(group, m);
  bridgeLantern(group, m, 8.14, 1.76);
  bridgeLantern(group, m, 13.86, 6.24);
}

function addGatePiers(parent: T.Object3D, materials: Materials) {
  const rand = random(0xa54ff53a);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 9; row += 1) {
      const y = .3 + row * .55;
      for (let column = 0; column < 2; column += 1) {
        const x = side * 2.66 + (column - .5) * .57;
        const material = (row + column + (side > 0 ? 1 : 0)) % 5 === 0 ? materials.stoneDark : materials.rock;
        stoneBlock(
          parent,
          material,
          x + (rand() - .5) * .055,
          y,
          (rand() - .5) * .08,
          .62 + rand() * .055,
          .5 + rand() * .055,
          1.34 + rand() * .08,
          (rand() - .5) * .025,
          (rand() - .5) * .024,
          (rand() - .5) * .035,
        );
      }
    }
  }
}

function addGateRing(parent: T.Object3D, materials: Materials) {
  const rand = random(0x510e527f);
  const count = 17;
  for (let index = 0; index < count; index += 1) {
    // Missing stones at the right shoulder expose a believable crumbling break.
    if (index === 3) continue;
    const gap = .016 + rand() * .012;
    const start = index / count * Math.PI + gap;
    const end = (index + 1) / count * Math.PI - gap;
    const innerX = 2.2 + (rand() - .5) * .035;
    const innerY = 2.28 + (rand() - .5) * .04;
    const outerX = 2.98 + (rand() - .5) * .08;
    const outerY = 3.02 + (rand() - .5) * .08;
    const stone = addMesh(
      parent,
      wedgeGeometry(0, 4.72, innerX, innerY, outerX, outerY, start, end, 1.42 + rand() * .08),
      index === 8 ? materials.stoneDark : materials.rock,
    );
    stone.rotation.z = (rand() - .5) * .012;
    stone.scale.set(1 + (rand() - .5) * .025, 1 + (rand() - .5) * .04, 1);
  }

  // The displaced shoulder block sits in the rubble rather than floating in its gap.
  const fallen = stoneBlock(parent, materials.rock, 3.55, .52, .94, .85, .62, 1.34, .18, .44, -.31);
  fallen.scale.x = 1.12;
}

function addGateWings(parent: T.Object3D, materials: Materials) {
  const rand = random(0x1f83d9ab);
  const columns = [
    { side: -1, x: 3.5, rows: 4 },
    { side: -1, x: 4.25, rows: 3 },
    { side: -1, x: 5.0, rows: 2 },
    { side: -1, x: 5.7, rows: 1 },
    { side: 1, x: 3.5, rows: 3 },
    { side: 1, x: 4.25, rows: 3 },
    { side: 1, x: 5.0, rows: 2 },
    { side: 1, x: 5.75, rows: 1 },
  ];
  for (const column of columns) {
    for (let row = 0; row < column.rows; row += 1) {
      const x = column.side * column.x + (rand() - .5) * .08;
      const y = .31 + row * .58;
      stoneBlock(
        parent,
        row % 5 === 3 ? materials.stoneDark : materials.rock,
        x,
        y,
        (rand() - .5) * .16,
        .78 + rand() * .09,
        .53 + rand() * .07,
        1.28 + rand() * .16,
        (rand() - .5) * .055,
        (rand() - .5) * .06,
        (rand() - .5) * .06,
      );
    }
  }

  for (const [x, y, z, scale, mossy] of [
    [-5.7, .23, 1.02, .58, false], [-4.92, .2, 1.25, .43, true], [-3.85, .24, -1.12, .51, false],
    [4.12, .22, 1.16, .46, true], [5.3, .2, -.92, .54, false], [6.05, .18, .72, .4, false],
  ] as const) {
    const rubble = addMesh(parent, new T.DodecahedronGeometry(scale, 1), mossy ? materials.moss : materials.rock, x, y, z);
    rubble.scale.set(1.18, .65, .92);
    rubble.rotation.set(rand(), rand(), rand());
  }
}

function leafGeometry(length: number, width: number) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([
    0, 0, 0, -width, length * .42, 0, 0, length, .025, width, length * .42, 0,
  ], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([.5, 0, 0, .42, .5, 1, 1, .42], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]);
  geometry.computeVertexNormals();
  return geometry;
}

function addGateVines(parent: T.Object3D, materials: Materials) {
  const vines = [
    [new T.Vector3(-3.08, .18, .77), new T.Vector3(-3.22, 2.1, .78), new T.Vector3(-2.76, 4.05, .79), new T.Vector3(-1.9, 5.65, .78)],
    [new T.Vector3(4.35, .1, .76), new T.Vector3(3.68, 1.45, .8), new T.Vector3(3.18, 3.05, .79)],
  ];
  for (let vineIndex = 0; vineIndex < vines.length; vineIndex += 1) {
    const curve = new T.CatmullRomCurve3(vines[vineIndex]);
    addMesh(parent, new T.TubeGeometry(curve, 18, .045, 5, false), materials.moss);
    for (let index = 2; index < 9; index += 2) {
      const t = index / 10;
      const point = curve.getPoint(t);
      const leaf = addMesh(parent, leafGeometry(.36, .13), materials.moss);
      leaf.position.copy(point).add(new T.Vector3(0, 0, .045));
      leaf.rotation.z = (vineIndex ? -1 : 1) * (.45 + index * .07);
      leaf.rotation.y = (vineIndex ? -.2 : .2);
    }
  }

  for (const [x, y, width, depth, seed] of [
    [-2.78, 4.5, .85, .46, 71], [-1.35, 7.12, 1.05, .42, 83], [3.45, 2.8, .72, .5, 97],
  ] as const) {
    const patch = addMesh(parent, irregularPatchGeometry(width, depth, seed), materials.moss, x, y, .79);
    patch.castShadow = false;
  }
}

function addGateRunes(parent: T.Object3D, material: T.Material) {
  const strokes = [
    [new T.Vector3(-2.42, 2.1, .82), new T.Vector3(-2.42, 2.85, .82)],
    [new T.Vector3(-2.68, 2.58, .82), new T.Vector3(-2.42, 2.28, .82)],
    [new T.Vector3(-2.18, 2.58, .82), new T.Vector3(-2.42, 2.28, .82)],
    [new T.Vector3(1.1, 7.15, .82), new T.Vector3(1.32, 7.48, .82)],
    [new T.Vector3(1.32, 7.48, .82), new T.Vector3(1.55, 7.12, .82)],
    [new T.Vector3(2.52, 4.17, .82), new T.Vector3(2.3, 4.48, .82)],
  ];
  for (const [start, end] of strokes) beam(parent, material, start, end, .026, 6).castShadow = false;
}

function addGateCarvedTrim(parent: T.Object3D, materials: Materials) {
  const layers = [
    { innerX: 2.1, innerY: 2.16, outerX: 2.22, outerY: 2.3, z: .82, material: materials.stoneDark },
    { innerX: 2.34, innerY: 2.4, outerX: 2.46, outerY: 2.54, z: .835, material: materials.rock },
  ];
  const segments = 18;
  for (const layer of layers) {
    for (let index = 0; index < segments; index += 1) {
      // Echo the missing structural shoulder stone without destroying the inner silhouette.
      if (index === 3 && layer.innerX > 2.2) continue;
      const gap = .013;
      const trim = addMesh(
        parent,
        wedgeGeometry(
          0,
          4.72,
          layer.innerX,
          layer.innerY,
          layer.outerX,
          layer.outerY,
          index / segments * Math.PI + gap,
          (index + 1) / segments * Math.PI - gap,
          .105,
        ),
        layer.material,
      );
      trim.position.z = layer.z;
    }
  }

  for (const side of [-1, 1]) {
    beam(parent, materials.stoneDark, new T.Vector3(side * 2.1, .3, .83), new T.Vector3(side * 2.1, 4.73, .83), .064, 7);
    beam(parent, materials.rock, new T.Vector3(side * 2.35, .32, .845), new T.Vector3(side * 2.35, 4.68, .845), .052, 7);
  }
}

function addGatePortal(
  parent: T.Object3D,
  portalMaterial: T.MeshStandardMaterial,
  runeMaterial: T.MeshStandardMaterial,
) {
  // A shallow ellipsoid gives the portal real volume and remains traversable.
  const portal = addMesh(parent, new T.SphereGeometry(1, 24, 18), portalMaterial, 0, 3.47, -.28);
  portal.scale.set(1.83, 3.12, .3);
  portal.castShadow = false;
  portal.receiveShadow = false;
  portal.userData.dynamic = true;
  portal.renderOrder = 1;

  // Nested ripples sit behind the carved front face and reveal the recess when rotated.
  for (let index = 0; index < 3; index += 1) {
    const ripple = addMesh(parent, new T.TorusGeometry(.58 + index * .17, .018 + index * .004, 5, 28), runeMaterial, 0, 3.55, -.02 - index * .07);
    ripple.scale.set(1.42, 2.05, 1);
    ripple.castShadow = false;
  }

  const light = new T.PointLight('#7650b5', 12, 8.5, 2);
  light.position.set(0, 4.05, .15);
  light.castShadow = false;
  parent.add(light);
}

/** Builds the broken guardian gate around a clear 4.4-unit arched opening. */
export function buildRuinedGate(
  parent: T.Object3D,
  materials: Record<string, T.MeshStandardMaterial>,
  x = 27,
  z = -15,
): void {
  const runeMaterial = new T.MeshStandardMaterial({
    color: '#8666ad',
    emissive: '#7042b6',
    emissiveIntensity: .85,
    roughness: .58,
  });
  const portalMaterial = new T.MeshStandardMaterial({
    color: '#72569a',
    emissive: '#56378c',
    emissiveIntensity: .55,
    roughness: .95,
    transparent: true,
    opacity: .075,
    depthWrite: false,
    side: T.DoubleSide,
  });
  const m: Materials = {
    ...materials,
    stoneDark: materials.stoneDark ?? materials.stone,
    rock: materials.rock ?? materials.stoneDark ?? materials.stone,
    moss: materials.moss ?? materials.rock ?? materials.stone,
  };
  const group = new T.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  addGatePiers(group, m);
  addGateRing(group, m);
  addGateWings(group, m);
  addGateCarvedTrim(group, m);
  addGatePortal(group, portalMaterial, runeMaterial);
  addGateVines(group, m);
  addGateRunes(group, runeMaterial);
}
