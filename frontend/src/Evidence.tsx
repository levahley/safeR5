import { useRef, useState } from 'react'
import { Activity, Clock3, GitBranch, List, Orbit, Search } from 'lucide-react'
import { Empty, ErrorBox, Loading, Notice, PageHead } from './shared'
import { num, sourceNames, sources } from './domain'
import type { Experiment, Graph, MapFocus } from './types'
import AlertTable from './AlertTable'
import EvidenceRecords, { Pagination } from './EvidenceRecords'
import EventMapWorkspace from './EventMap'
import RawEvidence from './RawEvidence'
import { useRawEvidence } from './useRawEvidence'

const tabs = [
  { id: 'events', label: 'Olaylar', icon: List },
  { id: 'timeline', label: 'Zaman çizgisi', icon: Clock3 },
  { id: 'map', label: 'Olay haritası', icon: Orbit },
  { id: 'graph', label: 'İlişki grafiği', icon: GitBranch },
  { id: 'alerts', label: 'Alarmlar', icon: Activity },
] as const
type Tab = typeof tabs[number]['id']
const limit = 25

type EventFilters = { source: string; q: string; start: string; end: string }
const emptyFilters: EventFilters = { source: '', q: '', start: '', end: '' }

export default function EvidenceWorkspace({ experiment, startInMap = false }: {
  experiment: Experiment
  startInMap?: boolean
}) {
  const [tab, setTab] = useState<Tab>(startInMap ? 'map' : 'events')
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [draft, setDraft] = useState<EventFilters>(emptyFilters)
  const [applied, setApplied] = useState<EventFilters>(emptyFilters)
  const [filterError, setFilterError] = useState('')
  const { request, open, clear } = useRawEvidence(experiment.id)
  const evidenceTrigger = useRef<HTMLElement | SVGElement | null>(null)

  const selectTab = (next: Tab) => {
    clear()
    setTab(next)
  }
  const openEvidence = (id: string) => {
    const trigger = document.activeElement
    evidenceTrigger.current = trigger instanceof HTMLElement || trigger instanceof SVGElement ? trigger : null
    return open(id)
  }
  const focusMap = (kind: MapFocus['kind'], id: string) => {
    setFocus({ kind, id })
    selectTab('map')
    document.getElementById('tab-map')?.focus()
  }

  const filterParams = new URLSearchParams()
  for (const [name, value] of Object.entries(applied)) {
    if (value) filterParams.set(name, name === 'start' || name === 'end' ? new Date(value + 'Z').toISOString() : value)
  }
  const filters = filterParams.size ? '&' + filterParams : ''
  const setDate = (name: 'start' | 'end', value: string) => setDraft(current => ({ ...current, [name]: value }))

  return <>
    <PageHead title="Her iddianın arkasındaki olay.">Kayıtları inceleyin, bir olayı veya alarmı haritada merkeze alın ve özgün satırına dönün.</PageHead>
    <div className="stack">
      {tab !== 'map' && <Notice>İlişkiler gözlenen kanıtlarla desteklenir. Nedensellik çıkarımı için ek delil gerekir.</Notice>}
      <section className="panel evidence-workspace">
        <div className="tabs" role="tablist" aria-label="Kanıt görünümleri">
          {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} id={'tab-' + id}
            aria-controls={'panel-' + id} className="tab" role="tab" aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1} onClick={() => selectTab(id)}
            onKeyDown={event => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!step) return
              event.preventDefault()
              const next = tabs[(index + step + tabs.length) % tabs.length].id
              selectTab(next)
              document.getElementById('tab-' + next)?.focus()
            }}><Icon size={15}/>{label}</button>)}
        </div>

        <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab}>
          {(tab === 'events' || tab === 'timeline' || tab === 'map') && <>
            <form className="evidence-filter evidence-filter-range" aria-label="Olay filtreleri" onSubmit={event => {
              event.preventDefault()
              if (draft.start && draft.end && new Date(draft.start + 'Z') >= new Date(draft.end + 'Z')) {
                setFilterError('Bitiş, başlangıçtan sonra olmalı.')
                return
              }
              setFilterError('')
              clear()
              setApplied({ ...draft, q: draft.q.trim() })
            }}>
              <div className="field"><label htmlFor="evidence-source">Kaynak</label>
                <select id="evidence-source" value={draft.source} onChange={event => {
                  const source = event.target.value
                  setDraft(current => ({ ...current, source }))
                  setApplied(current => ({ ...current, source }))
                  clear()
                }}>
                  <option value="">Tüm kaynaklar</option>
                  {sources.map(source => <option key={source} value={source}>{sourceNames[source]}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="event-search">Olaylarda ara</label>
                <input id="event-search" maxLength={200} value={draft.q} onChange={event => {
                  const q = event.target.value
                  setDraft(current => ({ ...current, q }))
                }} placeholder="Olay, varlık veya içerik"/>
              </div>
              <div className="field"><label htmlFor="evidence-start">Başlangıç (UTC)</label>
                <input id="evidence-start" type="datetime-local" step={1} value={draft.start} onChange={event => setDate('start', event.target.value)}/>
              </div>
              <div className="field"><label htmlFor="evidence-end">Bitiş (UTC)</label>
                <input id="evidence-end" type="datetime-local" step={1} value={draft.end} onChange={event => setDate('end', event.target.value)}/>
              </div>
              <div className="button-row evidence-filter-actions">
                <button className="button"><Search size={15}/>Ara</button>
                {(draft.source || draft.q || draft.start || draft.end || filters) &&
                  <button type="button" className="button quiet" onClick={() => {
                    setApplied(emptyFilters)
                    setDraft(emptyFilters)
                    setFilterError('')
                    clear()
                  }}>Filtreleri temizle</button>}
              </div>
            </form>
            {filterError && <ErrorBox error={filterError}/>}
          </>}
          {(tab === 'events' || tab === 'timeline') &&
            <EvidenceRecords key={filters} filters={filters} experimentId={experiment.id}
              timeline={tab === 'timeline'} open={id => void openEvidence(id)} focusMap={id => focusMap('event', id)}/>}
          {tab === 'map' && <EventMapWorkspace experiment={experiment} filters={filters} focus={focus} onFocus={setFocus}/>}
          {tab === 'graph' && <GraphView graph={experiment.perturbed.graph} open={openEvidence}/>}
          {tab === 'alerts' && <AlertTable alerts={experiment.perturbed.alerts} open={openEvidence} focusMap={id => focusMap('alert', id)}/>}
        </div>
        {tab !== 'map' && request?.status === 'loading' && <Loading>Ham kanıt getiriliyor…</Loading>}
        {tab !== 'map' && request?.status === 'error' && <ErrorBox error={request.error} retry={() => void open(request.id)}/>}
        {tab !== 'map' && request?.status === 'ready' && <RawEvidence evidence={request.evidence} focus close={() => {
          clear()
          evidenceTrigger.current?.focus()
        }}/>}
      </section>
    </div>
  </>
}

function GraphView({graph,open}:{graph:Graph;open:(id:string)=>Promise<void>}) {
  const [offset,setOffset]=useState(0)
  const nodes=graph.nodes.slice(0,36)
  const positions=new Map(nodes.map((node,index)=>[node.id,{x:55+(index%6)*112,y:42+Math.floor(index/6)*47}]))
  const labels=new Map(graph.nodes.map(node=>[node.id,node.label]))
  if(!graph.nodes.length)return <Empty title="Gözlenen ilişki yok">Bu sonuçta kanıtla desteklenen ilişki bulunmuyor.</Empty>
  return <><p className="caption">Grafik ilk {nodes.length} düğümü gösterir; tüm {num(graph.edges.length)} ilişki aşağıdaki erişilebilir tabloda sayfalanır. Olay düğümleri tıklama, Enter veya boşluk tuşuyla ham kanıtı açar.</p><svg className="graph-svg" viewBox="0 0 680 320" role="group" aria-label="Gözlenen olay ve varlık ilişkileri"><title>Gözlenen olay ve varlık ilişkileri</title>{graph.edges.filter(edge=>positions.has(edge.source)&&positions.has(edge.target)).map((edge,index)=><line key={index} x1={positions.get(edge.source)!.x} y1={positions.get(edge.source)!.y} x2={positions.get(edge.target)!.x} y2={positions.get(edge.target)!.y}/>)}{nodes.map(node=>{const p=positions.get(node.id)!;return <g key={node.id} className={node.kind==='event'?'graph-node':undefined} role={node.kind==='event'?'button':undefined} tabIndex={node.kind==='event'?0:undefined} aria-label={node.kind==='event'?node.label+' olayının kanıtını aç':undefined} onClick={node.kind==='event'?()=>void open(node.id):undefined} onKeyDown={node.kind==='event'?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void open(node.id)}}:undefined}>{node.kind==='event'&&<><circle className="graph-hit-area" cx={p.x} cy={p.y} r={18}/><circle className="graph-focus-ring" cx={p.x} cy={p.y} r={13}/></>}<circle className={'graph-'+node.kind} cx={p.x} cy={p.y} r={7}/><text x={p.x} y={p.y+19} textAnchor="middle">{node.label.length>15?node.label.slice(0,13)+'…':node.label}</text></g>})}</svg><div className="graph-legend"><span><i/>Olay</span><span><i/>Makine</span><span><i/>Kullanıcı</span><span><i/>Oturum</span></div><div className="table-wrap"><table aria-label="Kanıta dayalı ilişkiler"><thead><tr><th scope="col">Başlangıç</th><th scope="col">İlişki</th><th scope="col">Hedef</th><th scope="col">Belirsizlik</th><th scope="col">Gözlenen kanıt</th></tr></thead><tbody>{graph.edges.slice(offset,offset+limit).map((edge,index)=><tr key={index}><td>{labels.get(edge.source)??edge.source}</td><td>{edge.relation}</td><td>{labels.get(edge.target)??edge.target}</td><td>{edge.uncertainty||'Belirtilmedi'}</td><td>{edge.evidence_ids.length?<details><summary>{edge.evidence_ids.length} kanıt</summary>{edge.evidence_ids.map(id=><p key={id} style={{margin:'8px 0'}}><button className="event-link" aria-label={id+' kanıtını aç'} onClick={()=>void open(id)}>{id.slice(0,12)}</button></p>)}</details>:'Kanıt yok'}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={graph.edges.length} setOffset={setOffset}/></>
}
