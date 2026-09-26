import * as T from 'three';
import { BRIDGE } from './landscape';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bridgeDeckHeight, hewnOutline, hewnPrismGeometry, layDeckStone, layWallStone } from './bridge-masonry';
import { mossStone } from './stone-surfaces';

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

/** Courses share their joints; random placement cannot leave individual blocks
 * balancing above gaps or overhanging neighbouring stones. */
function bridgeCourse(start: number, end: number, seed: number, min: number, max: number) {
  const rand = random(seed);
  const joints = [start];
  let cursor = start;
  while (cursor < end) {
    const width = min + rand() * (max - min);
    cursor = end - cursor < width + min * .7 ? end : cursor + width;
    joints.push(cursor);
  }
  return joints.slice(0, -1).map((left, index) => [left, joints[index + 1]] as const);
}

function addBridgeArchStones(parent: T.Object3D, materials: Materials) {
  // The same springing and soffit as the structural vault, with radial joints
  // fitted continuously across it. The outer edge closes against the deck.
  const inner = (t: number) => new T.Vector2(8.2 + 5.6 * t, -.68 + 1.3 * Math.sin(t * Math.PI));
  const outer = (t: number) => {
    const x = 8.2 + 5.6 * t - Math.sin(t * Math.PI * 2) * .13;
    return new T.Vector2(x, bridgeDeckHeight(x) - .105);
  };
  const joints = bridgeCourse(0, 1, 0x6d2b79f5, .043, .075);
  for (const [side, z] of [1.99, 6.01].entries()) {
    joints.forEach(([left, right], index) => {
      const start = left + .0011, end = right - .0011, mid = (start + end) * .5;
      const polygon = [inner(start), inner(mid), inner(end), outer(end), outer(mid), outer(start)];
      const geometry = hewnPrismGeometry(polygon, .38, 500 + index + side * 50);
      const stone = addMesh(parent, geometry, materials.rock, 0, 0, z);
      stone.name = 'bridge-arch-stone';
    });
  }
}

function addBridgeDeck(parent: T.Object3D, materials: Materials) {
  // Staggered narrow courses run along the crossing. Unequal bed widths and
  // lengths replace the full-width ladder of fifteen identical slab rows.
  const rows = bridgeCourse(2.035, 5.965, 0x8f13ab21, .42, .68);
  rows.forEach(([near, far], row) => {
    const columns = bridgeCourse(8.2, 13.8, 0x24ad6b + row * 3907, .29, .59);
    columns.forEach(([left, right], column) => {
      const seed = 900 + row * 40 + column;
      const thickness = .16;
      const geometry = hewnPrismGeometry(hewnOutline(right - left - .013, far - near - .013, seed), thickness, seed);
      layDeckStone(geometry, (left + right) * .5, (near + far) * .5, thickness);
      const stone = addMesh(parent, geometry, materials.rock);
      stone.name = 'bridge-deck-stone';
    });
  });
}

/** Stone-scale mapping, restrained face variation, and surface-bound moss. */
function weatherBridge(group: T.Group, materials: Materials): void {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert();
  const worn = materials.rock.clone();
  worn.vertexColors = true;
  worn.roughness = .82;
  worn.bumpScale = .11;
  if (materials.moss.map) mossStone(worn, materials.moss.map);
  const stone = new T.Color('#fff9e8'), moss = new T.Color('#8a995e');
  group.traverse(object => {
    if (!(object instanceof T.Mesh) || object.material !== materials.rock) return;
    object.material = worn;
    const geometry = object.geometry, positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const transform = inverse.clone().multiply(object.matrixWorld), normalMatrix = new T.Matrix3().getNormalMatrix(transform);
    const colors = new Float32Array(positions.count * 3), uvs = new Float32Array(positions.count * 2);
    const bounds = new T.Box3().setFromBufferAttribute(positions), center = bounds.getCenter(new T.Vector3());
    const unitTone = .82 + .18 * (Math.sin(center.x * 8.17 + center.y * 19.1 + center.z * 11.7) * .5 + .5);
    for (let i = 0; i < positions.count; i += 1) {
      const p = new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform);
      const normal = new T.Vector3().fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      const patch = .5 + .28 * Math.sin(p.x * 3.4 + Math.sin(p.z * 2.1)) + .22 * Math.cos(p.z * 4.5 + p.y * 2);
      const sheltered = T.MathUtils.clamp((Math.abs(p.z - 4) - 1.1) * .8, 0, 1);
      // The generated moss map supplies the upper patches. This subdued stain
      // carries growth down the recessed side faces, with no floating sheets.
      const growth = T.MathUtils.smoothstep(patch, .54, .86) * sheltered * .43;
      const tone = unitTone * (.96 + .04 * Math.sin(p.x * 2.3 + p.z * 1.9) ** 2);
      const color = stone.clone().lerp(moss, growth).multiplyScalar(tone);
      colors.set([color.r, color.g, color.b], i * 3);
      const axes = Math.abs(normal.y) > .6 ? [p.x, p.z] : Math.abs(normal.z) > .6 ? [p.x, p.y] : [p.z, p.y];
      uvs.set([axes[0] * .85, axes[1] * .85], i * 2);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
  });
}

function bridgeParapetCore(parent: T.Object3D, material: T.Material, z: number) {
  const shape = new T.Shape();
  const steps = 36;
  for (let i = 0; i <= steps; i += 1) {
    const x = 8.2 + 5.6 * i / steps;
    const y = bridgeDeckHeight(x) + .46;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const x = 8.2 + 5.6 * i / steps;
    shape.lineTo(x, bridgeDeckHeight(x) - .1);
  }
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: .3, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, z - .15);
  const core = addMesh(parent, geometry, material);
  core.name = 'bridge-parapet-core';
}

function addBridgeParapets(parent: T.Object3D, materials: Materials) {
  for (const [side, z] of [1.79, 6.21].entries()) {
    bridgeParapetCore(parent, materials.stoneDark, z);
    // Narrow irregular bed joints sit in a continuous wall, with the second
    // course's vertical joints shifted away from those below.
    for (let course = 0; course < 3; course += 1) {
      const coping = course === 2;
      const bottom = course === 0 ? -.04 : course === 1 ? .245 : .52;
      const height = course === 0 ? .274 : course === 1 ? .264 : .14;
      const spans = bridgeCourse(8.2, 13.8, 0x243f6a88 + side * 731 + course * 3049, coping ? .39 : .28, coping ? .74 : .62);
      spans.forEach(([left, right], index) => {
        const seed = 1700 + side * 190 + course * 37 + index;
        // A single lost coping unit exposes the top bed, not a hole through
        // the whole parapet. The opposite wall's loss is at another joint.
        if (coping && index === (side === 0 ? 5 : 2)) return;
        const depth = coping ? .49 : .43;
        const geometry = hewnPrismGeometry(hewnOutline(right - left - .014, height, seed), depth, seed);
        layWallStone(geometry, (left + right) * .5, bottom, height);
        const stone = addMesh(parent, geometry, materials.rock, 0, 0, z);
        stone.name = coping ? 'bridge-coping-stone' : 'bridge-parapet-stone';
      });
    }
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
  group.scale.x = BRIDGE.scaleX;
  group.position.set(BRIDGE.centerX - 11 * BRIDGE.scaleX, 0, BRIDGE.centerZ - 4);
  parent.add(group);
  bridgeArchBody(m.stoneDark, group);
  addBridgeArchStones(group, m);
  addBridgeDeck(group, m);
  addBridgeParapets(group, m);
  addBridgeBanks(group, m);
  bridgeLantern(group, m, 8.14, 1.76);
  bridgeLantern(group, m, 13.86, 6.24);
  weatherBridge(group,m);
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

  // A small seal marks the road within the recess; the light belongs to the
  // weathered arch instead of drawing a large neon target over its opening.
  const seal = addMesh(parent, new T.TorusGeometry(.12, .018, 5, 28), runeMaterial, 0, 3.55, -.06);
  seal.scale.set(1, 1.4, 1);
  seal.castShadow = false;

  const light = new T.PointLight('#7650b5', 50, 14, 2);
  light.position.set(0, 3.6, 1.6);
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
