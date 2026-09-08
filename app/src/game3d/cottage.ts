import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Materials = Record<string, T.MeshStandardMaterial>;

const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

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

function box(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
) {
  const actual = addMesh(parent, new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(.045, sx * .12, sy * .12, sz * .12)), material, x, y, z);
  actual.rotation.y = ry;
  return actual;
}

function beam(
  parent: T.Object3D,
  material: T.Material,
  start: T.Vector3,
  end: T.Vector3,
  radius: number,
  endRadius = radius * .88,
) {
  const result = addMesh(parent, new T.CylinderGeometry(endRadius, radius, start.distanceTo(end), 8), material);
  result.position.copy(start).add(end).multiplyScalar(.5);
  result.quaternion.setFromUnitVectors(V(0, 1, 0), end.clone().sub(start).normalize());
  return result;
}

function crookedBeam(
  parent: T.Object3D,
  material: T.Material,
  start: T.Vector3,
  end: T.Vector3,
  radius: number,
  bow = .07,
) {
  const midpoint = start.clone().lerp(end, .5);
  midpoint.x += bow;
  midpoint.z -= bow * .45;
  const curve = new T.QuadraticBezierCurve3(start, midpoint, end);
  return addMesh(parent, new T.TubeGeometry(curve, 5, radius, 7, false), material);
}

function ring(
  parent: T.Object3D,
  material: T.Material,
  x: number,
  y: number,
  z: number,
  radius: number,
  tube: number,
  frontFacing = false,
) {
  const result = addMesh(parent, new T.TorusGeometry(radius, tube, 6, 24), material, x, y, z);
  if (!frontFacing) result.rotation.x = Math.PI / 2;
  return result;
}

function gableFace(parent: T.Object3D, material: T.Material, z: number) {
  const shape = new T.Shape();
  shape.moveTo(-2.95, 3.32);
  shape.lineTo(0, 6.85);
  shape.lineTo(2.95, 3.32);
  shape.closePath();
  return addMesh(parent, new T.ShapeGeometry(shape), material, 0, 0, z);
}

function remapShingleUv(geometry: T.BufferGeometry, column: number, row: number) {
  const uv = geometry.getAttribute('uv');
  const u0 = (column % 8) / 8;
  const v0 = (row % 10) / 10;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, u0 + uv.getX(index) / 8, v0 + uv.getY(index) / 10);
  }
  uv.needsUpdate = true;
}

/** Layered, bowed roof planes made from physical shingles rather than a flat prism. */
function shingledRoof(
  parent: T.Object3D,
  material: T.Material,
  wood: T.Material,
  centerX: number,
  centerZ: number,
  halfWidth: number,
  halfDepth: number,
  eaveY: number,
  ridgeY: number,
  rows: number,
  columns: number,
) {
  const slopeLength = Math.hypot(halfWidth, ridgeY - eaveY);
  const tileLength = slopeLength / rows * 1.18;
  const tileDepth = halfDepth * 2 / columns * 1.2;

  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row += 1) {
      const t = (row + .48) / rows;
      const x = centerX + side * (halfWidth * t + .08 * Math.sin(t * Math.PI));
      const y = eaveY + (ridgeY - eaveY) * Math.pow(1 - t, 1.22) + .16 * Math.pow(t, 7);
      const nextT = Math.min(1, t + .02);
      const nextX = halfWidth * nextT + .08 * Math.sin(nextT * Math.PI);
      const nextY = eaveY + (ridgeY - eaveY) * Math.pow(1 - nextT, 1.22) + .16 * Math.pow(nextT, 7);
      const angle = Math.atan2(nextY - y, nextX - halfWidth * t - .08 * Math.sin(t * Math.PI));

      for (let column = 0; column < columns; column += 1) {
        const stagger = row % 2 === 0 ? 0 : tileDepth * .48;
        const z = centerZ - halfDepth - tileDepth * .06 + column * tileDepth / 1.2 + stagger;
        if (z > centerZ + halfDepth + tileDepth * .15) continue;
        const geometry = new RoundedBoxGeometry(tileLength, .105, tileDepth, 2, .035);
        remapShingleUv(geometry, column, row);
        const tile = addMesh(parent, geometry, material, x, y, z);
        tile.rotation.z = side * angle;
        tile.rotation.x = ((column * 13 + row * 7) % 9 - 4) * .0035;
      }
    }

    crookedBeam(
      parent,
      wood,
      V(centerX + side * halfWidth, eaveY - .02, centerZ - halfDepth - .22),
      V(centerX + side * halfWidth, eaveY + .04, centerZ + halfDepth + .25),
      .115,
      side * .05,
    );
  }

  crookedBeam(parent, wood, V(centerX, ridgeY + .02, centerZ - halfDepth - .34), V(centerX, ridgeY + .08, centerZ + halfDepth + .38), .14, .07);
  for (const z of [centerZ - halfDepth - .22, centerZ + halfDepth + .22]) {
    beam(parent, wood, V(centerX, ridgeY, z), V(centerX - halfWidth, eaveY, z), .115);
    beam(parent, wood, V(centerX, ridgeY, z), V(centerX + halfWidth, eaveY, z), .115);
  }
}

function archedWindow(
  parent: T.Object3D,
  materials: Materials,
  x: number,
  y: number,
  z: number,
  scale = 1,
) {
  const group = new T.Group();
  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  parent.add(group);

  const recess = new T.Shape();
  recess.moveTo(-.48, 0);
  recess.lineTo(-.48, .73);
  recess.absarc(0, .73, .48, Math.PI, 0, true);
  recess.lineTo(.48, 0);
  recess.closePath();
  addMesh(group, new T.ExtrudeGeometry(recess, { depth: .08, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2 }), materials.dark, 0, 0, -.09);
  addMesh(group, new T.ShapeGeometry(recess), materials.glow, 0, 0, .015);

  for (const side of [-1, 1]) crookedBeam(group, materials.wood, V(side * .54, -.08, .09), V(side * .54, .75, .09), .07, side * .025);
  const arch = addMesh(group, new T.TorusGeometry(.55, .072, 6, 24, Math.PI), materials.wood, 0, .75, .09);
  arch.rotation.z = 0;
  box(group, materials.wood, 0, -.025, .1, 1.2, .13, .16);
  box(group, materials.wood, 0, .47, .105, .065, 1.13, .08);
  box(group, materials.wood, 0, .57, .105, 1.04, .06, .08);

  for (const offset of [-.27, .27]) {
    box(group, materials.brass, offset, .47, .13, .025, .96, .022);
  }
}

function door(parent: T.Object3D, materials: Materials) {
  const group = new T.Group();
  group.position.set(0, .52, 2.57);
  parent.add(group);

  const archShape = new T.Shape();
  archShape.moveTo(-.72, 0);
  archShape.lineTo(-.72, 1.55);
  archShape.absarc(0, 1.55, .72, Math.PI, 0, true);
  archShape.lineTo(.72, 0);
  archShape.closePath();
  addMesh(group, new T.ExtrudeGeometry(archShape, { depth: .12, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 2 }), materials.dark, 0, 0, -.13);
  addMesh(group, new T.ShapeGeometry(archShape), materials.wood, 0, 0, .015);

  for (let index = -3; index <= 3; index += 1) {
    box(group, index % 2 === 0 ? materials.bark : materials.wood, index * .19, .91, .07, .155, 1.76, .1);
  }
  for (const y of [.28, 1.1, 1.72]) box(group, materials.dark, 0, y, .145, 1.3, .065, .055);
  for (const side of [-1, 1]) crookedBeam(group, materials.wood, V(side * .82, -.08, .1), V(side * .82, 1.56, .1), .1, side * .035);
  const arch = addMesh(group, new T.TorusGeometry(.82, .105, 7, 28, Math.PI), materials.wood, 0, 1.57, .1);
  arch.rotation.z = 0;

  ring(group, materials.brass, .42, .9, .2, .105, .027, true);
  addMesh(group, new T.SphereGeometry(.055, 10, 7), materials.brass, .42, .9, .22);

  // Tiny carved leaf motif over the lintel adds a readable crafted focal point.
  for (const side of [-1, 1]) {
    const leaf = addMesh(group, new T.SphereGeometry(.16, 8, 6), materials.moss, side * .18, 2.23, .18);
    leaf.scale.set(.48, 1, .2);
    leaf.rotation.z = side * .7;
  }
  beam(group, materials.brass, V(0, 2.08, .2), V(0, 2.45, .2), .022);
}

function lantern(parent: T.Object3D, materials: Materials, x: number, y: number, z: number) {
  const group = new T.Group();
  group.position.set(x, y, z);
  parent.add(group);
  box(group, materials.brass, 0, -.25, 0, .31, .08, .31);
  box(group, materials.brass, 0, .25, 0, .35, .07, .35);
  const cap = addMesh(group, new T.ConeGeometry(.28, .2, 4), materials.brass, 0, .39, 0);
  cap.rotation.y = Math.PI / 4;
  box(group, materials.glow, 0, 0, 0, .21, .44, .21);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(group, materials.dark, sx * .13, 0, sz * .13, .035, .52, .035);
  ring(group, materials.brass, 0, .54, 0, .16, .025);

  const light = new T.PointLight('#ffaf4a', 11, 6, 2);
  light.position.set(x, y, z + .16);
  parent.add(light);
}

function stoneFoundation(parent: T.Object3D, materials: Materials) {
  const stone = materials.stone;
  const darkStone = materials.stoneDark ?? materials.rock;
  const courses = [
    { y: .18, count: 15, size: .43 },
    { y: .5, count: 14, size: .46 },
    { y: .81, count: 15, size: .42 },
  ];
  for (const { y, count, size } of courses) {
    for (let index = 0; index < count; index += 1) {
      const x = -3.08 + index * 6.16 / (count - 1);
      const z = index % 2 === 0 ? 2.48 : -2.48;
      const material = (index + Math.round(y * 10)) % 4 === 0 ? darkStone : stone;
      const block = box(parent, material, x, y, z, size * (1 + index % 3 * .06), .28, .38, (index % 3 - 1) * .025);
      block.rotation.z = (index % 5 - 2) * .008;
    }
  }
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row += 1) {
      for (let index = 0; index < 10; index += 1) {
        const z = -2.14 + index * .47;
        box(parent, (index + row) % 5 === 0 ? darkStone : stone, side * 3.05, .18 + row * .31, z, .36, .27, .43, (index % 3 - 1) * .02);
      }
    }
  }
}

function timberFrame(parent: T.Object3D, materials: Materials) {
  const wood = materials.wood;
  for (const x of [-3.02, -1.48, 0, 1.48, 3.02]) {
    crookedBeam(parent, wood, V(x, .78, 2.54), V(x + (x === 0 ? .03 : Math.sign(x) * .035), 3.62, 2.54), .095, x * .012);
  }
  for (const y of [.9, 3.53]) crookedBeam(parent, wood, V(-3.08, y, 2.55), V(3.08, y + .02, 2.55), .105, -.05);
  for (const side of [-1, 1]) {
    for (const z of [-2.32, -.7, .92, 2.42]) crookedBeam(parent, wood, V(side * 3.04, .82, z), V(side * 3.04, 3.55, z + .025), .09, side * .05);
    crookedBeam(parent, wood, V(side * 3.05, 1.0, -2.18), V(side * 3.05, 3.45, -.65), .075, side * .04);
    crookedBeam(parent, wood, V(side * 3.05, 1.0, .75), V(side * 3.05, 3.45, 2.3), .075, -side * .04);
  }

  // Front gable frame forms a large crooked arch around the central upper window.
  beam(parent, wood, V(-2.95, 3.39, 2.59), V(0, 6.86, 2.59), .115);
  beam(parent, wood, V(2.95, 3.39, 2.59), V(0, 6.86, 2.59), .115);
  crookedBeam(parent, wood, V(0, 3.5, 2.6), V(0, 6.72, 2.6), .095, .08);
  beam(parent, wood, V(-2.6, 3.58, 2.6), V(-1.02, 5.18, 2.6), .075);
  beam(parent, wood, V(2.6, 3.58, 2.6), V(1.02, 5.18, 2.6), .075);
  beam(parent, wood, V(-1.24, 4.18, 2.61), V(1.24, 4.18, 2.61), .08);
}

function chimney(parent: T.Object3D, materials: Materials) {
  const group = new T.Group();
  group.position.set(-1.72, 0, -.92);
  group.rotation.z = -.025;
  parent.add(group);
  const darkStone = materials.stoneDark ?? materials.rock;
  for (let row = 0; row < 11; row += 1) {
    const y = 3.5 + row * .42;
    const width = row > 8 ? .93 : .78;
    for (let column = 0; column < 2; column += 1) {
      const x = (column - .5) * width * .52 + (row % 2 ? .1 : -.1);
      box(group, (row + column) % 4 === 0 ? darkStone : materials.stone, x, y, 0, width * .52, .38, .84, (row % 3 - 1) * .018);
    }
  }
  box(group, darkStone, 0, 8.12, 0, 1.08, .22, 1.08, .02);
  for (const x of [-.32, .32]) box(group, materials.stone, x, 8.3, 0, .3, .2, .85);
}

function annex(parent: T.Object3D, materials: Materials) {
  const group = new T.Group();
  parent.add(group);
  box(group, materials.stone, -3.98, .42, .1, 2.2, .8, 4.35);
  box(group, materials.plaster, -3.96, 1.85, .08, 2.04, 2.45, 4.15);
  for (const z of [-1.88, -.55, .78, 2.1]) crookedBeam(group, materials.wood, V(-5.08, .78, z), V(-5.08, 3.04, z), .085, .035);
  crookedBeam(group, materials.wood, V(-5.08, .84, -1.93), V(-5.08, .86, 2.18), .09, -.07);
  crookedBeam(group, materials.wood, V(-5.08, 2.92, -1.93), V(-5.08, 3.0, 2.18), .09, .06);
  beam(group, materials.wood, V(-5.09, 1.02, -1.7), V(-5.09, 2.83, -.45), .07);
  beam(group, materials.wood, V(-5.09, 1.02, .5), V(-5.09, 2.83, 1.76), .07);
  shingledRoof(group, materials.roof, materials.wood, -3.94, .08, 1.17, 2.32, 2.9, 4.48, 7, 9);

  const windowGroup = new T.Group();
  windowGroup.position.set(-5.12, .95, .45);
  windowGroup.rotation.y = -Math.PI / 2;
  group.add(windowGroup);
  archedWindow(windowGroup, materials, 0, 0, 0, .85);

  for (const z of [-1.3, 1.55]) {
    const moss = addMesh(group, new T.DodecahedronGeometry(.38, 1), materials.moss, -5.04, .77, z);
    moss.scale.set(.22, .26, 1.05);
  }
}

function porch(parent: T.Object3D, materials: Materials) {
  // Three worn steps stay low enough to preserve the view of the carved door.
  for (let index = 0; index < 3; index += 1) {
    const width = 2.55 + index * .36;
    const step = box(parent, index === 1 ? materials.rock : materials.stone, 0, .12 + index * .12, 3.38 - index * .32, width, .24, .58);
    step.rotation.y = (index - 1) * .009;
  }

  // Crooked posts and braces create a deep threshold instead of a pasted-on canopy.
  for (const side of [-1, 1]) {
    crookedBeam(parent, materials.wood, V(side * 1.35, .35, 3.1), V(side * 1.32, 3.22, 3.06), .115, side * .07);
    beam(parent, materials.wood, V(side * 1.32, 2.72, 3.06), V(side * .72, 3.28, 2.76), .075);
  }
  crookedBeam(parent, materials.wood, V(-1.45, 3.16, 3.02), V(1.45, 3.22, 3.02), .12, .04);

  shingledRoof(parent, materials.roof, materials.wood, 0, 2.84, 1.58, .72, 2.92, 4.05, 5, 5);
  door(parent, materials);
}

function barrel(parent: T.Object3D, materials: Materials, x: number, z: number, scale = 1) {
  const body = addMesh(parent, new T.CylinderGeometry(.38 * scale, .4 * scale, .82 * scale, 12), materials.wood, x, .42 * scale, z);
  body.scale.set(1, 1, .92);
  for (const y of [.12, .4, .7]) ring(parent, materials.dark, x, y * scale, z, .4 * scale, .028 * scale);
  addMesh(parent, new T.CylinderGeometry(.34 * scale, .34 * scale, .035, 12), materials.dark, x, .84 * scale, z);
}

function flowerBox(parent: T.Object3D, materials: Materials, x: number, y: number, z: number) {
  box(parent, materials.wood, x, y, z, 1.15, .29, .34);
  box(parent, materials.dark, x, y + .14, z, 1.0, .08, .23);
  for (let index = 0; index < 7; index += 1) {
    const fx = x - .45 + index * .15;
    const fy = y + .3 + (index % 3) * .055;
    beam(parent, materials.moss, V(fx, y + .12, z), V(fx + (index % 2 ? .05 : -.04), fy, z + .015), .018);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = petal / 5 * TAU;
      const bloom = addMesh(parent, new T.SphereGeometry(.075, 6, 4), index % 2 ? materials.glow : materials.plaster, fx + Math.cos(angle) * .07, fy + Math.sin(angle) * .07, z + .2);
      bloom.scale.set(.9, .55, .35);
    }
  }
}

function acornSign(parent: T.Object3D, materials: Materials) {
  crookedBeam(parent, materials.wood, V(2.42, 3.22, 2.72), V(2.42, 3.25, 4.05), .075, -.08);
  beam(parent, materials.wood, V(2.38, 3.22, 3.78), V(2.0, 2.82, 3.72), .055);
  for (const x of [2.12, 2.66]) beam(parent, materials.brass, V(x, 3.15, 3.93), V(x, 2.75, 3.93), .018);

  // A fully modeled acorn silhouette remains legible when the sign turns edge-on.
  const nut = addMesh(parent, new T.SphereGeometry(.4, 12, 8), materials.wood, 2.39, 2.33, 3.93);
  nut.scale.set(.8, 1.15, .26);
  const cap = addMesh(parent, new T.SphereGeometry(.35, 12, 6, 0, TAU, 0, Math.PI / 2), materials.dark, 2.39, 2.57, 3.93);
  cap.scale.set(.95, .58, .3);
  beam(parent, materials.wood, V(2.39, 2.76, 3.93), V(2.48, 2.91, 3.93), .028);
  for (let index = 0; index < 5; index += 1) {
    const groove = addMesh(parent, new T.TorusGeometry(.2 + index * .018, .012, 4, 12, Math.PI), materials.brass, 2.39, 2.36 - index * .065, 4.04);
    groove.scale.set(1, .7, 1);
  }
}

function roofMoss(parent: T.Object3D, materials: Materials) {
  const patches = [
    [-2.42, 4.06, -1.75, .62, .08, .45, -.76],
    [2.55, 3.94, .94, .5, .07, .38, .74],
    [-.7, 6.45, -1.95, .58, .07, .3, -.15],
  ] as const;
  for (const [x, y, z, sx, sy, sz, rz] of patches) {
    const patch = addMesh(parent, new T.DodecahedronGeometry(1, 1), materials.moss, x, y, z);
    patch.scale.set(sx, sy, sz);
    patch.rotation.z = rz;
  }
}

/**
 * Builds the hero woodland inn. The closed structural collision footprint is
 * local x[-5.2, 3.2], z[-2.5, 2.8]; low steps and props project to z=3.7.
 */
export function buildCottage(
  parent: T.Object3D,
  materials: Record<string, T.MeshStandardMaterial>,
  x: number,
  z: number,
  scale = 1,
): void {
  const group = new T.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  parent.add(group);

  const m: Materials = {
    ...materials,
    wood: materials.wood ?? materials.bark,
    bark: materials.bark ?? materials.wood,
    stoneDark: materials.stoneDark ?? materials.rock ?? materials.stone,
  };

  stoneFoundation(group, m);
  box(group, m.plaster, 0, 2.18, 0, 5.95, 2.75, 4.85);
  gableFace(group, m.plaster, 2.48);
  gableFace(group, m.plaster, -2.48).rotation.y = Math.PI;
  timberFrame(group, m);

  archedWindow(group, m, -1.72, 1.32, 2.6, .86);
  archedWindow(group, m, 1.72, 1.28, 2.6, .92);
  archedWindow(group, m, 0, 4.46, 2.62, .86);
  for (const side of [-1, 1]) {
    const sideGroup = new T.Group();
    sideGroup.position.set(side * 3.08, 0, 0);
    sideGroup.rotation.y = side * Math.PI / 2;
    group.add(sideGroup);
    archedWindow(sideGroup, m, -.92, 1.35, 0, .75);
    archedWindow(sideGroup, m, 1.2, 1.42, 0, .68);
  }

  shingledRoof(group, m.roof, m.wood, 0, 0, 3.28, 2.76, 3.48, 7.18, 11, 11);
  chimney(group, m);
  annex(group, m);
  porch(group, m);
  acornSign(group, m);
  roofMoss(group, m);

  lantern(group, m, -1.14, 2.45, 2.92);
  lantern(group, m, 1.22, 2.44, 2.93);
  barrel(group, m, -2.33, 3.0, 1.03);
  barrel(group, m, 2.9, 2.84, .78);
  flowerBox(group, m, -1.75, 1.05, 2.86);
  flowerBox(group, m, 1.72, 1.0, 2.86);

  // A few foundation weeds soften the join with the forest floor.
  for (const [wx, wz, size] of [[-4.82, 2.22, .28], [-2.78, 2.62, .2], [2.78, 2.5, .24], [-4.98, -1.55, .18]] as const) {
    for (let index = 0; index < 4; index += 1) {
      const blade = addMesh(group, new T.ConeGeometry(.035, size * (1 + index * .12), 5), m.moss, wx + (index - 1.5) * .07, size * .5, wz + (index % 2) * .06);
      blade.rotation.z = (index - 1.5) * .13;
    }
  }
}
