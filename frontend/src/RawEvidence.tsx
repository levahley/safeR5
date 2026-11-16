import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { date, sourceNames } from './domain'
import type { Evidence } from './types'

export default function RawEvidence({ evidence, close, focus = false }: {
  evidence: Evidence
  close: () => void
  focus?: boolean
}) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) {
      panel.current?.scrollIntoView?.({ block: 'start' })
      panel.current?.focus({ preventScroll: true })
    }
  }, [evidence, focus])
  const { event, reference } = evidence
  return <section className="evidence-detail" aria-label="Ham kanıt" ref={panel} tabIndex={-1}>
    <div className="detail-top">
      <h3>Ham olay · <code>{event.event_id}</code></h3>
      <button className="icon-button" aria-label="Kanıtı kapat" onClick={close}><X size={17}/></button>
    </div>
    <dl className="detail-grid">
      <div><dt>Kaynak</dt><dd>{sourceNames[event.source_type]}</dd></div>
      <div><dt>Olay zamanı</dt><dd>{date(event.event_time)}</dd></div>
      <div><dt>Gözlenme zamanı</dt><dd>{date(event.observed_time)}</dd></div>
      <div><dt>Dosya kimliği</dt><dd><code>{reference.file_id}</code></dd></div>
      <div><dt>Satır</dt><dd>{reference.line}</dd></div>
      <div><dt>Ayrıştırıcı / şema</dt><dd>{event.parser_version} / {event.schema_version}</dd></div>
    </dl>
    <p className="caption">SHA-256 <code>{reference.sha256}</code></p>
    <pre aria-label="Ham satır">{evidence.raw}</pre>
    <details className="details-plain">
      <summary>Normalleştirilmiş olay alanları</summary>
      <pre>{JSON.stringify(event, null, 2)}</pre>
    </details>
  </section>
}
