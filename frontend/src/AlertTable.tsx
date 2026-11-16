import { useState } from 'react'
import { date, num } from './domain'
import { Pagination } from './EvidenceRecords'
import { Empty } from './shared'
import type { Alert } from './types'

const pageSize = 25

export default function AlertTable({ alerts, open, focusMap, retainedIds, searchable = false }: {
  alerts: Alert[]
  open: (id: string) => void
  focusMap: (id: string) => void
  retainedIds?: ReadonlySet<string>
  searchable?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  if (!alerts.length) return <Empty title="Bu sonuçta alarm yok">Kaynak görünürlüğünü ve değerlendirme metriklerini birlikte inceleyin.</Empty>
  const search = query.trim().toLocaleLowerCase('tr')
  const matching = search ? alerts.filter(alert => [
    alert.rule_id, alert.message, alert.host_id, alert.user_id ?? '',
  ].some(value => value.toLocaleLowerCase('tr').includes(search))) : alerts

  return <>
    <p className="caption">Anomali skoru saldırı olasılığı değildir. Delil listesi, alarmın dayandığı olayları gösterir.</p>
    {searchable && <div className="field map-alarm-search">
      <label htmlFor="map-alarm-search">Alarmlarda ara</label>
      <input id="map-alarm-search" placeholder="Kural, makine veya kullanıcı" maxLength={200}
        value={query} onChange={event => { setQuery(event.target.value); setOffset(0) }}/>
    </div>}
    <div className="table-wrap"><table aria-label={retainedIds ? 'Tam kayıttaki alarmlar' : 'Gözlenen alarmlar'}>
      <thead><tr>
        {['Zaman', 'Yöntem', 'Alarm', 'Önem', 'Anomali skoru', 'Kanıt'].map(heading => <th key={heading} scope="col">{heading}</th>)}
      </tr></thead>
      <tbody>{matching.slice(offset, offset + pageSize).map(alert => <tr key={alert.id}>
        <td>{date(alert.event_time)}</td>
        <td>{alert.method === 'rules' ? 'Kural' : 'Isolation Forest'}</td>
        <td>{alert.message}<br/><code className="muted">{alert.rule_id}</code>
          {retainedIds && !retainedIds.has(alert.id) && <small className="map-relation-missing">Bu deneyde görünmüyor</small>}
          <div><button className="event-link" aria-label={alert.rule_id + ' alarmını haritada aç'}
            onClick={() => focusMap(alert.id)}>Haritada aç</button></div>
        </td>
        <td><span className={'tag ' + (alert.severity === 'high' ? 'red' : 'amber')}>{alert.severity === 'high' ? 'Yüksek' : 'Orta'}</span></td>
        <td>{alert.score === null ? '—' : num(alert.score)}</td>
        <td>{alert.evidence_ids.map(id => <p className="alarm-witness" key={id}>
          <button className="event-link" aria-label={id + ' kanıtını aç'} onClick={() => open(id)}>{id.slice(0, 12)}</button>
        </p>)}</td>
      </tr>)}
      {!matching.length && <tr><td colSpan={6}>Aramaya uyan alarm yok.</td></tr>}</tbody>
    </table></div>
    <Pagination offset={offset} total={matching.length} setOffset={setOffset}/>
  </>
}
