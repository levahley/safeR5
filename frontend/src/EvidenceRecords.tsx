import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Orbit } from 'lucide-react'
import { api, message } from './api'
import { date, num } from './domain'
import { Empty, ErrorBox, Loading } from './shared'
import type { EventPage, EvidenceView } from './types'

const limit = 25

type RecordsProps = {
  experimentId: string
  filters: string
  view?: EvidenceView
  timeline?: boolean
  compact?: boolean
  selectedEvent?: string
  open: (id: string) => void
  focusMap: (id: string) => void
}

export default function EvidenceRecords({
  experimentId, filters, view = 'perturbed', timeline = false, compact = false, selectedEvent, open, focusMap,
}: RecordsProps) {
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [outcome, setOutcome] = useState<{ url: string; result?: EventPage; error?: string }>()
  const extra = view === 'baseline' ? '&view=baseline' : ''
  const url = '/experiments/' + encodeURIComponent(experimentId) + '/events?offset=' + offset + '&limit=' + limit + extra + filters

  useEffect(() => {
    const controller = new AbortController()
    api<EventPage>(url, undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setOutcome({ url, result })
    }).catch(error => {
      if (!controller.signal.aborted) setOutcome({ url, error: message(error) })
    })
    return () => controller.abort()
  }, [url, retry])

  if (outcome?.url !== url) return <Loading/>
  if (!outcome.result) {
    return <ErrorBox error={outcome.error ?? 'Olaylar yüklenemedi.'} retry={() => {
      setOutcome(undefined)
      setRetry(value => value + 1)
    }}/>
  }

  const { items, total } = outcome.result
  const missing = new Set(outcome.result.missing_event_ids)
  const headings = compact ? ['Olay', 'Kanıt'] : ['Olay zamanı (UTC)', 'Kaynak', 'Makine / kullanıcı', 'Eylem', 'Sonuç', 'Kanıt']
  if (!items.length) return <Empty title="Gözlenen olay yok">Filtreleri veya seçili kayıt görünümünü kontrol edin.</Empty>

  return <>
    {timeline ? <ol className="timeline" aria-label="Gözlenen olay zaman çizgisi">
      {items.map(event => <li key={event.event_id}>
        <time dateTime={event.event_time}>{date(event.event_time)}</time>
        <p><span className="tag">{event.source_type}</span> {event.action} · {event.host_id} · {event.result ?? 'Sonuç bilinmiyor'}{' '}
          <button className="event-link" onClick={() => open(event.event_id)} aria-label={event.event_id + ' kanıtını aç'}>{event.event_id.slice(0, 12)}</button>
        </p>
      </li>)}
    </ol> : <div className={compact ? 'table-wrap map-record-scroll' : 'table-wrap'} tabIndex={compact ? 0 : undefined}>
      <table aria-label="Gözlenen olaylar">
        <thead><tr>{headings.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{items.map(event => <tr key={event.event_id} className={selectedEvent === event.event_id ? 'map-table-selected' : undefined}>
          {!compact && <>
            <td className="record-time">{date(event.event_time)}</td>
            <td><span className="tag">{event.source_type}</span></td>
            <td>{event.host_id}<br/><span className="muted">{event.user_id ?? 'Bilinmiyor'}</span></td>
          </>}
          <td>{event.action}
            {compact && <><span className="map-record-source">{event.source_type}</span>
              <time dateTime={event.event_time}>{date(event.event_time)}</time></>}
            {missing.has(event.event_id) && <small className="map-relation-missing">Bu deneyde görünmüyor</small>}
          </td>
          {!compact && <td>{event.result ?? 'Bilinmiyor'}</td>}
          <td><div className="record-actions">
            <button className="event-link" aria-label={event.event_id + ' kanıtını aç'} onClick={() => open(event.event_id)}>{event.event_id.slice(0, 12)}</button>
            <button className="icon-button map-open-button" aria-label={event.event_id + ' olayını haritada aç'} title="Haritada aç" onClick={() => focusMap(event.event_id)}><Orbit size={16}/></button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <Pagination offset={offset} total={total} setOffset={setOffset}/>
  </>
}

export function Pagination({ offset, total, setOffset, pageSize = limit }: {
  offset: number
  total: number
  setOffset: (offset: number) => void
  pageSize?: number
}) {
  return <div className="pagination">
    <span>{total ? num(offset + 1) + '–' + num(Math.min(offset + pageSize, total)) : '0'} / {num(total)} kayıt</span>
    {total > pageSize && <div className="button-row">
      <button className="button small quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ChevronLeft size={13}/>Önceki</button>
      <button className="button small quiet" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Sonraki<ChevronRight size={13}/></button>
    </div>}
  </div>
}
