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

export function landscapeHeight(x: number, z: number): number {
  if (x > BRIDGE.minX && x < BRIDGE.maxX && z >= BRIDGE.minZ && z <= BRIDGE.maxZ) {
    return 1.05 * Math.sin((x - BRIDGE.minX) / (BRIDGE.maxX - BRIDGE.minX) * Math.PI);
  }
  return isCreekPoint(x, z, .2) ? -.55 : -.04 + leftBankHeight(x, z);
}
