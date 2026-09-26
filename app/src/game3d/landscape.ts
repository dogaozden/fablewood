/** Shared physical dimensions for water, the bridge, and walking heights. */
export const BRIDGE = {
  centerX: 13,
  centerZ: 2,
  scaleX: 1.7,
  minX: 8.75,
  maxX: 17.25,
  minZ: 0,
  maxZ: 4,
} as const;

export const CREEK_HALF_WIDTH = 3.5;

export function creekCenter(z: number): number {
  const upstream = Math.max(0, -z);
  const downstream = Math.max(0, z - BRIDGE.maxZ);
  return BRIDGE.centerX + .035 * upstream * upstream / (1 + .07 * upstream)
    + .008 * downstream * downstream;
}

export function creekHalfWidth(z: number): number {
  return CREEK_HALF_WIDTH - 1.9 * Math.min(1, Math.max(0, -z) / 8);
}

export function leftBankHeight(x: number, z: number): number {
  return .95 * Math.min(1, Math.max(0, (-x - 2.6) / 4))
    * Math.min(1, Math.max(0, (z - 4) / 8));
}

export function isCreekPoint(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - creekCenter(z)) < creekHalfWidth(z) + margin;
}

const smooth = (start: number, end: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

function soilMound(x: number, z: number, cx: number, cz: number, rx: number, rz: number, height: number) {
  const radius = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
  return height * Math.max(0, 1 - radius) ** 2;
}

/** Continuous soil shoulders embed the creek stones and old roots. The same
 * surface drives walking, plant placement and the visible ground mesh. The
 * court, cottage threshold and bridge approaches retain their existing level. */
export function woodlandSoilRelief(x: number, z: number): number {
  const distance = Math.abs(x - creekCenter(z)) - creekHalfWidth(z);
  const bankProfile = smooth(.18, .72, distance) * (1 - smooth(.85, 2.5, distance));
  const bridgeClearance = smooth(2.2, 3.1, Math.abs(z - BRIDGE.centerZ));
  const bankCrest = .26 + .28 * (.5 + .5 * Math.sin(z * .59 + Math.sin(z * .21) * 1.4));
  const bank = bankProfile * bridgeClearance * bankCrest;
  const bed = soilMound(x, z, -8.6, 10.5, 2.4, 3.8, .24)
    + soilMound(x, z, -6.8, 15.4, 1.7, 2.4, .19)
    + soilMound(x, z, -10.1, 14.1, 2.5, 1.9, .13);
  const roots = soilMound(x, z, -2, -11, 4.3, 4.4, .24)
    + soilMound(x, z, 13, -13, 3.4, 3.7, .25)
    + soilMound(x, z, 19, -15, 3.1, 3.8, .17);
  // Small depressions and lobes break up each broad landform without a row of
  // separate mound meshes or a repeated sinusoidal river-edge silhouette.
  const weather = .82 + .18 * Math.sin(x * 2.1 + Math.sin(z * 1.7)) * Math.cos(z * 2.3);
  return (bank + bed + roots) * weather;
}

export function landscapeHeight(x: number, z: number): number {
  if (x > BRIDGE.minX && x < BRIDGE.maxX && z >= BRIDGE.minZ && z <= BRIDGE.maxZ) {
    return 1.05 * Math.sin((x - BRIDGE.minX) / (BRIDGE.maxX - BRIDGE.minX) * Math.PI);
  }
  return isCreekPoint(x, z, .2) ? -.55 : -.04 + leftBankHeight(x, z) + woodlandSoilRelief(x, z);
}
