import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Combine opaque details attached to the same joint, preserving every pivot. */
export function batchRigidParts(root: T.Object3D, animatedMeshes: ReadonlySet<T.Mesh>): void {
  const parents: T.Object3D[] = [];
  root.traverse(object => parents.push(object));
  for (const parent of parents) {
    const bins = new Map<string, T.Mesh<T.BufferGeometry, T.Material>[]>();
    for (const child of parent.children) {
      if (!(child instanceof T.Mesh) || child instanceof T.SkinnedMesh || child instanceof T.InstancedMesh ||
        animatedMeshes.has(child) || !child.visible || child.children.length ||
        Array.isArray(child.material) || child.material.transparent) continue;
      const key = `${child.material.id}/${child.castShadow}/${child.receiveShadow}/${child.renderOrder}`;
      const bin = bins.get(key) ?? [];
      bin.push(child);
      bins.set(key, bin);
    }
    for (const meshes of bins.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(mesh => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        if (!geometry.getAttribute('uv')) {
          geometry.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
        }
        return geometry;
      });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      const first = meshes[0];
      const batch = new T.Mesh(merged, first.material);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder;
      batch.name = 'rigid-details';
      parent.add(batch);
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    }
  }
}
