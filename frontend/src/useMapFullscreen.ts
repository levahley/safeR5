import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type FullscreenMode = 'native' | 'overlay' | null

export function useMapFullscreen() {
  const stage = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const exit = useRef<HTMLButtonElement>(null)
  const nativeActive = useRef(false)
  const entering = useRef(false)
  const [mode, setMode] = useState<FullscreenMode>(null)

  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement === stage.current && stage.current) {
        nativeActive.current = true
        setMode('native')
      } else if (nativeActive.current) {
        nativeActive.current = false
        setMode(null)
        opener.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  useLayoutEffect(() => {
    if (mode) exit.current?.focus({ preventScroll: true })
  }, [mode])

  useEffect(() => {
    if (!mode) return
    const previousOverflow = document.body.style.overflow
    if (mode === 'overlay') document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mode === 'overlay') {
        event.preventDefault()
        event.stopPropagation()
        setMode(null)
        opener.current?.focus({ preventScroll: true })
      }
      if (event.key !== 'Tab') return
      const items = [...(stage.current?.querySelectorAll<HTMLElement | SVGElement>(
        'button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]',
      ) ?? [])].filter(node => node.getClientRects().length > 0)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      const active = document.activeElement
      if (!stage.current?.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (mode === 'overlay') document.body.style.overflow = previousOverflow
    }
  }, [mode])

  const expand = async () => {
    const element = stage.current
    if (!element || entering.current || mode) return
    entering.current = true
    try {
      if (document.fullscreenEnabled && element.requestFullscreen) {
        await element.requestFullscreen()
        return
      }
    } catch {
      // Embedded browsers may refuse native fullscreen despite exposing the API.
    } finally {
      entering.current = false
    }
    if (element.isConnected) setMode('overlay')
  }

  const collapse = () => {
    if (mode === 'native' && document.fullscreenElement === stage.current) {
      void document.exitFullscreen().catch(() => { exit.current?.focus({ preventScroll: true }) })
      return
    }
    setMode(null)
    opener.current?.focus({ preventScroll: true })
  }

  return { stage, opener, exit, mode, expand, collapse }
}
