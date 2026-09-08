import * as T from 'three';

type Materials = Record<string, T.MeshStandardMaterial>;

const TAU = Math.PI * 2;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function addMesh(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material) {
  const result = new T.Mesh(geometry, material);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

interface TrunkProfile {
  centerAt: (t: number) => T.Vector3;
  radiusAt: (t: number) => number;
  twistAt: (t: number) => number;
}

function makeTrunkProfile(height: number, radius: number, rand: () => number): TrunkProfile {
  const leanAngle = rand() * TAU;
  const lean = radius * (.55 + rand() * .8);
  const crossBend = radius * (.22 + rand() * .28) * (rand() < .5 ? -1 : 1);
  const phase = rand() * TAU;
  const twist = (rand() < .5 ? -1 : 1) * (.72 + rand() * .8);

  return {
    centerAt(t) {
      const sweep = Math.pow(t, 1.55);
      const wander = Math.sin(t * Math.PI * 2.1 + phase) * crossBend * t;
      return new T.Vector3(
        Math.cos(leanAngle) * lean * sweep + Math.cos(leanAngle + Math.PI / 2) * wander,
        t * height * .84,
        Math.sin(leanAngle) * lean * sweep + Math.sin(leanAngle + Math.PI / 2) * wander,
      );
    },
    radiusAt(t) {
      const taper = .2 + .8 * Math.pow(1 - t, .62);
      const rootFlare = 1 + 1.05 * Math.exp(-t * 15);
      const oldGrowthBulge = 1 + .09 * Math.sin(t * 15 + phase) * Math.pow(1 - t, .35);
      return radius * taper * rootFlare * oldGrowthBulge;
    },
    twistAt(t) {
      return phase + twist * t + .08 * Math.sin(t * 11 + phase);
    },
  };
}

function trunkGeometry(profile: TrunkProfile, sides: number, levels: number, rand: () => number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ridges = Array.from({ length: sides }, () => .82 + rand() * .34);
  const ridgePhases = Array.from({ length: sides }, () => rand() * TAU);

  for (let level = 0; level <= levels; level += 1) {
    const t = level / levels;
    const center = profile.centerAt(t);
    const radius = profile.radiusAt(t);
    const twist = profile.twistAt(t);
    for (let side = 0; side <= sides; side += 1) {
      const wrapped = side % sides;
      const angle = side / sides * TAU + twist;
      const corrugation = ridges[wrapped] * (1 + .055 * Math.sin(t * 18 + ridgePhases[wrapped]));
      const asymmetric = 1 + .07 * Math.sin(angle * 3 + t * 5);
      const radial = radius * corrugation * asymmetric;
      positions.push(
        center.x + Math.cos(angle) * radial,
        center.y,
        center.z + Math.sin(angle) * radial * (.92 + .07 * Math.sin(t * 9)),
      );
      uvs.push(side / sides * 2.2, t * 5.2);

      if (level < levels && side < sides) {
        const here = level * (sides + 1) + side;
        const above = here + sides + 1;
        indices.push(here, above, here + 1, here + 1, above, above + 1);
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function taperedCurveGeometry(
  curve: T.Curve<T.Vector3>,
  startRadius: number,
  endRadius: number,
  segments: number,
  sides: number,
  phase: number,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const frames = curve.computeFrenetFrames(segments, false);

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments;
    const point = curve.getPoint(t);
    const taper = Math.pow(1 - t, 1.35);
    const radius = endRadius + (startRadius - endRadius) * taper * (1 + .045 * Math.sin(t * 17 + phase));
    for (let side = 0; side <= sides; side += 1) {
      const angle = side / sides * TAU + phase * .13;
      const radial = radius * (1 + .07 * Math.sin(angle * 3 + phase));
      const offset = frames.normals[segment].clone().multiplyScalar(Math.cos(angle) * radial)
        .add(frames.binormals[segment].clone().multiplyScalar(Math.sin(angle) * radial));
      positions.push(point.x + offset.x, point.y + offset.y, point.z + offset.z);
      uvs.push(side / sides * 1.8, t * 3.4);

      if (segment < segments && side < sides) {
        const here = segment * (sides + 1) + side;
        const next = here + sides + 1;
        indices.push(here, next, here + 1, here + 1, next, next + 1);
      }
    }
  }

  const endCenter = positions.length / 3;
  const end = curve.getPoint(1);
  positions.push(end.x, end.y, end.z);
  uvs.push(.5, 3.5);
  const lastRing = segments * (sides + 1);
  for (let side = 0; side < sides; side += 1) indices.push(lastRing + side, endCenter, lastRing + side + 1);

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

interface RootModel {
  curve: T.CatmullRomCurve3;
  startRadius: number;
  endRadius: number;
}

function rootGeometry(root: RootModel, segments: number, sides: number, phase: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments;
    const point = root.curve.getPoint(t);
    const tangent = root.curve.getTangent(t);
    const horizontalLength = Math.hypot(tangent.x, tangent.z) || 1;
    const lateral = new T.Vector3(-tangent.z / horizontalLength, 0, tangent.x / horizontalLength);
    const taper = Math.pow(1 - t, 1.5);
    const radius = root.endRadius + (root.startRadius - root.endRadius) * taper;
    for (let side = 0; side <= sides; side += 1) {
      const angle = side / sides * TAU;
      const width = radius * (1 + .08 * Math.sin(angle * 3 + phase));
      const lateralOffset = Math.cos(angle) * width;
      const verticalOffset = Math.sin(angle) * radius * (.42 + .12 * t);
      positions.push(
        point.x + lateral.x * lateralOffset,
        point.y + verticalOffset,
        point.z + lateral.z * lateralOffset,
      );
      uvs.push(side / sides * 1.6, t * 3);

      if (segment < segments && side < sides) {
        const here = segment * (sides + 1) + side;
        const next = here + sides + 1;
        indices.push(here, next, here + 1, here + 1, next, next + 1);
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rootMossGeometry(root: RootModel, phase: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 8;
  const columns = 3;

  for (let row = 0; row <= rows; row += 1) {
    const t = .04 + row / rows * .7;
    const point = root.curve.getPoint(t);
    const tangent = root.curve.getTangent(t);
    const horizontalLength = Math.hypot(tangent.x, tangent.z) || 1;
    const lateral = new T.Vector3(-tangent.z / horizontalLength, 0, tangent.x / horizontalLength);
    const rootRadius = root.endRadius + (root.startRadius - root.endRadius) * Math.pow(1 - t, 1.5);
    const width = rootRadius * (.8 + .08 * Math.sin(row * 1.7 + phase));
    for (let column = 0; column <= columns; column += 1) {
      const across = column / columns - .5;
      const ragged = Math.sin(row * 2.3 + column * 4.7 + phase) * rootRadius * .035;
      positions.push(
        point.x + lateral.x * (across * width + ragged),
        point.y + rootRadius * .46 + .012,
        point.z + lateral.z * (across * width + ragged),
      );
      uvs.push(column / columns, row / rows * 2);
      if (row < rows && column < columns) {
        const here = row * (columns + 1) + column;
        const next = here + columns + 1;
        indices.push(here, here + 1, next, here + 1, next + 1, next);
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function trunkMossGeometry(
  profile: TrunkProfile,
  startT: number,
  endT: number,
  startAngle: number,
  phase: number,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 10;
  const columns = 3;

  for (let row = 0; row <= rows; row += 1) {
    const t = T.MathUtils.lerp(startT, endT, row / rows);
    const center = profile.centerAt(t);
    const radius = profile.radiusAt(t) * 1.055;
    const windingAngle = startAngle + t * 1.2 + .12 * Math.sin(row * .8 + phase);
    for (let column = 0; column <= columns; column += 1) {
      const across = column / columns - .5;
      const angle = windingAngle + across * (.7 + .08 * Math.sin(row + phase));
      const ragged = 1 + .025 * Math.sin(row * 4.2 + column * 8.1 + phase);
      positions.push(
        center.x + Math.cos(angle) * radius * ragged,
        center.y,
        center.z + Math.sin(angle) * radius * ragged,
      );
      uvs.push(column / columns, row / rows * 2.4);
      if (row < rows && column < columns) {
        const here = row * (columns + 1) + column;
        const next = here + columns + 1;
        indices.push(here, next, here + 1, here + 1, next, next + 1);
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ivyLeafGeometry(length: number, width: number) {
  const positions = [
    0, 0, 0,
    -width, length * .38, 0,
    0, length, 0,
    width, length * .38, 0,
    0, length * .42, width * .18,
  ];
  const uvs = [.5, 0, 0, .38, .5, 1, 1, .38, .5, .42];
  const indices = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 4, 1, 0, 4, 2, 1, 4, 3, 2, 4, 0, 3];
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addIvy(parent: T.Object3D, profile: TrunkProfile, material: T.Material, radius: number, phase: number) {
  const points: T.Vector3[] = [];
  for (let index = 0; index < 9; index += 1) {
    const t = .04 + index * .055;
    const center = profile.centerAt(t);
    const angle = phase + t * 9.5;
    const trunkRadius = profile.radiusAt(t) * 1.07;
    points.push(new T.Vector3(center.x + Math.cos(angle) * trunkRadius, center.y, center.z + Math.sin(angle) * trunkRadius));
  }
  const vine = new T.CatmullRomCurve3(points);
  addMesh(parent, taperedCurveGeometry(vine, radius * .025, radius * .012, 14, 5, phase), material);

  for (let index = 1; index < points.length; index += 2) {
    const t = .04 + index * .055;
    const angle = phase + t * 9.5;
    const leaf = addMesh(parent, ivyLeafGeometry(radius * .32, radius * .11), material);
    leaf.position.copy(points[index]);
    leaf.rotation.y = angle + Math.PI / 2;
    leaf.rotation.z = (index % 4 - 1.5) * .18;
  }
}

function addRoots(
  parent: T.Object3D,
  materials: Materials,
  profile: TrunkProfile,
  radius: number,
  seed: number,
) {
  const rand = random(seed ^ 0x91e10da5);
  const count = 8;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU + (rand() - .5) * .38;
    const direction = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new T.Vector3(-direction.z, 0, direction.x);
    const spread = radius * (2.35 + rand() * .82);
    const origin = profile.centerAt(.015).add(direction.clone().multiplyScalar(radius * .38));
    const points = [
      origin.add(new T.Vector3(0, radius * (.35 + rand() * .2), 0)),
      direction.clone().multiplyScalar(spread * .28).add(side.clone().multiplyScalar((rand() - .5) * radius * .42)).add(new T.Vector3(0, radius * .25, 0)),
      direction.clone().multiplyScalar(spread * .66).add(side.clone().multiplyScalar((rand() - .5) * radius * .8)).add(new T.Vector3(0, radius * .08, 0)),
      direction.clone().multiplyScalar(spread).add(side.clone().multiplyScalar((rand() - .5) * radius * .65)).add(new T.Vector3(0, .035, 0)),
    ];
    const root: RootModel = {
      curve: new T.CatmullRomCurve3(points),
      startRadius: radius * (.58 + rand() * .18),
      endRadius: radius * (.045 + rand() * .025),
    };
    addMesh(parent, rootGeometry(root, 10, 9, angle), materials.bark);
    if (index % 2 === 0) addMesh(parent, rootMossGeometry(root, angle), materials.moss);
  }
}

function addBoughs(
  parent: T.Object3D,
  materials: Materials,
  profile: TrunkProfile,
  height: number,
  radius: number,
  seed: number,
) {
  const rand = random(seed ^ 0x6c8e9cf5);
  const boughs = 7;
  for (let index = 0; index < boughs; index += 1) {
    const trunkT = .52 + index / (boughs - 1) * .32 + (rand() - .5) * .035;
    const angle = index * 2.399963 + rand() * .48;
    const direction = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const lateral = new T.Vector3(-direction.z, 0, direction.x);
    const trunkCenter = profile.centerAt(trunkT);
    const trunkRadius = profile.radiusAt(trunkT);
    const spread = Math.max(radius * (3.4 + rand() * 1.5), 2.8 + rand() * 1.8);
    const curl = (rand() - .5) * spread * .7;
    const rise = height * (.08 + rand() * .1);
    const start = trunkCenter.clone().add(direction.clone().multiplyScalar(trunkRadius * .62));
    const points = [
      start,
      start.clone().add(direction.clone().multiplyScalar(spread * .2)).add(lateral.clone().multiplyScalar(curl * .12)).add(new T.Vector3(0, index % 4 === 0 ? -radius * .16 : rise * .12, 0)),
      start.clone().add(direction.clone().multiplyScalar(spread * .58)).add(lateral.clone().multiplyScalar(curl * .55)).add(new T.Vector3(0, rise * .55, 0)),
      start.clone().add(direction.clone().multiplyScalar(spread)).add(lateral.clone().multiplyScalar(curl)).add(new T.Vector3(0, rise, 0)),
    ];
    const curve = new T.CatmullRomCurve3(points);
    const startRadius = trunkRadius * (.48 + rand() * .12);
    addMesh(parent, taperedCurveGeometry(curve, startRadius, radius * .025, 12, 8, angle), materials.bark);

    const forks = index % 3 === 0 ? 2 : 1;
    for (let forkIndex = 0; forkIndex < forks; forkIndex += 1) {
      const forkT = .48 + forkIndex * .17 + rand() * .08;
      const forkStart = curve.getPoint(forkT);
      const parentTangent = curve.getTangent(forkT);
      const parentAngle = Math.atan2(parentTangent.z, parentTangent.x);
      const forkAngle = parentAngle + (forkIndex === 0 ? 1 : -1) * (.48 + rand() * .55);
      const forkDirection = new T.Vector3(Math.cos(forkAngle), 0, Math.sin(forkAngle));
      const forkLength = spread * (.3 + rand() * .24);
      const forkPoints = [
        forkStart,
        forkStart.clone().add(forkDirection.clone().multiplyScalar(forkLength * .38)).add(new T.Vector3(0, rise * .18, 0)),
        forkStart.clone().add(forkDirection.clone().multiplyScalar(forkLength)).add(new T.Vector3(0, rise * (.32 + rand() * .24), 0)),
      ];
      addMesh(
        parent,
        taperedCurveGeometry(new T.CatmullRomCurve3(forkPoints), startRadius * .42, radius * .014, 7, 7, forkAngle),
        materials.bark,
      );
    }
  }

  // Two offset leaders split the crown so no tree ends in a telephone-pole point.
  const forkBaseT = .63;
  const forkBase = profile.centerAt(forkBaseT);
  for (const side of [-1, 1]) {
    const angle = profile.twistAt(.7) + side * (.55 + rand() * .28);
    const direction = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const end = profile.centerAt(1).add(direction.clone().multiplyScalar(radius * (1.1 + rand() * .65))).add(new T.Vector3(0, height * (.1 + rand() * .08), 0));
    const leader = new T.CatmullRomCurve3([
      forkBase.clone().add(direction.clone().multiplyScalar(profile.radiusAt(forkBaseT) * .25)),
      forkBase.clone().add(direction.clone().multiplyScalar(radius * .55)).add(new T.Vector3(0, height * .12, 0)),
      end,
    ]);
    addMesh(parent, taperedCurveGeometry(leader, radius * .42, radius * .035, 12, 9, angle), materials.bark);
  }
}

function addKnots(
  parent: T.Object3D,
  materials: Materials,
  profile: TrunkProfile,
  radius: number,
  seed: number,
) {
  const rand = random(seed ^ 0xd1b54a35);
  const dark = materials.dark ?? materials.bark;
  for (let index = 0; index < 3; index += 1) {
    const t = .18 + index * .18 + rand() * .06;
    const angle = rand() * TAU;
    const direction = new T.Vector3(Math.cos(angle), .12 + rand() * .25, Math.sin(angle)).normalize();
    const center = profile.centerAt(t);
    const trunkRadius = profile.radiusAt(t);
    const start = center.add(direction.clone().setY(0).normalize().multiplyScalar(trunkRadius * .72));
    const length = radius * (.48 + rand() * .4);
    const end = start.clone().add(direction.clone().multiplyScalar(length));
    const curve = new T.QuadraticBezierCurve3(start, start.clone().lerp(end, .5).add(new T.Vector3(0, radius * .12, 0)), end);
    const endRadius = radius * .055;
    addMesh(parent, taperedCurveGeometry(curve, radius * .16, endRadius, 5, 7, angle), materials.bark);
    const cap = addMesh(parent, new T.CircleGeometry(endRadius * .92, 8), dark);
    cap.position.copy(end).add(direction.clone().multiplyScalar(.006));
    cap.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
  }
}

/**
 * Builds one deterministic ancient tree without its canopy. Root tips remain
 * within roughly radius * 3.2 of the supplied position; crown boughs extend
 * farther and are intended to sit inside the caller's instanced leaves.
 */
export function buildTree(
  parent: T.Object3D,
  materials: Record<string, T.MeshStandardMaterial>,
  x: number,
  z: number,
  height: number,
  radius: number,
  seed: number,
): T.Group {
  const group = new T.Group();
  group.position.set(x, 0, z);
  group.userData.treeSeed = seed;
  parent.add(group);

  const resolved: Materials = {
    ...materials,
    bark: materials.bark ?? materials.wood,
    moss: materials.moss ?? materials.bark ?? materials.wood,
  };
  const profileRand = random(seed ^ 0x9e3779b9);
  const profile = makeTrunkProfile(height, radius, profileRand);
  addMesh(group, trunkGeometry(profile, 14, 22, profileRand), resolved.bark);
  addRoots(group, resolved, profile, radius, seed);
  addBoughs(group, resolved, profile, height, radius, seed);
  addKnots(group, resolved, profile, radius, seed);

  addMesh(group, trunkMossGeometry(profile, .015, .32, profile.twistAt(.1) + .45, seed), resolved.moss);
  addMesh(group, trunkMossGeometry(profile, .09, .48, profile.twistAt(.2) + Math.PI * 1.08, seed * .37), resolved.moss);
  addIvy(group, profile, resolved.moss, radius, profile.twistAt(.05) + 1.7);

  return group;
}
