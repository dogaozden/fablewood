import { BRIDGE, isCreekPoint } from './landscape'

export type Point = { x: number; z: number }

export type LandmarkId =
  | 'hearth'
  | 'mira'
  | 'well'
  | 'stone-1'
  | 'stone-2'
  | 'stone-3'
  | 'guardian'
  | 'chest'

export type Landmark = {
  id: LandmarkId
  label: string
  subtitle: string
  position: Point
  radius: number
}

export const LANDMARKS: readonly Landmark[] = [
  { id: 'hearth', label: 'The Hearth', subtitle: 'Rest and return', position: { x: -10, z: 1 }, radius: 2.5 },
  { id: 'mira', label: 'Mira', subtitle: 'A companion waits', position: { x: 3, z: 6 }, radius: 2.5 },
  { id: 'well', label: 'Old Well', subtitle: 'The hamlet remembers', position: { x: 4.5, z: 10 }, radius: 2.5 },
  { id: 'stone-1', label: 'First Waystone', subtitle: 'The near road', position: { x: 6, z: 4 }, radius: 2.5 },
  { id: 'stone-2', label: 'Second Waystone', subtitle: 'Beyond the bridge', position: { x: 17, z: 3 }, radius: 2.5 },
  { id: 'stone-3', label: 'Third Waystone', subtitle: 'At the lost road', position: { x: 24, z: -6 }, radius: 2.5 },
  { id: 'guardian', label: 'Ruined Gate', subtitle: 'The road guardian', position: { x: 27, z: -12 }, radius: 2.5 },
  { id: 'chest', label: 'Wayfarer Chest', subtitle: 'A woodland cache', position: { x: 20, z: 8 }, radius: 2.5 },
] as const

export const WORLD_BOUNDS = { minX: -23, maxX: 34, minZ: -22, maxZ: 21 } as const

export type CircleObstacle = { kind: 'circle'; center: Point; radius: number; feature?: 'well' }
export type RectObstacle = { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
export type StaticObstacle = CircleObstacle | RectObstacle

export const STATIC_OBSTACLES: readonly StaticObstacle[] = [
  { kind: 'rect', minX: -18.8, maxX: -7, minZ: -7.5, maxZ: -0.08 },
  { kind: 'circle', center: { x: 4.5, z: 10 }, radius: 1.5, feature: 'well' },
  { kind: 'circle', center: { x: -2, z: -11 }, radius: 2.2 },
  { kind: 'circle', center: { x: 13, z: -13 }, radius: 2.2 },
  { kind: 'circle', center: { x: 17, z: -10 }, radius: 1.6 },
  { kind: 'rect', minX: -4.45, maxX: -2.95, minZ: 9.7, maxZ: 18.1 },
  { kind: 'circle', center: { x: -19, z: -15 }, radius: 1.25 },
  { kind: 'circle', center: { x: -20, z: -5 }, radius: 1.1 },
  { kind: 'circle', center: { x: -18, z: 8 }, radius: 1.2 },
  { kind: 'circle', center: { x: -11, z: 12 }, radius: 1.25 },
  { kind: 'circle', center: { x: -5, z: 17 }, radius: 1.2 },
  { kind: 'circle', center: { x: 4, z: 16 }, radius: 1.25 },
  { kind: 'circle', center: { x: 8, z: -19 }, radius: 1.2 },
  { kind: 'circle', center: { x: 17, z: -17 }, radius: 1.25 },
  { kind: 'circle', center: { x: 24, z: -18 }, radius: 1.1 },
  { kind: 'circle', center: { x: 31, z: -5 }, radius: 1.3 },
  { kind: 'circle', center: { x: 30, z: 10 }, radius: 1.25 },
  { kind: 'circle', center: { x: 24, z: 17 }, radius: 1.2 },
  { kind: 'circle', center: { x: 15, z: 14 }, radius: 1.1 },
] as const

const GRID_STEP = 1

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z)

export const landmarkById = (id: LandmarkId): Landmark => {
  const landmark = LANDMARKS.find((candidate) => candidate.id === id)
  if (!landmark) throw new Error(`Unknown landmark: ${id}`)
  return landmark
}

export const isNearLandmark = (point: Point, id: LandmarkId): boolean => {
  const landmark = landmarkById(id)
  return distance(point, landmark.position) <= landmark.radius
}

const isFinitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.z)

const insideObstacle = (point: Point, obstacle: StaticObstacle): boolean => {
  if (obstacle.kind === 'circle') return distance(point, obstacle.center) < obstacle.radius
  return point.x > obstacle.minX && point.x < obstacle.maxX && point.z > obstacle.minZ && point.z < obstacle.maxZ
}

export const isWalkable = (point: Point, bridgeOpen: boolean): boolean => {
  if (!isFinitePoint(point)) return false
  if (
    point.x < WORLD_BOUNDS.minX ||
    point.x > WORLD_BOUNDS.maxX ||
    point.z < WORLD_BOUNDS.minZ ||
    point.z > WORLD_BOUNDS.maxZ
  ) return false

  const inCreek = isCreekPoint(point.x, point.z)
  const onBridge = point.z >= BRIDGE.minZ && point.z <= BRIDGE.maxZ
  if (inCreek && (!bridgeOpen || !onBridge)) return false
  return !STATIC_OBSTACLES.some((obstacle) => insideObstacle(point, obstacle))
}

type GridPoint = Point & { key: string }

const snap = (value: number): number => Math.round(value / GRID_STEP) * GRID_STEP
const keyOf = (point: Point): string => `${point.x},${point.z}`
const gridPoint = (x: number, z: number): GridPoint => ({ x, z, key: `${x},${z}` })

const gridNeighbors = (point: GridPoint, bridgeOpen: boolean): { point: GridPoint; cost: number }[] => {
  const result: { point: GridPoint; cost: number }[] = []
  for (let dx = -GRID_STEP; dx <= GRID_STEP; dx += GRID_STEP) {
    for (let dz = -GRID_STEP; dz <= GRID_STEP; dz += GRID_STEP) {
      if (dx === 0 && dz === 0) continue
      const next = gridPoint(point.x + dx, point.z + dz)
      if (!isWalkable(next, bridgeOpen)) continue
      if (dx !== 0 && dz !== 0) {
        if (!isWalkable({ x: point.x + dx, z: point.z }, bridgeOpen)) continue
        if (!isWalkable({ x: point.x, z: point.z + dz }, bridgeOpen)) continue
      }
      result.push({ point: next, cost: dx === 0 || dz === 0 ? GRID_STEP : Math.SQRT2 * GRID_STEP })
    }
  }
  return result
}

const reconstruct = (cameFrom: Map<string, string>, points: Map<string, GridPoint>, endKey: string): Point[] => {
  const path: Point[] = []
  let cursor: string | undefined = endKey
  while (cursor) {
    const point = points.get(cursor)
    if (!point) break
    path.push({ x: point.x, z: point.z })
    cursor = cameFrom.get(cursor)
  }
  return path.reverse()
}

const segmentWalkable = (from: Point, to: Point, bridgeOpen: boolean): boolean => {
  const length = distance(from, to)
  const samples = Math.max(1, Math.ceil(length / 0.2))
  for (let index = 0; index <= samples; index += 1) {
    const amount = index / samples
    if (!isWalkable({ x: from.x + (to.x - from.x) * amount, z: from.z + (to.z - from.z) * amount }, bridgeOpen)) {
      return false
    }
  }
  return true
}

const endpointCandidates = (point: Point, bridgeOpen: boolean): GridPoint[] => {
  const roundedX = snap(point.x)
  const roundedZ = snap(point.z)
  const candidates: GridPoint[] = []
  for (let dx = -GRID_STEP; dx <= GRID_STEP; dx += GRID_STEP) {
    for (let dz = -GRID_STEP; dz <= GRID_STEP; dz += GRID_STEP) {
      const candidate = gridPoint(roundedX + dx, roundedZ + dz)
      if (isWalkable(candidate, bridgeOpen) && segmentWalkable(point, candidate, bridgeOpen)) candidates.push(candidate)
    }
  }
  return candidates.sort((a, b) => distance(a, point) - distance(b, point) || a.x - b.x || a.z - b.z)
}

export const findPath = (from: Point, to: Point, bridgeOpen: boolean): Point[] => {
  if (!isWalkable(from, bridgeOpen) || !isWalkable(to, bridgeOpen)) return []
  if (distance(from, to) < 0.001) return [{ ...from }]

  const start = endpointCandidates(from, bridgeOpen)[0]
  const goal = endpointCandidates(to, bridgeOpen)[0]
  if (!start || !goal) return []

  const frontier: GridPoint[] = [start]
  const points = new Map<string, GridPoint>([[start.key, start]])
  const cameFrom = new Map<string, string>()
  const cost = new Map<string, number>([[start.key, 0]])
  const estimate = new Map<string, number>([[start.key, distance(start, goal)]])

  while (frontier.length > 0) {
    frontier.sort((a, b) => (estimate.get(a.key) ?? Infinity) - (estimate.get(b.key) ?? Infinity) || a.key.localeCompare(b.key))
    const current = frontier.shift()
    if (!current) break
    if (current.key === goal.key) {
      const middle = reconstruct(cameFrom, points, goal.key)
      const withEndpoints: Point[] = [{ ...from }, ...middle.slice(start.key === keyOf(from) ? 1 : 0)]
      if (goal.key !== keyOf(to)) withEndpoints.push({ ...to })
      return withEndpoints
    }

    for (const neighbor of gridNeighbors(current, bridgeOpen)) {
      const nextCost = (cost.get(current.key) ?? Infinity) + neighbor.cost
      if (nextCost >= (cost.get(neighbor.point.key) ?? Infinity)) continue
      cameFrom.set(neighbor.point.key, current.key)
      cost.set(neighbor.point.key, nextCost)
      estimate.set(neighbor.point.key, nextCost + distance(neighbor.point, goal))
      points.set(neighbor.point.key, neighbor.point)
      if (!frontier.some((candidate) => candidate.key === neighbor.point.key)) frontier.push(neighbor.point)
    }
  }
  return []
}

export const pathDistance = (path: readonly Point[]): number => {
  let total = 0
  for (let index = 1; index < path.length; index += 1) total += distance(path[index - 1], path[index])
  return total
}

export const nearestReachable = (point: Point, bridgeOpen: boolean): Point | null => {
  const clamped = {
    x: Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, snap(point.x))),
    z: Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, snap(point.z))),
  }
  if (isWalkable(clamped, bridgeOpen)) return clamped

  const maxRadius = Math.max(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)
  for (let radius = GRID_STEP; radius <= maxRadius; radius += GRID_STEP) {
    const candidates: Point[] = []
    for (let offset = -radius; offset <= radius; offset += GRID_STEP) {
      candidates.push(
        { x: clamped.x + offset, z: clamped.z - radius },
        { x: clamped.x + offset, z: clamped.z + radius },
        { x: clamped.x - radius, z: clamped.z + offset },
        { x: clamped.x + radius, z: clamped.z + offset },
      )
    }
    const reachable = candidates
      .filter((candidate) => isWalkable(candidate, bridgeOpen))
      .sort((a, b) => distance(a, point) - distance(b, point) || a.x - b.x || a.z - b.z)[0]
    if (reachable) return reachable
  }
  return null
}
