import * as T from 'three';

/** Broad worn flagstone: a cut face, chipped corners and a shallow beveled edge. */
export function flagstoneGeometry(): T.BufferGeometry {
  const outline = new T.Shape();
  outline.moveTo(-.91, -.62);
  outline.lineTo(-.72, -.95);
  outline.lineTo(.52, -.87);
  outline.lineTo(.94, -.56);
  outline.lineTo(.83, .73);
  outline.lineTo(.41, .91);
  outline.lineTo(-.78, .82);
  outline.lineTo(-.97, .37);
  outline.closePath();
  const geometry = new T.ExtrudeGeometry(outline, {
    depth: .55, steps: 1, bevelEnabled: true,
    bevelThickness: .17, bevelSize: .09, bevelSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
