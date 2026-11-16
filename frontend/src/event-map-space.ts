import type { MapNode, Source } from './types'

export type Vector = readonly [number, number, number]
export type Camera = { x: number; y: number; zoom: number; yaw: number; pitch: number; mode: 'scene' | 'overhead' }

export const origin: Camera = { x: 0, y: 0, zoom: 1, yaw: -.35, pitch: .94, mode: 'scene' }
export const width = 740, height = 572
export const cx = width / 2, cy = 270, focal = 820
export const minZoom = .75, maxZoom = 2.5
export const inner = 119, outer = 201
export const floor = -49, entityLevel = 36, coreLevel = 122
export const angles: Record<Source, number> = { auth: -90, audit: 30, dns: 150 }

export function polar(angle: number, radius: number, z = 0): Vector {
  const azimuth = angle * Math.PI / 180
  return [radius * Math.cos(azimuth), radius * Math.sin(azimuth), z]
}

// The SVG hit targets and the WebGL camera share this coordinate system.
export function makeProjection(mode: Camera['mode'], yaw: number, pitch: number) {
  const cos = Math.cos(pitch), sin = Math.sin(pitch)
  const yawCos = Math.cos(yaw), yawSin = Math.sin(yaw)
  return ([x, y, z]: Vector) => {
    if (mode === 'overhead') return { x: cx + x, y: cy + y, scale: 1 }
    const rotatedX = x * yawCos - y * yawSin
    const rotatedY = x * yawSin + y * yawCos
    const scale = focal / (focal - rotatedY * sin - z * cos)
    return { x: cx + rotatedX * scale, y: cy + (rotatedY * cos - z * sin) * scale, scale }
  }
}

export function nodePosition(node: MapNode): Vector {
  if (node.angle === null) return [0, 0, coreLevel]
  if (node.kind === 'event') return polar(node.angle, outer + (node.lane ?? 0) * 16, 13)
  return polar(node.angle, inner, entityLevel)
}

export function rotateCamera(camera: Camera, yaw: number, pitch: number): Camera {
  return { ...camera, yaw: yaw % (2 * Math.PI), pitch: Math.min(1.08, Math.max(0.27, pitch)) }
}

export function zoomCamera(camera: Camera, zoom: number, x = cx + camera.x, y = cy + camera.y): Camera {
  const next = Math.min(maxZoom, Math.max(minZoom, zoom))
  if (next === camera.zoom) return camera
  const weight = 1 - next / camera.zoom
  return {
    ...camera, zoom: next,
    x: camera.x + (x - cx - camera.x) * weight,
    y: camera.y + (y - cy - camera.y) * weight,
  }
}
