import * as T from 'three';

const TAU = Math.PI * 2;
const UP = new T.Vector3(0, 1, 0);

export interface Character {
  group: T.Group;
  legs: T.Group[];
  arms: T.Group[];
  cape: T.Mesh;
  update: (time: number, moving: boolean) => void;
  strike?: () => void;
  hurt?: () => void;
}

interface CharacterMaterials {
  cloth: T.MeshStandardMaterial;
  clothDark: T.MeshStandardMaterial;
  clothLight: T.MeshStandardMaterial;
  leather: T.MeshStandardMaterial;
  leatherLight: T.MeshStandardMaterial;
  skin: T.MeshStandardMaterial;
  hair: T.MeshStandardMaterial;
  metal: T.MeshStandardMaterial;
  metalDark: T.MeshStandardMaterial;
  rune: T.MeshStandardMaterial;
  eye: T.MeshStandardMaterial;
}

function makeMaterials(color: string, guardian: boolean): CharacterMaterials {
  const base = new T.Color(color);
  const shade = base.clone().multiplyScalar(.52);
  const light = base.clone().lerp(new T.Color('#d9cfb3'), .28);
  const standard = (value: T.Color | string, roughness = .84, metalness = 0) =>
    new T.MeshStandardMaterial({ color: value, roughness, metalness });
  return {
    cloth: standard(base, .92),
    clothDark: standard(shade, .96),
    clothLight: standard(light, .88),
    leather: standard(guardian ? '#302f2b' : '#362a23', .89),
    leatherLight: standard(guardian ? '#62584a' : '#71533d', .84),
    skin: standard(guardian ? '#7d8b82' : '#bfa083', .9),
    hair: standard(guardian ? '#303631' : '#352a25', .98),
    metal: standard(guardian ? '#777c72' : '#a8a389', .47, .58),
    metalDark: standard(guardian ? '#343b39' : '#4d514d', .59, .42),
    rune: new T.MeshStandardMaterial({ color: guardian ? '#a8f0dc' : '#bceaff', emissive: guardian ? '#35caa3' : '#5ea9c2', emissiveIntensity: 1.8, roughness: .34 }),
    eye: new T.MeshStandardMaterial({ color: '#1d2523', roughness: .4 }),
  };
}

function addMesh<G extends T.BufferGeometry>(geometry: G, material: T.Material, parent: T.Object3D, x = 0, y = 0, z = 0) {
  const result = new T.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function limbBetween(parent: T.Object3D, material: T.Material, a: T.Vector3, b: T.Vector3, radiusA: number, radiusB: number, sides = 8) {
  const length = a.distanceTo(b);
  const result = addMesh(new T.CylinderGeometry(radiusB, radiusA, length, sides, 1), material, parent);
  result.position.copy(a).add(b).multiplyScalar(.5);
  result.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return result;
}

function foldedClothGeometry(topWidth: number, bottomWidth: number, height: number, depth: number, scallops = 3) {
  const columns = 12;
  const rows = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const width = T.MathUtils.lerp(topWidth, bottomWidth, Math.pow(v, .82));
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const hem = row === rows ? .035 * (1 - Math.cos(u * scallops * TAU)) : 0;
      const fold = Math.sin(u * TAU * 3) * depth * (.32 + v * .68);
      positions.push((u - .5) * width, -v * height + hem, fold);
      if (row < rows && column < columns) {
        const i = row * (columns + 1) + column;
        indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function coatPanelGeometry(side: number) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([
    side * .03, .02, .26, side * .24, .02, .18, side * .31, -.68, .11,
    side * .035, -.76, .15, side * .03, .02, .26, side * .31, -.68, .11,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function traveler(color: string): Character {
  const group = new T.Group();
  const body = new T.Group();
  group.add(body);
  const materials = makeMaterials(color, false);
  const base = new T.Color(color);
  const isMira = base.g > base.r * 1.08 && base.g > base.b * 1.04;
  const legs: T.Group[] = [];
  const arms: T.Group[] = [];
  const knees: T.Group[] = [];
  const elbows: T.Group[] = [];

  // Feet touch y=0. Each leg is articulated at both the hip and knee.
  for (const side of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(side * .155, .96, 0);
    body.add(leg);
    limbBetween(leg, materials.clothDark, new T.Vector3(0, 0, 0), new T.Vector3(side * .018, -.37, .005), .115, .1, 9);
    const knee = new T.Group();
    knee.position.set(side * .018, -.37, .005);
    leg.add(knee);
    addMesh(new T.SphereGeometry(.105, 9, 6), materials.leather, knee);
    limbBetween(knee, materials.leather, new T.Vector3(0, -.02, 0), new T.Vector3(-side * .008, -.39, -.015), .1, .082, 9);
    const boot = addMesh(new T.CapsuleGeometry(.105, .18, 4, 8), materials.leather, knee, -side * .008, -.485, .105);
    boot.rotation.x = Math.PI / 2;
    boot.scale.set(1.02, 1.18, 1);
    const cuff = addMesh(new T.CylinderGeometry(.108, .095, .12, 9), materials.leatherLight, knee, 0, -.42, 0);
    cuff.rotation.z = side * .025;
    addMesh(new T.TorusGeometry(.102, .018, 5, 10), materials.metalDark, knee, 0, -.48, 0).rotation.x = Math.PI / 2;
    legs.push(leg);
    knees.push(knee);
  }

  // A tailored, faceted torso keeps a readable waist and shoulder line.
  const torso = addMesh(new T.CylinderGeometry(.37, .255, .72, 10, 2), materials.cloth, body, 0, 1.28, 0);
  torso.scale.z = .68;
  addMesh(new T.CylinderGeometry(.265, .285, .16, 10), materials.clothDark, body, 0, .91, 0).scale.z = .72;
  addMesh(new T.TorusGeometry(.265, .034, 5, 16), materials.leather, body, 0, .965, 0).rotation.x = Math.PI / 2;
  const buckle = addMesh(new T.TorusGeometry(.052, .012, 4, 8), materials.metal, body, 0, .96, .206);
  buckle.rotation.x = Math.PI / 2;

  // Split coat tails remain visible between the moving legs.
  for (const side of [-1, 1]) {
    const panel = addMesh(coatPanelGeometry(side), side === -1 ? materials.cloth : materials.clothLight, body, 0, .98, 0);
    panel.material.side = T.DoubleSide;
  }

  // Shoulder pivots own upper arm, elbow, forearm, glove, and held equipment.
  for (const side of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(side * .38, 1.52, 0);
    arm.rotation.z = -side * .13;
    body.add(arm);
    const pauldron = addMesh(new T.SphereGeometry(.16, 10, 7, 0, TAU, 0, Math.PI * .57), isMira ? materials.leatherLight : materials.clothLight, arm, side * .015, -.035, 0);
    pauldron.scale.set(1.05, .8, .82);
    limbBetween(arm, materials.cloth, new T.Vector3(0, -.06, 0), new T.Vector3(side * .025, -.32, .025), .1, .085, 9);
    const elbow = new T.Group();
    elbow.position.set(side * .025, -.32, .025);
    arm.add(elbow);
    addMesh(new T.SphereGeometry(.085, 8, 6), materials.leather, elbow);
    limbBetween(elbow, materials.clothDark, new T.Vector3(0, -.015, 0), new T.Vector3(-side * .015, -.285, .065), .083, .068, 8);
    const glove = addMesh(new T.SphereGeometry(.082, 8, 6), materials.leather, elbow, -side * .015, -.315, .07);
    glove.scale.set(.86, 1.08, .9);
    arms.push(arm);
    elbows.push(elbow);
  }

  // Neck, face, hair/hood, and a small nose read from the elevated game camera.
  addMesh(new T.CylinderGeometry(.105, .115, .12, 9), materials.skin, body, 0, 1.67, 0);
  const head = addMesh(new T.SphereGeometry(.205, 14, 10), materials.skin, body, 0, 1.86, .025);
  head.scale.set(.82, 1.08, .86);
  if (isMira) {
    const hairCap = addMesh(new T.SphereGeometry(.218, 14, 9, 0, TAU, 0, Math.PI * .63), materials.hair, body, 0, 1.91, 0);
    hairCap.scale.set(.9, 1.06, .9);
    const braid = new T.Group();
    braid.position.set(-.17, 1.9, -.04);
    body.add(braid);
    for (let i = 0; i < 4; i++) addMesh(new T.SphereGeometry(.052 - i * .006, 7, 5), materials.hair, braid, 0, -i * .08, -.01 * i);
  } else {
    const hood = addMesh(new T.SphereGeometry(.25, 12, 9, 0, TAU, 0, Math.PI * .72), materials.clothDark, body, 0, 1.91, -.018);
    hood.scale.set(.94, 1.12, 1.02);
    const hoodRim = addMesh(new T.TorusGeometry(.185, .028, 6, 18, Math.PI * 1.42), materials.clothLight, body, 0, 1.87, .164);
    hoodRim.rotation.z = Math.PI * .79;
  }
  addMesh(new T.ConeGeometry(.032, .07, 5), materials.skin, body, 0, 1.87, .213).rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) addMesh(new T.SphereGeometry(.019, 6, 4), materials.eye, body, side * .063, 1.91, .194);

  // Collar, satchel, scroll case, and potion give the party a lived-in traveling silhouette.
  const collar = addMesh(new T.TorusGeometry(.225, .052, 6, 16, Math.PI * 1.42), materials.clothLight, body, 0, 1.62, .015);
  collar.rotation.z = Math.PI * .79;
  const strap = limbBetween(body, materials.leather, new T.Vector3(-.28, 1.56, .16), new T.Vector3(.2, .92, .19), .025, .025, 6);
  strap.scale.z = .55;
  const satchel = addMesh(new T.CapsuleGeometry(.13, .18, 3, 8), materials.leatherLight, body, isMira ? .29 : -.29, 1.02, .11);
  satchel.rotation.z = Math.PI / 2;
  satchel.scale.set(.9, 1, .5);
  addMesh(new T.TorusGeometry(.075, .012, 4, 10), materials.metal, body, isMira ? .29 : -.29, 1.03, .205).rotation.x = Math.PI / 2;
  const scroll = addMesh(new T.CylinderGeometry(.045, .045, .34, 8), materials.leatherLight, body, isMira ? -.3 : .31, 1.08, -.03);
  scroll.rotation.z = isMira ? -.17 : .17;

  // Cape geometry is a single low-cost cloth sheet with real folds and a scalloped hem.
  const cape = addMesh(foldedClothGeometry(isMira ? .46 : .62, isMira ? .55 : .86, isMira ? .68 : .93, .055, isMira ? 2 : 3), materials.clothDark, body, 0, 1.61, -.205);
  cape.material.side = T.DoubleSide;
  cape.rotation.x = -.06;

  // Staff is held by the right glove; its crystal or leaf-shaped cap catches available light.
  const staffSide = 1;
  const staff = new T.Group();
  staff.position.set(staffSide * .43, .02, .11);
  body.add(staff);
  limbBetween(staff, materials.leatherLight, new T.Vector3(0, 0, 0), new T.Vector3(.025, 1.58, 0), .026, .038, 8);
  const crook = new T.TorusGeometry(.15, .025, 6, 14, Math.PI * 1.25);
  const crookMesh = addMesh(crook, materials.leatherLight, staff, isMira ? -.08 : .1, 1.58, 0);
  crookMesh.rotation.z = isMira ? -.15 : Math.PI * .9;
  if (isMira) {
    const leaf = addMesh(new T.OctahedronGeometry(.095, 1), materials.rune, staff, -.12, 1.65, 0);
    leaf.scale.set(.55, 1.25, .32);
  } else {
    addMesh(new T.OctahedronGeometry(.105, 1), materials.rune, staff, .11, 1.73, 0).scale.set(.72, 1.05, .58);
  }

  body.updateWorldMatrix(true, true);
  elbows[1].attach(staff);

  let lastTime = 0;
  let strikeStarted = -10;
  let hurtStarted = -10;
  return {
    group,
    legs,
    arms,
    cape,
    strike() { strikeStarted = lastTime; },
    hurt() { hurtStarted = lastTime; },
    update(time, moving) {
      lastTime = time;
      const pace = time * 8.5;
      legs.forEach((leg, index) => {
        const phase = pace + index * Math.PI;
        const stride = moving ? Math.sin(phase) * .48 : Math.sin(time * 1.7 + index) * .012;
        leg.rotation.x = stride;
        knees[index].rotation.x = moving ? Math.max(0, -Math.sin(phase)) * .42 : 0;
      });
      arms.forEach((arm, index) => {
        const stride = moving ? -Math.sin(pace + index * Math.PI) * .29 : Math.sin(time * 1.8 + index) * .025;
        arm.rotation.x = stride;
        arm.rotation.z = (index === 0 ? 1 : -1) * .13;
        elbows[index].rotation.x = -.12 + (moving ? Math.max(0, Math.sin(pace + index * Math.PI)) * .17 : 0);
      });
      const strikeAge = time - strikeStarted;
      if (strikeAge >= 0 && strikeAge < .42) {
        const phase = strikeAge / .42;
        arms[1].rotation.x -= Math.sin(phase * Math.PI) * 1.45;
        arms[1].rotation.z -= Math.sin(phase * Math.PI) * .28;
      }
      const hurtAge = time - hurtStarted;
      body.rotation.z = hurtAge >= 0 && hurtAge < .28 ? Math.sin(hurtAge / .28 * Math.PI) * .16 : 0;
      body.position.y = moving ? Math.abs(Math.sin(pace)) * .025 : Math.sin(time * 1.65) * .008;
      torso.scale.y = 1 + Math.sin(time * 1.65) * .008;
      cape.rotation.x = -.06 + Math.sin(time * 2.1) * .018 + (moving ? .08 + Math.sin(pace) * .035 : 0);
      cape.rotation.z = Math.sin(time * 1.25) * .012;
    },
  };
}

function guardian(color: string): Character {
  const group = new T.Group();
  const body = new T.Group();
  group.add(body);
  const materials = makeMaterials(color, true);
  const legs: T.Group[] = [];
  const arms: T.Group[] = [];
  const knees: T.Group[] = [];
  const elbows: T.Group[] = [];

  // Deliberately non-human proportions: long armored shins, a narrow waist, and immense shoulders.
  for (const side of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(side * .29, 1.43, 0);
    body.add(leg);
    limbBetween(leg, materials.metalDark, new T.Vector3(0, 0, 0), new T.Vector3(-side * .025, -.56, 0), .185, .145, 10);
    const thighPlate = addMesh(new T.ConeGeometry(.235, .58, 7), materials.metal, leg, 0, -.28, .045);
    thighPlate.scale.set(1, 1, .64);
    thighPlate.rotation.z = side * .025;
    const knee = new T.Group();
    knee.position.set(-side * .025, -.56, 0);
    leg.add(knee);
    const kneeGuard = addMesh(new T.DodecahedronGeometry(.18, 0), materials.metal, knee, 0, -.02, .105);
    kneeGuard.scale.set(1.1, .8, .72);
    limbBetween(knee, materials.metalDark, new T.Vector3(0, -.04, 0), new T.Vector3(side * .02, -.58, -.02), .14, .11, 9);
    const greave = addMesh(new T.ConeGeometry(.18, .58, 7), materials.metal, knee, 0, -.33, .075);
    greave.scale.set(.88, 1, .58);
    const sabaton = addMesh(new T.CapsuleGeometry(.16, .28, 4, 8), materials.metalDark, knee, side * .02, -.71, .17);
    sabaton.rotation.x = Math.PI / 2;
    sabaton.scale.set(1.02, 1.23, 1);
    addMesh(new T.TorusGeometry(.145, .025, 5, 10), materials.leatherLight, knee, 0, -.64, 0).rotation.x = Math.PI / 2;
    legs.push(leg);
    knees.push(knee);
  }

  const skirt = addMesh(new T.CylinderGeometry(.49, .35, .78, 9, 2, true), materials.clothDark, body, 0, 1.52, 0);
  skirt.scale.z = .7;
  const ribcage = addMesh(new T.CylinderGeometry(.58, .38, 1.12, 10, 3), materials.metalDark, body, 0, 2.12, 0);
  ribcage.scale.z = .68;
  for (let i = 0; i < 4; i++) {
    const rib = addMesh(new T.TorusGeometry(.39 + i * .045, .035, 5, 14, Math.PI), materials.metal, body, 0, 1.83 + i * .21, .255);
    rib.rotation.z = Math.PI / 2;
    rib.scale.x = 1.05;
  }
  const belt = addMesh(new T.TorusGeometry(.39, .06, 6, 16), materials.leatherLight, body, 0, 1.55, 0);
  belt.rotation.x = Math.PI / 2;
  addMesh(new T.OctahedronGeometry(.105, 0), materials.rune, body, 0, 1.55, .315);

  for (const side of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(side * .62, 2.49, -.005);
    arm.rotation.z = -side * .1;
    body.add(arm);
    const pauldron = addMesh(new T.ConeGeometry(.39, .48, 7), materials.metal, arm, side * .02, -.07, 0);
    pauldron.rotation.z = side * Math.PI / 2;
    pauldron.scale.z = .7;
    const shoulderSpike = addMesh(new T.ConeGeometry(.09, .38, 6), materials.metalDark, arm, side * .3, .03, -.03);
    shoulderSpike.rotation.z = -side * Math.PI / 2;
    limbBetween(arm, materials.clothDark, new T.Vector3(0, -.1, 0), new T.Vector3(side * .02, -.48, .045), .16, .13, 9);
    const elbow = new T.Group();
    elbow.position.set(side * .02, -.48, .045);
    arm.add(elbow);
    const elbowGuard = addMesh(new T.OctahedronGeometry(.145, 0), materials.metal, elbow, 0, 0, .08);
    elbowGuard.scale.set(1.05, .82, .75);
    limbBetween(elbow, materials.metalDark, new T.Vector3(0, -.035, 0), new T.Vector3(-side * .02, -.43, .075), .13, .1, 9);
    addMesh(new T.SphereGeometry(.125, 9, 7), materials.skin, elbow, -side * .02, -.47, .08).scale.set(.9, 1.15, .9);
    arms.push(arm);
    elbows.push(elbow);
  }

  // Weathered mantle layers around the mask instead of a normal neck and face.
  addMesh(new T.CylinderGeometry(.29, .36, .3, 9), materials.cloth, body, 0, 2.73, -.015).scale.z = .76;
  const hood = addMesh(new T.SphereGeometry(.41, 14, 10, 0, TAU, 0, Math.PI * .72), materials.clothDark, body, 0, 2.91, -.035);
  hood.scale.set(.88, 1.1, .88);
  const mask = addMesh(new T.DodecahedronGeometry(.285, 1), materials.metal, body, 0, 2.91, .255);
  mask.scale.set(.72, 1.13, .34);
  for (const side of [-1, 1]) {
    const socket = addMesh(new T.CapsuleGeometry(.027, .092, 2, 5), materials.eye, body, side * .085, 2.955, .357);
    socket.rotation.z = side * .15;
    const eye = addMesh(new T.CapsuleGeometry(.018, .085, 2, 5), materials.rune, body, side * .085, 2.955, .37);
    eye.rotation.z = side * .15;
  }
  for (let i = 0; i < 3; i++) limbBetween(body, materials.metalDark, new T.Vector3(-.13 + i * .13, 2.81, .36), new T.Vector3(-.11 + i * .11, 2.69, .38), .012, .012, 5);

  // Asymmetric branching antlers make the keeper recognizable before its armor resolves.
  for (const side of [-1, 1]) {
    const antler = new T.Group();
    antler.position.set(side * .19, 3.04, -.02);
    body.add(antler);
    const antlerMaterial = side === 1 ? materials.leatherLight : materials.hair;
    limbBetween(antler, antlerMaterial, new T.Vector3(0, 0, 0), new T.Vector3(side * .22, .3, -.03), .055, .07, 7);
    limbBetween(antler, antlerMaterial, new T.Vector3(side * .22, .3, -.03), new T.Vector3(side * .43, .48, .015), .045, .065, 7);
    limbBetween(antler, antlerMaterial, new T.Vector3(side * .18, .25, -.02), new T.Vector3(side * .11, .48, .03), .025, .04, 6);
    limbBetween(antler, antlerMaterial, new T.Vector3(side * .34, .4, 0), new T.Vector3(side * .38, .61, .04), .02, .037, 6);
  }

  const cape = addMesh(foldedClothGeometry(.91, 1.2, 1.66, .09, 4), materials.cloth, body, 0, 2.69, -.33);
  cape.material.side = T.DoubleSide;
  cape.rotation.x = -.045;
  // Additional torn side panels provide depth without multiplying the full cape mesh.
  for (const side of [-1, 1]) {
    const rag = addMesh(foldedClothGeometry(.22, .31, 1.12 - side * .08, .035, 2), side === 1 ? materials.clothLight : materials.clothDark, body, side * .42, 2.43, -.18);
    rag.material.side = T.DoubleSide;
    rag.rotation.z = side * .08;
  }

  // Ancient polearm in one hand, rune lantern in the other.
  const pole = new T.Group();
  pole.position.set(.72, .02, .08);
  body.add(pole);
  limbBetween(pole, materials.leatherLight, new T.Vector3(0, 0, 0), new T.Vector3(0, 2.85, 0), .045, .055, 9);
  const blade = addMesh(new T.ConeGeometry(.14, .46, 4), materials.metal, pole, 0, 3.03, 0);
  blade.rotation.z = .15;
  addMesh(new T.TorusGeometry(.12, .025, 5, 12), materials.rune, pole, 0, 2.77, 0).rotation.x = Math.PI / 2;

  const lantern = new T.Group();
  lantern.position.set(-.72, 1.18, .16);
  body.add(lantern);
  const frame = addMesh(new T.CylinderGeometry(.22, .26, .52, 6), materials.metalDark, lantern, 0, .25, 0);
  frame.scale.z = .86;
  addMesh(new T.CylinderGeometry(.15, .18, .4, 6), materials.rune, lantern, 0, .25, 0).scale.z = .72;
  for (const y of [0, .5]) addMesh(new T.TorusGeometry(.225, .025, 5, 12), materials.metal, lantern, 0, y, 0).rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) limbBetween(lantern, materials.metal, new T.Vector3(side * .18, 0, 0), new T.Vector3(side * .16, .51, 0), .014, .014, 5);
  const handle = addMesh(new T.TorusGeometry(.18, .025, 5, 12, Math.PI), materials.metal, lantern, 0, .55, 0);
  handle.rotation.z = Math.PI;

  body.updateWorldMatrix(true, true);
  elbows[1].attach(pole);
  elbows[0].attach(lantern);

  let lastTime = 0;
  let strikeStarted = -10;
  let hurtStarted = -10;
  return {
    group,
    legs,
    arms,
    cape,
    strike() { strikeStarted = lastTime; },
    hurt() { hurtStarted = lastTime; },
    update(time, moving) {
      lastTime = time;
      const pace = time * 6.5;
      legs.forEach((leg, index) => {
        const phase = pace + index * Math.PI;
        leg.rotation.x = moving ? Math.sin(phase) * .34 : Math.sin(time * 1.1 + index) * .008;
        knees[index].rotation.x = moving ? Math.max(0, -Math.sin(phase)) * .3 : 0;
      });
      arms.forEach((arm, index) => {
        arm.rotation.x = moving ? -Math.sin(pace + index * Math.PI) * .17 : Math.sin(time * 1.25 + index) * .015;
        elbows[index].rotation.x = -.1;
      });
      const strikeAge = time - strikeStarted;
      if (strikeAge >= 0 && strikeAge < .5) {
        const phase = Math.sin(strikeAge / .5 * Math.PI);
        arms[1].rotation.x -= phase * 1.15;
        arms[1].rotation.z -= phase * .22;
      }
      const hurtAge = time - hurtStarted;
      body.rotation.z = hurtAge >= 0 && hurtAge < .34 ? Math.sin(hurtAge / .34 * Math.PI) * .11 : 0;
      body.position.y = moving ? Math.abs(Math.sin(pace)) * .032 : Math.sin(time * 1.1) * .01;
      ribcage.scale.y = 1 + Math.sin(time * 1.1) * .005;
      cape.rotation.x = -.045 + Math.sin(time * 1.55) * .014 + (moving ? .055 : 0);
      lantern.rotation.z = Math.sin(time * 1.6) * .035 + (moving ? Math.sin(pace) * .08 : 0);
    },
  };
}

export function character(color = '#344f60', isGuardian = false): Character {
  return isGuardian ? guardian(color) : traveler(color);
}
