import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Camera } from './event-map-space'

type CameraChange = (camera: Camera) => Camera

export function useMapCameraMotion(camera: Camera, setCamera: Dispatch<SetStateAction<Camera>>) {
  const shown = useRef(camera)
  const target = useRef<Camera | null>(null)
  const frame = useRef<number | null>(null)
  const lastTime = useRef<number | null>(null)
  const easing = useRef(false)

  useLayoutEffect(() => { shown.current = camera }, [camera])

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    lastTime.current = null
    target.current = null
    return shown.current
  }, [])
  useEffect(() => () => { stop() }, [stop])

  const advance = useCallback(function renderFrame(time: number) {
    const next = target.current
    frame.current = null
    if (!next) return
    const current = shown.current
    const turn = next.yaw - current.yaw
    const yawDelta = Math.atan2(Math.sin(turn), Math.cos(turn))
    const pitchDelta = next.pitch - current.pitch
    const follow = easing.current && Math.max(Math.abs(yawDelta), Math.abs(pitchDelta)) > .001
    const elapsed = lastTime.current === null ? 1000 / 60 : Math.min(50, time - lastTime.current)
    const weight = 1 - Math.exp(-elapsed / 33)
    const displayed = follow ? { ...next, yaw: current.yaw + yawDelta * weight, pitch: current.pitch + pitchDelta * weight } : next
    shown.current = displayed
    setCamera(displayed)
    if (follow) {
      lastTime.current = time
      frame.current = requestAnimationFrame(renderFrame)
    } else {
      target.current = null
      lastTime.current = null
    }
  }, [setCamera])

  const enqueue = useCallback((change: CameraChange, easeRotation = false) => {
    target.current = change(target.current ?? shown.current)
    easing.current = easeRotation && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (frame.current === null) frame.current = requestAnimationFrame(advance)
  }, [advance])

  const apply = (change: CameraChange) => {
    const current = target.current ?? shown.current
    stop()
    const next = change(current)
    shown.current = next
    setCamera(next)
  }

  return { stop, enqueue, apply }
}
