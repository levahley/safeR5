import { useEffect, useRef, useState } from 'react'
import { api, message } from './api'
import type { Evidence, EvidenceView } from './types'

type RawRequest =
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string; evidence: Evidence }
  | { status: 'error'; id: string; error: string }

export function useRawEvidence(experimentId: string, view: EvidenceView = 'perturbed') {
  const [request, setRequest] = useState<RawRequest | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  const clear = () => {
    pending.current?.abort()
    setRequest(null)
  }
  const open = async (id: string) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const params = new URLSearchParams({ event_id: id })
    if (view === 'baseline') params.set('view', view)
    setRequest({ status: 'loading', id })
    try {
      const evidence = await api<Evidence>(
        '/experiments/' + encodeURIComponent(experimentId) + '/evidence?' + params,
        undefined,
        controller.signal,
      )
      if (!controller.signal.aborted) setRequest({ status: 'ready', id, evidence })
    } catch (error) {
      if (!controller.signal.aborted) setRequest({ status: 'error', id, error: message(error) })
    }
  }
  return { request, open, clear }
}
