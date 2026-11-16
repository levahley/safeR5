import type { MapNode, Source } from './types'
import {
  angles, coreLevel, entityLevel, floor, inner, nodePosition, outer, polar,
} from './event-map-space'
import type { Vector } from './event-map-space'

const sourceLight: Record<Source, Vector> = {
  auth: [.27, .89, .77],
  audit: [.46, .67, .98],
  dns: [.95, .64, .29],
}
const alloy: Vector = [.16, .23, .31]
const rim: Vector = [.22, .35, .44]
const inset: Vector = [.07, .12, .18]
const entity: Vector = [.31, .67, .72]

function scale([x, y, z]: Vector, gain: number): Vector {
  return [x * gain, y * gain, z * gain]
}
function offset([x, y, z]: Vector, [a, b, c]: Vector): Vector {
  return [x + a, y + b, z + c]
}
function unit(v: Vector) {
  return scale(v, 1 / (Math.hypot(...v) || 1))
}

export function buildEventMapMesh(nodes: MapNode[]) {
  const data: number[] = []
  function face(a: Vector, b: Vector, c: Vector, color: Vector, glow: number) {
    const [x, y, z] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const [u, v, w] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normal = unit([y * w - z * v, z * u - x * w, x * v - y * u])
    for (const point of [a, b, c]) data.push(...point, ...normal, ...color, glow)
  }
  function quad(a: Vector, b: Vector, c: Vector, d: Vector, color: Vector, glow = 0) {
    face(a, b, c, color, glow)
    face(a, c, d, color, glow)
  }
  function ring(min: number, max: number, bottom: number, top: number, color: Vector, options: {
    bevel?: number; start?: number; end?: number; glow?: number
  } = {}) {
    const { bevel = 2, start = 0, end = 360, glow = 0 } = options
    const b = Math.min(bevel, (max - min) / 3, (top - bottom) / 2)
    const profile = [
      [min + b, bottom], [max - b, bottom], [max, bottom + b], [max, top - b],
      [max - b, top], [min + b, top], [min, top - b], [min, bottom + b], [min + b, bottom],
    ] as const
    const steps = Math.ceil((end - start) / 5)
    for (let slice = 0; slice < steps; slice++) {
      const from = start + (end - start) * slice / steps
      const to = start + (end - start) * (slice + 1) / steps
      for (let side = 0; side < profile.length - 1; side++) {
        const [r0, z0] = profile[side]
        const [r1, z1] = profile[side + 1]
        quad(polar(from, r0, z0), polar(to, r0, z0), polar(to, r1, z1), polar(from, r1, z1), color, glow)
      }
    }
    if (end - start < 360) {
      quad(polar(start, min, bottom + b), polar(start, max, bottom + b),
        polar(start, max, top - b), polar(start, min, top - b), color, glow)
      quad(polar(end, max, bottom + b), polar(end, min, bottom + b),
        polar(end, min, top - b), polar(end, max, top - b), color, glow)
    }
  }

  function crystal(center: Vector, radius: number, color: Vector, fine: boolean) {
    const phi = (1 + Math.sqrt(5)) / 2
    const points: Vector[] = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ]
    const facets = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ]
    const point = (v: Vector) => offset(center, scale(unit(v), radius))
    const add = (a: Vector, b: Vector, c: Vector, gain: number) => {
      face(point(a), point(b), point(c), scale(color, gain), fine ? .08 : .015)
    }
    for (const [i, j, k] of facets) {
      const a = points[i], b = points[j], c = points[k]
      if (!fine) { add(a, b, c, 1); continue }
      const ab = offset(a, b), bc = offset(b, c), ca = offset(c, a)
      add(a, ab, ca, 1)
      add(b, bc, ab, 1.06)
      add(c, ca, bc, .95)
      add(ab, bc, ca, .84)
    }
  }

  // Two beveled decks and an inset ring seat the source tracks.
  ring(0.1, 246, floor - 30, floor - 15, inset, { bevel: 6 })
  ring(0.1, 253, floor - 16, floor, alloy, { bevel: 5 })
  ring(235, 248, floor - 2, floor + 1, rim, { bevel: 1 })
  ring(0.1, 226, floor - 1, floor + 6, inset, { bevel: 3 })
  ring(152, 157, floor + 5, floor + 8, alloy)
  ring(inner - 20, inner + 14, entityLevel - 55, entityLevel - 43, alloy, { bevel: 4 })
  ring(inner - 5, inner - 3, entityLevel - 44, entityLevel - 42, rim)
  ring(0.1, 51, floor + 4, -12, alloy, { bevel: 6 })
  ring(0.1, 39, -14, 0, inset, { bevel: 4 })
  ring(29, 34, 0, 3, [.22, .64, .64], { glow: .2 })

  const visibleSources = new Set(nodes.filter(node => node.kind === 'event').flatMap(node => node.sources))
  for (const source of Object.keys(angles) as Source[]) {
    const color = sourceLight[source]
    const angle = angles[source]
    const onMap = visibleSources.has(source)
    const track = onMap ? scale(color, .26) : alloy
    const line = onMap ? color : scale(color, .32)
    ring(outer - 27, outer + 26, floor + 8, 1, track, { start: angle - 52, end: angle + 52, bevel: 5 })
    ring(outer + 17, outer + 22, 1, 4, line, { start: angle - 49, end: angle + 49, glow: onMap ? .30 : 0 })
    ring(outer - 24, outer - 22, 1, 3, scale(line, .65), { start: angle - 49, end: angle + 49 })
    for (let tick = -43; tick <= 43; tick += 8.6) {
      const from = angle + tick
      quad(polar(from, 231, floor + 1), polar(from + .85, 231, floor + 1),
        polar(from + .85, 240, floor + 1), polar(from, 240, floor + 1), line, .12)
    }
  }

  for (const node of nodes) {
    if (node.missing) continue
    const source = node.kind === 'event' ? node.sources[0] : undefined
    const color = source ? sourceLight[source] : entity
    const center = nodePosition(node)
    if (node.angle === null) {
      crystal(center, 39, [.17, .79, .76], true)
      ring(47, 49, coreLevel - 9, coreLevel - 5, [.21, .56, .60], { glow: .22, start: 14, end: 322 })
    } else {
      crystal(center, node.kind === 'event' ? 12 : 16, scale(color, .70), false)
    }
  }
  return new Float32Array(data)
}
