import * as esbuild from 'esbuild';
import * as T from 'three';
import { resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const terrainSource = resolve(root, 'app/src/game3d/woodland-terrain.ts');
const BRIDGE = { minX: 8.75, maxX: 17.25, minZ: 0, maxZ: 4 };

const bundled = await esbuild.build({
  entryPoints: [terrainSource],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,

});

// Bundle Three as well so the probe does not need a server, Vite config, or a
// generated module on disk. The probe remains independent of application boot.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { buildWoodlandTerrain } = await import(moduleUrl);

const seeds = [1607, 1, 0xffffffff, 42, 83, 0x7fffffff, 0x12345678];
const inBridgeRectangle = (x, z) => x > BRIDGE.minX && x < BRIDGE.maxX && z > BRIDGE.minZ && z < BRIDGE.maxZ;
const faceNormalY = (positions, offset) => {
  const a = new T.Vector3().fromBufferAttribute(positions, offset);
  const b = new T.Vector3().fromBufferAttribute(positions, offset + 1);
  const c = new T.Vector3().fromBufferAttribute(positions, offset + 2);
  return b.sub(a).cross(c.sub(a)).normalize().y;
};

const reports = [];
for (const seed of seeds) {
  const base = new T.MeshStandardMaterial({ color: '#a9ad9b' });
  const group = new T.Group();
  const result = buildWoodlandTerrain(group, { stone: base, ground: base }, seed);
  let triangles = 0;
  let nonFinite = 0;
  let corridorVertices = 0;
  let courtDownwardFaces = 0;
  let taggedCapTriangles = 0;
  let taggedCapDownward = 0;
  let taggedSideTriangles = 0;
  let taggedSideUvFailures = 0;
  let duplicateCourtTriangles = 0;
  const courtTriangleKeys = new Set();
  const courtRoughness = new Set();
  const meshReports = {};

  for (const mesh of result.meshes) {
    const positions = mesh.geometry.getAttribute('position');
    const uvs = mesh.geometry.getAttribute('uv');
    const triangleCount = positions.count / 3;
    triangles += triangleCount;
    meshReports[mesh.name] = { triangles: triangleCount, vertices: positions.count };

    for (const attribute of Object.values(mesh.geometry.attributes)) {
      for (const value of attribute.array) if (!Number.isFinite(value)) nonFinite += 1;
    }
    for (let index = 0; index < positions.count; index += 1) {
      if (inBridgeRectangle(positions.getX(index), positions.getZ(index))) corridorVertices += 1;
    }

    if (mesh.name.includes('court-paving')) {
      courtRoughness.add(mesh.material.roughness);
      for (let index = 0; index < positions.count; index += 3) {
        if (faceNormalY(positions, index) < -.001) courtDownwardFaces += 1;
        const vertices = [];
        for (let vertex = index; vertex < index + 3; vertex += 1) {
          vertices.push([positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]
            .map((value) => value.toFixed(5)).join(','));
        }
        const key = vertices.sort().join('|');
        if (courtTriangleKeys.has(key)) duplicateCourtTriangles += 1;
        courtTriangleKeys.add(key);
      }
    }

    if (mesh.name.includes('creek-bank-')) {
      const surfaceKinds = mesh.geometry.getAttribute('surfaceKind');
      if (!surfaceKinds) throw new Error(`${mesh.name}: missing surfaceKind metadata`);
      for (let index = 0; index < positions.count; index += 3) {
        const kind = surfaceKinds.getX(index);
        if (kind === 2) {
          taggedCapTriangles += 1;
          if (faceNormalY(positions, index) <= 0) taggedCapDownward += 1;
        } else if (kind === 1) {
          taggedSideTriangles += 1;
          const ys = [positions.getY(index), positions.getY(index + 1), positions.getY(index + 2)];
          const heightSpan = Math.max(...ys) - Math.min(...ys);
          const vs = [uvs.getY(index), uvs.getY(index + 1), uvs.getY(index + 2)];
          const uvSpan = Math.max(...vs) - Math.min(...vs);
          // verticalUV defines V as .72 * actual height. Every tagged side
          // triangle must satisfy that relation; there is no failure quota.
          if (heightSpan <= 0 || Math.abs(uvSpan - heightSpan * .72) > 1e-4 + heightSpan * .005) {
            taggedSideUvFailures += 1;
          }
        }
      }
    }
  }

  const measured = {
    seed,
    counts: result.counts,
    triangles,
    meshReports,
    nonFinite,
    corridorVertices,
    courtDownwardFaces,
    duplicateCourtTriangles,
    courtRoughness: [...courtRoughness].sort((a, b) => a - b),
    taggedCapTriangles,
    taggedCapDownward,
    taggedSideTriangles,
    taggedSideUvFailures,
  };
  if (result.meshes.length > 6) throw new Error(`seed ${seed}: ${result.meshes.length} meshes`);
  if (triangles > 100000) throw new Error(`seed ${seed}: ${triangles} triangles`);
  if (nonFinite !== 0) throw new Error(`seed ${seed}: ${nonFinite} non-finite attribute values`);
  if (corridorVertices !== 0) throw new Error(`seed ${seed}: ${corridorVertices} bridge-corridor vertices`);
  if (courtDownwardFaces !== 0) throw new Error(`seed ${seed}: ${courtDownwardFaces} downward court faces`);
  if (duplicateCourtTriangles !== 0) throw new Error(`seed ${seed}: ${duplicateCourtTriangles} duplicate court triangles`);
  if (courtRoughness.size < 2) throw new Error(`seed ${seed}: no damp court roughness split`);
  if (taggedCapTriangles === 0 || taggedCapDownward !== 0) throw new Error(`seed ${seed}: exposed cap orientation ${taggedCapDownward}/${taggedCapTriangles}`);
  if (taggedSideTriangles === 0 || taggedSideUvFailures !== 0) throw new Error(`seed ${seed}: tagged side UV check ${taggedSideUvFailures}/${taggedSideTriangles}`);
  reports.push(measured);
  for (const mesh of result.meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  base.dispose();
}

console.log(JSON.stringify({ seeds, reports }, null, 2));
