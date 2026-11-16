import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent, SetStateAction } from 'react'
import {
  CircleHelp, Cpu, FileTerminal, Globe2, KeyRound, Maximize, Minimize, Move, Network, Orbit, RotateCcw,
  Server, ShieldAlert, UserRound, ZoomIn, ZoomOut,
} from 'lucide-react'
import AlertTable from './AlertTable'
import { api, message } from './api'
import { date, num, sourceNames, sources } from './domain'
import EvidenceRecords, { Pagination } from './EvidenceRecords'
import EventMapSummary from './EventMapSummary'
import EventMapScene from './EventMapScene'
import { angles, coreLevel, cx, cy, entityLevel, floor, height, inner, makeProjection, maxZoom, minZoom, nodePosition, origin, outer, polar, rotateCamera, width, zoomCamera } from './event-map-space'
import type { Camera } from './event-map-space'
import RawEvidence from './RawEvidence'
import { Empty, ErrorBox, Loading } from './shared'
import type { Alert, EventMap, EvidenceView, Experiment, MapEdge, MapFocus, MapNode } from './types'
import { useMapCameraMotion } from './useMapCameraMotion'
import { useMapFullscreen } from './useMapFullscreen'
import { useRawEvidence } from './useRawEvidence'
import './event-map.css'

const missingLabel = 'Bu deneyde görünmüyor'
const kindLabels = { alert: 'Alarm', event: 'Olay', host: 'Makine', user: 'Kullanıcı', session: 'Oturum', process: 'Süreç' }
const riskLabels = { high: 'Yüksek önem', medium: 'Orta önem', unflagged: 'Alarm bağı yok' }
const sourceIcons = { auth: KeyRound, audit: FileTerminal, dns: Globe2 }
const entityIcons = { alert: ShieldAlert, host: Server, user: UserRound, session: Network, process: Cpu }
const relationLabels: Record<MapEdge['relation'], string> = {
  alarm_evidence: 'Alarm delili',
  observed_on: 'Makinede gözlendi',
  observed_user: 'Kullanıcı kayıtta belirtiliyor',
  observed_session: 'Kayıtta belirtilen oturum',
  recorded_process: 'Kayıtta belirtilen süreç',
  time_proximity: 'Olası ilişki',
}
const relationNotes: Record<MapEdge['relation'], string> = {
  alarm_evidence: 'Algılayıcı bu olayı, seçili alarmın delil listesine ekledi.',
  observed_on: 'Bu olay, bağlı olduğu makineyi kendi makine alanında belirtir.',
  observed_user: 'Bu olay, bağlı kullanıcıyı kendi kullanıcı alanında belirtir.',
  observed_session: 'Bağ, kayıtlardaki makine, kullanıcı ve oturum bilgisine dayanır.',
  recorded_process: 'Bağ, kaydın işlem numarasına ve varsa makine ile süreç başlangıç zamanına dayanır.',
  time_proximity: 'Bağ yalnızca olay zamanlarının yakınlığına dayanır. İnceleme için bir ipucudur.',
}

function orbitPath(project: ReturnType<typeof makeProjection>, radius: number, elevation: number, start = 0, end = 360) {
  const segments = Math.ceil((end - start) / 6)
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const point = project(polar(start + (end - start) * index / segments, radius, elevation))
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
  })
  return 'M ' + points.join(' L ') + (end - start === 360 ? ' Z' : '')
}

const edgeKey = (edge: MapEdge) => JSON.stringify([edge.source, edge.target, edge.relation])

export default function EventMapWorkspace({ experiment, filters, focus, onFocus }: {
  experiment: Experiment
  filters: string
  focus: MapFocus | null
  onFocus: (focus: MapFocus | null) => void
}) {
  const [view, setView] = useState<EvidenceView>('perturbed')
  const [camera, setCamera] = useState<Camera>(origin)
  const { stage: fullscreenStage, opener: fullscreenOpener, exit: fullscreenExit,
    mode: fullscreenMode, expand: expandMap, collapse: collapseMap } = useMapFullscreen()
  const retainedAlerts = useMemo(() => new Set(experiment.perturbed.alerts.map(alert => alert.id)), [experiment])
  const params = new URLSearchParams()
  if (view === 'baseline') params.set('view', view)
  new URLSearchParams(filters).forEach((value, name) => params.set(name, value))
  if (focus) {
    params.set('focus_kind', focus.kind)
    params.set('focus_id', focus.id)
  }
  const url = '/experiments/' + encodeURIComponent(experiment.id) + '/event-map' + (params.size ? '?' + params : '')
  const chooseFocus = (next: MapFocus | null) => {
    setCamera(current => ({ ...origin, mode: current.mode }))
    onFocus(next)
    if (fullscreenMode) {
      fullscreenStage.current?.scrollTo({ top: 0 })
      fullscreenExit.current?.focus({ preventScroll: true })
    } else if (next) {
      const tab = document.getElementById('tab-map')
      tab?.focus()
      tab?.scrollIntoView?.({ block: 'start' })
    }
  }
  const switchView = (next: EvidenceView) => {
    // Geometry and camera are shared by both views for the same focus and filters.
    setView(next)
  }

  return <div className="event-map-workspace">
    <header className="map-heading">
      <div><h2>Olay haritası</h2><p className="caption">Merkezde seçili alarm veya olay, halkalarda ilgili varlıklar ve kayıtlar.</p></div>
      <div className="map-heading-actions">
        <div className="map-view-switch" role="group" aria-label="Deneyin kayıt görünümü">
          <button type="button" aria-pressed={view === 'baseline'} onClick={() => switchView('baseline')}>Tam kayıt</button>
          <button type="button" aria-pressed={view === 'perturbed'} onClick={() => switchView('perturbed')}>Kayıt kaybı uygulanmış</button>
        </div>
        <button type="button" className="button small" ref={fullscreenOpener} onClick={() => void expandMap()}>
          <Maximize size={15} aria-hidden="true"/>Tam ekran
        </button>
      </div>
    </header>
    <EventMapSummary experiment={experiment} view={view}/>
    <div ref={fullscreenStage} className="map-stage" data-fullscreen={fullscreenMode ?? undefined}
      role={fullscreenMode ? 'dialog' : undefined} aria-modal={fullscreenMode ? true : undefined}
      aria-label={fullscreenMode ? 'Tam ekran olay haritası' : undefined}>
      {fullscreenMode && <div className="map-fullscreen-toolbar">
        <button type="button" className="button small" ref={fullscreenExit} onClick={collapseMap}>
          <Minimize size={15} aria-hidden="true"/>Tam ekrandan çık
        </button>
      </div>}
      <MapResult key={url} url={url} experimentId={experiment.id} filters={filters} view={view}
        camera={camera} setCamera={setCamera} onFocus={chooseFocus}
        alerts={experiment[view].alerts} retainedIds={view === 'baseline' ? retainedAlerts : undefined}/>
    </div>
  </div>
}

type CameraProps = { camera: Camera; setCamera: Dispatch<SetStateAction<Camera>> }
type MapResultProps = CameraProps & {
  url: string
  experimentId: string
  view: EvidenceView
  filters: string
  alerts: Alert[]
  retainedIds?: ReadonlySet<string>
  onFocus: (focus: MapFocus | null) => void
}

function MapResult({ url, ...props }: MapResultProps) {
  const [retry, setRetry] = useState(0)
  const [outcome, setOutcome] = useState<{ map?: EventMap; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    api<EventMap>(url, undefined, controller.signal).then(map => {
      if (!controller.signal.aborted) setOutcome({ map })
    }).catch(error => {
      if (!controller.signal.aborted) setOutcome({ error: message(error) })
    })
    return () => controller.abort()
  }, [url, retry])
  if (!outcome) return <Loading>Harita yükleniyor…</Loading>
  if (!outcome.map) return <ErrorBox error={outcome.error ?? 'Harita yüklenemedi.'}
    retry={() => { setOutcome(undefined); setRetry(value => value + 1) }}/>
  return <MapInspection map={outcome.map} {...props}/>
}

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; edge: MapEdge }
type MapInspectionProps = Omit<MapResultProps, 'url'> & { map: EventMap }

function MapInspection({ map, view, experimentId, filters, camera, setCamera, onFocus, alerts, retainedIds }: MapInspectionProps) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const { request, open, clear } = useRawEvidence(experimentId, view)
  const details = useRef<HTMLElement>(null)
  const rawTrigger = useRef<HTMLElement | SVGElement | null>(null)
  const detailsTrigger = useRef<HTMLElement | SVGElement | null>(null)
  const nodes = useMemo(() => new Map(map.nodes.map(node => [node.id, node])), [map.nodes])
  const center = map.nodes.find(node => node.angle === null)
  const selectedNode = selection?.kind === 'node' ? nodes.get(selection.id) : !selection ? center : undefined
  const selectedEdge = selection?.kind === 'edge' ? selection.edge : undefined
  const jumpToDetails = () => {
    const trigger = document.activeElement
    detailsTrigger.current = trigger instanceof HTMLElement || trigger instanceof SVGElement ? trigger : null
    details.current?.scrollIntoView?.({ block: 'nearest' })
    details.current?.focus({ preventScroll: true })
  }
  const selectEdge = (edge: MapEdge, focusDetails = false) => {
    clear()
    setSelection({ kind: 'edge', edge })
    if (focusDetails) jumpToDetails()
  }
  const openRaw = (id: string) => {
    const trigger = document.activeElement
    rawTrigger.current = trigger instanceof HTMLElement || trigger instanceof SVGElement ? trigger : null
    void open(id)
  }
  const selectNode = (node: MapNode, focusDetails = false) => {
    setSelection({ kind: 'node', id: node.id })
    if (node.event_id) openRaw(node.event_id)
    else clear()
    if (focusDetails) jumpToDetails()
  }
  const focusEvent = (id: string) => onFocus({ kind: 'event', id })
  const openFromTable = (id: string) => {
    const node = nodes.get('event:' + id)
    if (node) selectNode(node)
    else {
      setSelection({ kind: 'node', id: 'event:' + id })
      openRaw(id)
    }
    jumpToDetails()
  }

  const noMapTitle = map.status === 'missing' ? view === 'perturbed' ? missingLabel : 'Tam kayıtta görünmüyor'
    : 'Filtreye uyan olay yok'
  return <>
    <div className="map-body">
      {map.status === 'ready' ? <MapCanvas nodes={map.nodes} edges={map.edges} selection={selection} view={view}
        camera={camera} setCamera={setCamera} onNode={selectNode} onEdge={selectEdge}/>
        : <Empty title={noMapTitle} action={map.focus && <button className="button" onClick={() => onFocus(null)}>Otomatik merkez seç</button>}>
          {map.status === 'missing' ? 'Seçili merkez bu kayıt görünümünde bulunmuyor. Kayıt tablosundan başka bir olay seçebilirsiniz.'
            : 'Kaynak, arama veya zaman aralığını değiştirerek kayıtları yeniden inceleyin.'}
        </Empty>}
      <div className="map-sidebar">
        <section ref={details} className="map-inspector" aria-label="Harita ayrıntıları" tabIndex={-1}
          onKeyDown={event => {
            if (event.key === 'Escape') detailsTrigger.current?.focus()
          }}>
          <div className="map-inspector-head"><h3>Seçim ayrıntıları</h3>
            {selection && map.focus && map.status === 'ready' && <button className="event-link" onClick={() => {
              setSelection(null); clear()
            }}>Merkeze dön</button>}
          </div>
          {selectedNode && <NodeDetails node={selectedNode} nodes={nodes} openRaw={openRaw} focusEvent={focusEvent}/>}
          {selectedEdge && <EdgeDetails edge={selectedEdge} nodes={nodes} openRaw={openRaw}/>}
          {!selectedNode && !selectedEdge && !request && <p className="caption">Olay tablosundan bir kayıt seçin.</p>}
          {request?.status === 'loading' && <Loading>Ham kanıt getiriliyor…</Loading>}
          {request?.status === 'error' && <ErrorBox error={request.error} retry={() => void open(request.id)}/>}
          {request?.status === 'ready' && <RawEvidence evidence={request.evidence} close={() => {
            clear()
            rawTrigger.current?.focus()
          }}/>}
        </section>
        <section className="map-records" aria-label="Haritanın olay tablosu">
          <h3>Olay tablosu</h3>
          <EvidenceRecords experimentId={experimentId} view={view} filters={filters} compact
            selectedEvent={selectedNode?.event_id ?? undefined} open={openFromTable} focusMap={focusEvent}/>
        </section>
      </div>
    </div>
    <details className="map-alarm-browser">
      <summary>Deney alarmlarından merkez seç <span>{num(alerts.length)}</span></summary>
      <AlertTable alerts={alerts} retainedIds={retainedIds} open={openFromTable} focusMap={id => onFocus({ kind: 'alert', id })} searchable/>
    </details>
    {!!map.edges.length && <MapRelations edges={map.edges} nodes={nodes} onSelect={edge => selectEdge(edge, true)}/>}
  </>
}

function NodeDetails({ node, nodes, openRaw, focusEvent }: {
  node: MapNode
  nodes: Map<string, MapNode>
  openRaw: (id: string) => void
  focusEvent: (id: string) => void
}) {
  return <>
    <p className="map-inspector-type">{kindLabels[node.kind]}</p>
    <h4>{node.label}</h4>
    <div className="map-badges">
      <span className={'map-risk ' + node.risk}>{riskLabels[node.risk]}</span>
      {node.missing && <span className="map-absent">{missingLabel}</span>}
    </div>
    {node.message && <p className="map-inspector-note">{node.message}</p>}
    <dl className="map-details">
      <div><dt>{node.kind === 'event' ? 'Olay zamanı' : node.kind === 'alert' ? 'Alarm zamanı' : 'Son dayanak kaydı'}</dt><dd>{date(node.time)}</dd></div>
      <div><dt>Kaynak</dt><dd>{node.sources.map(source => sourceNames[source]).join(', ') || 'Bilinmiyor'}</dd></div>
      {node.event_id && <div><dt>Olay kimliği</dt><dd><code>{node.event_id}</code></dd></div>}
    </dl>
    {node.event_id ? <div className="button-row map-detail-actions">
      <button className="button small" onClick={() => openRaw(node.event_id!)}>Ham kaydı aç</button>
      {node.angle !== null && <button className="button small quiet" onClick={() => focusEvent(node.event_id!)}><Orbit size={14}/>Merkeze al</button>}
    </div> : <RecordLinks ids={node.evidence_ids} nodes={nodes} openRaw={openRaw}/>}
  </>
}

function EdgeDetails({ edge, nodes, openRaw }: {
  edge: MapEdge
  nodes: Map<string, MapNode>
  openRaw: (id: string) => void
}) {
  return <>
    <p className="map-inspector-type">Bağlantı</p>
    <h4>{relationLabels[edge.relation]}</h4>
    {edge.missing && <span className="map-absent">{missingLabel}</span>}
    <p className="map-edge-endpoints">{nodes.get(edge.source)?.label} <span aria-hidden="true">↔</span> {nodes.get(edge.target)?.label}</p>
    <p className="map-inspector-note">{relationNotes[edge.relation]}
      {edge.distance_seconds !== null && <> Zaman farkı <strong>{num(edge.distance_seconds)} sn</strong>.</>}
    </p>
    <RecordLinks ids={edge.evidence_ids} nodes={nodes} openRaw={openRaw}/>
  </>
}

function RecordLinks({ ids, nodes, openRaw }: { ids: string[]; nodes: Map<string, MapNode>; openRaw: (id: string) => void }) {
  if (!ids.length) return null
  return <div className="map-record-links">
    <h5>Dayanak kayıtlar <span>{num(ids.length)}</span></h5>
    <ul>{ids.map(id => {
      const record = nodes.get('event:' + id)
      const source = record?.sources[0]
      return <li key={id}><button className="event-link" aria-label={id + ' ham kaydını aç'}
        title={record ? date(record.time) : undefined} onClick={() => openRaw(id)}>{id.slice(0, 12)}</button>
        {source && <span>{sourceNames[source]}</span>}</li>
    })}</ul>
  </div>
}

function MapRelations({ edges, nodes, onSelect }: {
  edges: MapEdge[]
  nodes: Map<string, MapNode>
  onSelect: (edge: MapEdge) => void
}) {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const label = (id: string) => nodes.get(id)?.label ?? id
  const search = query.trim().toLocaleLowerCase('tr')
  const visible = edges.filter(edge => [
    label(edge.source), label(edge.target), relationLabels[edge.relation], ...edge.evidence_ids,
    edge.missing ? missingLabel : '',
  ].some(value => value.toLocaleLowerCase('tr').includes(search)))
  const pageSize = 10
  return <section className="map-relations">
    <header>
      <h3>Haritadaki ilişkiler</h3>
      <div className="field"><label htmlFor="map-relation-search">İlişkilerde ara</label>
        <input id="map-relation-search" value={query} onChange={event => { setQuery(event.target.value); setOffset(0) }}
          placeholder="Tür, düğüm veya olay kimliği" maxLength={200}/>
      </div>
    </header>
    <div className="table-wrap"><table aria-label="Haritadaki ilişkiler">
      <thead><tr><th scope="col">Başlangıç</th><th scope="col">İlişki</th><th scope="col">Hedef</th><th scope="col">Dayanak</th></tr></thead>
      <tbody>{visible.slice(offset, offset + pageSize).map(edge => <tr key={edgeKey(edge)}>
        <td>{label(edge.source)}</td>
        <td><button className="event-link" onClick={() => onSelect(edge)}>{relationLabels[edge.relation]}</button>
          {edge.missing && <small className="map-relation-missing">{missingLabel}</small>}</td>
        <td>{label(edge.target)}</td><td>{num(edge.evidence_ids.length)} kayıt</td>
      </tr>)}
      {!visible.length && <tr><td colSpan={4}>Aramaya uyan bağlantı yok.</td></tr>}</tbody>
    </table></div>
    <Pagination offset={offset} total={visible.length} setOffset={setOffset} pageSize={pageSize}/>
  </section>
}

type MapCanvasProps = CameraProps & {
  nodes: MapNode[]
  edges: MapEdge[]
  selection: Selection | null
  view: EvidenceView
  onNode: (node: MapNode, focusDetails?: boolean) => void
  onEdge: (edge: MapEdge, focusDetails?: boolean) => void
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  action()
}

function MapCanvas({ nodes, edges, selection, view, camera, setCamera, onNode, onEdge }: MapCanvasProps) {
  const [dragging, setDragging] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [meshReady, setMeshReady] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const { apply, enqueue, stop } = useMapCameraMotion(camera, setCamera)
  const drag = useRef<{ pointer: number; clientX: number; clientY: number; start: Camera; pan: boolean } | null>(null)
  const { mode, yaw, pitch } = camera
  const perspective = mode === 'scene'
  const project = useMemo(() => makeProjection(mode, yaw, pitch), [mode, yaw, pitch])
  const solid = perspective && meshReady
  const positioned = useMemo(() => new Map(nodes.map(node => {
    const world = nodePosition(node)
    return [node.id, { ...project(world), world, ground: project([world[0], world[1], floor + 7]) }]
  })), [nodes, project])
  const active = useMemo(() => {
    const highlighted = edges.filter(edge => selection?.kind === 'node'
      ? edge.source === selection.id || edge.target === selection.id
      : selection?.kind === 'edge' ? edgeKey(edge) === edgeKey(selection.edge)
        : edge.relation === 'alarm_evidence')
    const links = new Set(highlighted.map(edgeKey))
    const neighbors = new Set(highlighted.flatMap(edge => [edge.source, edge.target]))
    if (selection?.kind === 'node') neighbors.add(selection.id)
    return { links, neighbors }
  }, [edges, selection])
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY || event.ctrlKey || event.metaKey) return
      const box = element.getBoundingClientRect()
      if (!box.width || !box.height) return
      event.preventDefault()
      const x = (event.clientX - box.left) * width / box.width
      const y = (event.clientY - box.top) * height / box.height
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1
      const factor = Math.exp(-event.deltaY * units * .0018)
      enqueue(current => zoomCamera(current, current.zoom * factor, x, y))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [enqueue])
  const zoomBy = (step: number) => apply(current => zoomCamera(current, Math.round((current.zoom + step) * 100) / 100))
  const reset = () => { apply(current => ({ ...origin, mode: current.mode })); setPanMode(false) }
  const beginDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || drag.current || (event.target as Element).closest('[data-map-target]')) return
    const viewport = event.currentTarget
    viewport.setPointerCapture(event.pointerId)
    drag.current = {
      pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      start: stop(), pan: !perspective || panMode || event.shiftKey,
    }
    setDragging(true)
  }
  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = drag.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    const units = width / event.currentTarget.getBoundingClientRect().width
    const dx = (event.clientX - gesture.clientX) * units
    const dy = (event.clientY - gesture.clientY) * units
    const start = gesture.start
    enqueue(current => gesture.pan ? { ...current, x: start.x + dx, y: start.y + dy }
      : rotateCamera(current, start.yaw + dx * 0.007, start.pitch + dy * 0.004), !gesture.pan)
  }
  const finishDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointer === event.pointerId) {
      drag.current = null
      setDragging(false)
    }
  }
  const mapKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.currentTarget !== event.target) return
    const stepByKey: Record<string, readonly [number, number]> = {
      ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32],
    }
    if (event.key in stepByKey) {
      event.preventDefault()
      const [x, y] = stepByKey[event.key]
      apply(current => perspective && !panMode && !event.shiftKey
        ? rotateCamera(current, current.yaw + x * 0.0045, current.pitch + y * 0.0025)
        : { ...current, x: current.x + x, y: current.y + y })
    } else if (event.key === '+' || event.key === '-') {
      event.preventDefault()
      zoomBy(event.key === '+' ? 0.25 : -0.25)
    } else if (event.key === '0') {
      event.preventDefault()
      reset()
    }
  }

  return <figure className="map-figure">
    <div className="map-viewport" data-perspective={perspective || undefined} data-solid-scene={solid || undefined}>
      <EventMapScene nodes={nodes} camera={camera} onReady={setMeshReady}/>
      <div className="map-view-switch map-dimension-switch" role="group" aria-label="Harita görünümü">
        <button type="button" aria-label="3B görünüm" aria-pressed={perspective}
          onClick={() => apply(current => ({ ...current, mode: 'scene' }))}>3B</button>
        <button type="button" aria-label="Üstten görünüm" aria-pressed={!perspective}
          onClick={() => apply(current => ({ ...current, mode: 'overhead' }))}>Üstten</button>
      </div>
      <div className="map-controls" aria-label="Harita kontrolleri" role="group">
        {perspective && <button type="button" className="icon-button" title="Kaydırma modu"
          aria-label="Kaydırma modu" aria-pressed={panMode} onClick={() => setPanMode(value => !value)}><Move size={17}/></button>}
        <button className="icon-button" title="Uzaklaştır" aria-label="Uzaklaştır" disabled={camera.zoom <= minZoom} onClick={() => zoomBy(-0.25)}><ZoomOut size={17}/></button>
        <output aria-label="Yakınlaştırma düzeyi">{Math.round(camera.zoom * 100)}%</output>
        <button className="icon-button" title="Yakınlaştır" aria-label="Yakınlaştır" disabled={camera.zoom >= maxZoom} onClick={() => zoomBy(0.25)}><ZoomIn size={17}/></button>
        <button className="icon-button" title="Görünümü sıfırla" aria-label="Görünümü sıfırla" onClick={reset}><RotateCcw size={17}/></button>
      </div>
      <svg ref={svg} className={'map-canvas' + (dragging ? ' dragging' : '')} viewBox={`0 0 ${width} ${height}`}
        role="group" tabIndex={0} aria-label="Dairesel olay haritası" aria-describedby="map-controls-help"
        onKeyDown={mapKey} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}
        onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
        <rect className="map-hit-background" width={width} height={height}/>
        <g transform={`translate(${camera.x} ${camera.y}) translate(${cx} ${cy}) scale(${camera.zoom}) translate(${-cx} ${-cy})`}>
          <g className="map-orbits" aria-hidden="true">
            {perspective && !solid && <g className="map-floor">
              <path d={orbitPath(project, outer + 34, floor)} className="map-floor-base"/>
              {[60, inner, outer].map(radius => <path key={radius} d={orbitPath(project, radius, floor)}/>)}
              {Array.from({ length: 12 }, (_, step) => {
                const from = project(polar(step * 30, 60, floor))
                const to = project(polar(step * 30, outer + 34, floor))
                return <line key={step} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>
              })}
            </g>}
            {!solid && <>
              <path d={orbitPath(project, inner, entityLevel)}/>
              <path d={orbitPath(project, outer, 0)}/>
              <path d={orbitPath(project, 47, coreLevel)} className="map-core-orbit"/>
            </>}
            {!solid && sources.map(source => {
              const angle = angles[source]
              const label = project(polar(angle, outer + (perspective ? 80 : 53), 5))
              const labelY = Math.max(20, Math.min(height - 24, label.y))
              return <g className={'map-source ' + source} key={source}>
                <path d={orbitPath(project, outer + 32, 0, angle - 53, angle + 53)}/>
                <text x={label.x} y={labelY} textAnchor="middle">{sourceNames[source]}</text>
              </g>
            })}
          </g>
          {perspective && <g className="map-depth" aria-hidden="true">
            {nodes.map(node => {
              const point = positioned.get(node.id)!
              const tone = node.kind === 'event' && node.sources[0] ? 'map-source ' + node.sources[0] : undefined
              return <g key={node.id} className={tone} data-missing={node.missing || undefined}>
                <line x1={point.ground.x} y1={point.ground.y} x2={point.x} y2={point.y}/>
                <circle cx={point.ground.x} cy={point.ground.y} r={node.angle === null ? 4 : 2}/>
              </g>
            })}
          </g>}
          <g className="map-edges">
            {edges.map(edge => {
              const key = edgeKey(edge)
              const from = positioned.get(edge.source), to = positioned.get(edge.target)
              if (!from || !to) return null
              const [ax, ay, az] = from.world
              const [bx, by, bz] = to.world
              const lift = Math.min(24, Math.hypot(ax - bx, ay - by) * .095)
              const midpoint = project([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2 + lift])
              const bend = perspective ? `Q ${midpoint.x} ${midpoint.y}` : 'L'
              const path = `M ${from.x} ${from.y} ${bend} ${to.x} ${to.y}`
              const activeEdge = active.links.has(key)
              return <g key={key} data-map-target="" role="button" tabIndex={-1}
                aria-label={relationLabels[edge.relation]}
                className="map-edge" data-relation={edge.relation} data-active={activeEdge || undefined}
                data-missing={edge.missing || undefined} data-dim={!!selection && !activeEdge || undefined}
                onClick={() => onEdge(edge)} onKeyDown={event => activate(event, () => onEdge(edge, true))}>
                <title>{relationLabels[edge.relation]}</title>
                <path className="map-edge-stroke" d={path}/>
                <path className="map-edge-hit" d={path}/>
              </g>
            })}
          </g>
          {nodes.map(node => <MapGlyph key={node.id} node={node} point={positioned.get(node.id)!}
            dim={!!selection && !active.neighbors.has(node.id)}
            selected={selection?.kind === 'node' && selection.id === node.id}
            onSelect={focusDetails => onNode(node, focusDetails)}/>)}
        </g>
      </svg>
    </div>
    <figcaption>
      {solid && <div className="map-source-legend" aria-label="Kaynak halkaları">
        {sources.map(source => <span key={source} className={'map-source ' + source}>
          <i aria-hidden="true"/>{sourceNames[source]}
        </span>)}
      </div>}
      <div className="map-legend" aria-label="Harita göstergeleri">
        <span><i className="map-key high"/>Yüksek önem</span>
        <span><i className="map-key medium"/>Orta önem</span>
        <span><i className="map-key unflagged"/>Alarm bağı yok</span>
        <span><i className="map-key possible"/>Olası ilişki</span>
        {view === 'baseline' && <span><i className="map-key absent"/>{missingLabel}</span>}
      </div>
      <p className="caption" id="map-controls-help">
        {perspective && !panMode ? 'Döndürmek için sürükleyin veya ok tuşlarına basın. ' : 'Kaydırmak için sürükleyin veya ok tuşlarına basın. '}
        Tekerlekle yakınlaştırın. Dayanaklar için bir düğüm ya da çizgi seçin.
      </p>
    </figcaption>
  </figure>
}

function MapGlyph({ node, point, dim, selected, onSelect }: {
  node: MapNode
  point: { x: number; y: number; scale: number }
  dim: boolean
  selected: boolean
  onSelect: (focusDetails?: boolean) => void
}) {
  const center = node.angle === null
  const source = node.kind === 'event' ? node.sources[0] : undefined
  const Icon = source ? sourceIcons[source] : node.kind === 'event' ? CircleHelp : entityIcons[node.kind]
  const radius = center ? 34 : node.kind === 'event' ? 15 : 19
  const size = center ? 31 : node.kind === 'event' ? 15 : 18
  const type = source ? sourceNames[source] : kindLabels[node.kind]
  const label = [type, node.label, node.event_id?.slice(0, 12), riskLabels[node.risk], node.missing && missingLabel]
    .filter(Boolean).join(' · ')
  const showLabel = node.kind !== 'event' || selected
  const shortLabel = node.label.length > 15 ? node.label.slice(0, 13) + '…' : node.label
  const captionWidth = Math.max(shortLabel.length * 9, type.length * 6.4) + 22
  return <g className={'map-node' + (source ? ' map-source ' + source : '')}
    transform={`translate(${point.x} ${point.y}) scale(${point.scale})`}
    role="button" tabIndex={0} aria-label={label} aria-pressed={selected} data-map-target="" data-node-id={node.id}
    data-center={center || undefined} data-kind={node.kind} data-risk={node.risk}
    data-missing={node.missing || undefined} data-dim={dim || undefined} onClick={() => onSelect()}
    onKeyDown={event => activate(event, () => onSelect(true))}>
    <title>{label}</title>
    <circle r={radius + 6} className="map-node-focus"/>
    <circle r={radius} className="map-node-disc"/>
    <Icon className="map-node-icon" size={size} x={-size / 2} y={-size / 2} aria-hidden="true"/>
    {node.risk !== 'unflagged' && <g className="map-node-risk" aria-hidden="true">
      <circle cx={radius * 0.68} cy={-radius * 0.68} r={6.8}/>
      <text x={radius * 0.68} y={-radius * 0.68 + 2.8} textAnchor="middle">{node.risk === 'high' ? 'Y' : 'O'}</text>
    </g>}
    {center ? <g className="map-center-label" aria-hidden="true">
      <path d="M 0,-37 V -47"/>
      <rect x={-captionWidth / 2} y={-82} width={captionWidth} height={35} rx={5}/>
      <text className="map-node-label" textAnchor="middle" y={-66}>{shortLabel}</text>
      <text className="map-center-type" textAnchor="middle" y={-53}>{type}</text>
    </g> : showLabel && <text className="map-node-label" textAnchor="middle" y={radius + 15}>{shortLabel}</text>}
  </g>
}
