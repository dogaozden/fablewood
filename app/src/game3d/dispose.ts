import * as T from 'three';

/** Dispose an owned subtree once, including resources shared within that subtree. */
export function disposeTree(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
  root.removeFromParent();
}
