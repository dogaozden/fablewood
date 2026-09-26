import { describe, expect, it } from 'vitest'
import { BRIDGE, isCreekPoint } from './landscape'
import {
  LANDMARKS,
  STATIC_OBSTACLES,
  WORLD_BOUNDS,
  distance,
  findPath,
  isNearLandmark,
  isWalkable,
  nearestReachable,
  pathDistance,
} from './navigation'

describe('game3d navigation', () => {
  it('publishes the binding world extents and landmark coordinates', () => {
    expect(WORLD_BOUNDS).toEqual({ minX: -23, maxX: 34, minZ: -22, maxZ: 21 })
    expect(Object.fromEntries(LANDMARKS.map(({ id, position }) => [id, position]))).toEqual({
      hearth: { x: -10, z: 1 },
      mira: { x: 3, z: 6 },
      well: { x: 4.5, z: 10 },
      'stone-1': { x: 6, z: 4 },
      'stone-2': { x: 17, z: 3 },
      'stone-3': { x: 24, z: -6 },
      guardian: { x: 27, z: -12 },
      chest: { x: 20, z: 8 },
    })
    expect(LANDMARKS.every(({ radius }) => radius === 2.5)).toBe(true)
  })

  it('keeps house, well, tree, and world collision in one data model', () => {
    expect(STATIC_OBSTACLES.length).toBeGreaterThan(10)
    expect(isWalkable({ x: -10, z: -6 }, true)).toBe(false)
    expect(isWalkable({ x: -16, z: -6 }, true)).toBe(false)
    expect(isWalkable({ x: -8, z: 0 }, true)).toBe(true)
    expect(isWalkable({ x: 3, z: -12 }, true)).toBe(true)
    expect(isWalkable({ x: 4.5, z: 10 }, true)).toBe(false)
    expect(isWalkable({ x: -19, z: -15 }, true)).toBe(false)
    expect(isWalkable({ x: -23.01, z: 0 }, true)).toBe(false)
    expect(isWalkable({ x: -23, z: 0 }, true)).toBe(true)
  })

  it('blocks the creek until renewal and then opens only the bridge span', () => {
    expect(isWalkable({ x: 11, z: 4 }, false)).toBe(false)
    expect(isWalkable({ x: 11, z: 4 }, true)).toBe(true)
    expect(isWalkable({ x: 11, z: -.01 }, true)).toBe(false)
    expect(isWalkable({ x: 11, z: 4.01 }, true)).toBe(false)
    expect(findPath({ x: 6, z: 4 }, { x: 17, z: 3 }, false)).toEqual([])
  })

  it('finds deterministic one-unit bridge routes without crossing blocked water', () => {
    const path = findPath({ x: 6, z: 4 }, { x: 17, z: 3 }, true)
    expect(path[0]).toEqual({ x: 6, z: 4 })
    expect(path.at(-1)).toEqual({ x: 17, z: 3 })
    expect(path.length).toBeGreaterThan(8)
    expect(path.every((point) => isWalkable(point, true))).toBe(true)
    expect(path.slice(1).every((point, index) => distance(path[index], point) <= Math.SQRT2 + 0.001)).toBe(true)
    expect(path.filter(({ x, z }) => isCreekPoint(x, z)).every(({ z }) => z >= BRIDGE.minZ && z <= BRIDGE.maxZ)).toBe(true)
    expect(findPath({ x: 6, z: 4 }, { x: 17, z: 3 }, true)).toEqual(path)
  })

  it('routes around buildings and never cuts a blocked diagonal corner', () => {
    const path = findPath({ x: -21, z: -6 }, { x: -5, z: -6 }, false)
    expect(path.length).toBeGreaterThan(10)
    expect(path.every((point) => isWalkable(point, false))).toBe(true)
    expect(pathDistance(path)).toBeGreaterThan(10)

    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1]
      const current = path[index]
      if (previous.x !== current.x && previous.z !== current.z) {
        expect(isWalkable({ x: current.x, z: previous.z }, false)).toBe(true)
        expect(isWalkable({ x: previous.x, z: current.z }, false)).toBe(true)
      }
    }
  })

  it('supports decimal endpoints and finds interaction ground around blocked landmarks', () => {
    const path = findPath({ x: -8.2, z: 0.2 }, { x: -2.6, z: 0.1 }, false)
    expect(path[0]).toEqual({ x: -8.2, z: 0.2 })
    expect(path.at(-1)).toEqual({ x: -2.6, z: 0.1 })
    expect(path.every((point) => isWalkable(point, false))).toBe(true)

    const besideWell = nearestReachable({ x: 4.5, z: 10 }, false)
    expect(besideWell).not.toBeNull()
    expect(isWalkable(besideWell!, false)).toBe(true)
    expect(isNearLandmark(besideWell!, 'well')).toBe(true)
  })

  it('returns no path for invalid endpoints rather than leaking NaN', () => {
    expect(findPath({ x: Number.NaN, z: 0 }, { x: 0, z: 0 }, true)).toEqual([])
    expect(findPath({ x: 0, z: 0 }, { x: 100, z: 0 }, true)).toEqual([])
  })
})
