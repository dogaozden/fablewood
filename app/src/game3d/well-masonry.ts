import * as T from 'three';

/** A curved, bevelled masonry segment. Adjacent stones follow the same ring;
 * narrow mortar joints replace the triangular holes between tangent boxes. */
function ringStone(inner: number, outer: number, start: number, end: number, height: number, seed: number) {
  const shape = new T.Shape();
  shape.moveTo(Math.cos(start) * outer, Math.sin(start) * outer);
  shape.absarc(0, 0, outer, start, end, false);
  shape.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
  shape.absarc(0, 0, inner, end, start, true);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelThickness: .018,
    bevelSize: .018, bevelSegments: 2, curveSegments: 3, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  const stone = new T.Color('#fff9e9');
  const moss = new T.Color('#657044');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    // Continuous displacement gives duplicated edge vertices the same position.
    const wear = Math.sin(x * 19 + seed) * Math.cos(z * 17 - seed * .7);
    const radial = 1 + wear * .005;
    positions.setXYZ(i, x * radial, y + wear * .008, z * radial);
    const growth = Math.max(0, Math.sin(x * 7 + z * 3 + seed * .6)) * (seed < 48 ? .48 : .10);
    const tint = stone.clone().lerp(moss, growth).multiplyScalar(.79 + .32 * Math.sin(seed * 2.7) ** 2);
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    if (Math.abs(normals.getY(i)) > .65) uv.setXY(i, x * .7, z * .7);
    else uv.setXY(i, Math.atan2(z, x) * 1.14 * .7, y * .7 + seed * .13);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function addWellMasonry(parent: T.Group, base: T.MeshStandardMaterial, randomValue: () => number) {
  const material = base.clone();
  material.name = 'weathered-well-stone';
  material.vertexColors = true;
  material.roughness = .67;
  material.bumpScale = .055;
  const rimMaterial = material.clone();
  rimMaterial.name = 'weathered-well-rim';
  const add = (geometry: T.BufferGeometry, y: number, cap: boolean) => {
    const mesh = new T.Mesh(geometry, cap ? rimMaterial : material);
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  };
  for (let row = 0; row < 5; row++) {
    const cap = row === 4;
    const count = cap ? 11 : 12;
    const angles = Array.from({ length: count + 1 }, (_, i) =>
      (i + (row % 2) * .5) / count * Math.PI * 2 + (i > 0 && i < count ? Math.sin(i * 7.13 + row) * .04 : 0));
    for (let i = 0; i < count; i++) {
      // Two samples per body stone preserve the existing landscape seed stream.
      const seed = row * 12 + i + (cap ? 0 : randomValue() * .3);
      const relief = cap ? 0 : (randomValue() - .5) * .008;
      add(ringStone(cap ? .83 : .915, cap ? 1.445 : 1.365,
        angles[i] + .026, angles[i + 1] - .026,
        cap ? .125 : .215 + relief, seed), cap ? .995 : .03 + row * .24, cap);
    }
  }
}
