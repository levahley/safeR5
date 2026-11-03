import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, Clock3, GitBranch, List, Search, X } from 'lucide-react'
import { api, message } from './api'
import { Empty, ErrorBox, Loading, Notice, PageHead } from './shared'
import { date, num, sourceNames, sources } from './domain'
import type { Alert, Event, Evidence, Experiment, Graph } from './types'

type Tab = 'events'|'timeline'|'graph'|'alerts'
const tabs=[{id:'events',label:'Olaylar',icon:List},{id:'timeline',label:'Zaman çizgisi',icon:Clock3},{id:'graph',label:'İlişki grafiği',icon:GitBranch},{id:'alerts',label:'Alarmlar',icon:Activity}] as const
const limit=25

export default function EvidenceWorkspace({experiment}:{experiment:Experiment}) {
  const [tab,setTab]=useState<Tab>('events')
  const [source,setSource]=useState(''),[query,setQuery]=useState(''),[draft,setDraft]=useState('')
  const [offset,setOffset]=useState(0)
  const [result,setResult]=useState<{items:Event[];total:number}|null>(null)
  const [loading,setLoading]=useState(true),[error,setError]=useState('')
  const [evidence,setEvidence]=useState<Evidence|null>(null),[evidenceLoading,setEvidenceLoading]=useState(false)
  const [retry,setRetry]=useState(0)
  const evidenceRequest=useRef(0)
  const evidencePanel=useRef<HTMLElement>(null)
  const evidenceTrigger=useRef<HTMLElement|SVGElement|null>(null)
  useEffect(()=>{if(evidence){evidencePanel.current?.scrollIntoView?.({block:'start'});evidencePanel.current?.focus({preventScroll:true})}},[evidence])
  useEffect(()=>{
    const controller=new AbortController()
    const load=async()=>{
      setLoading(true);setError('')
      const filter=(source?'&source='+encodeURIComponent(source):'')+(query?'&q='+encodeURIComponent(query):'')
      try{const data=await api<{items:Event[];total:number}>('/experiments/'+encodeURIComponent(experiment.id)+'/events?offset='+offset+'&limit='+limit+filter,undefined,controller.signal);setResult(data)}
      catch(e){if(!controller.signal.aborted)setError(message(e))}
      finally{if(!controller.signal.aborted)setLoading(false)}
    }
    void load()
    return ()=>controller.abort()
  },[experiment.id,offset,source,query,retry])
  const openEvidence=async(id:string)=>{
    evidenceTrigger.current=(document.activeElement instanceof HTMLElement||document.activeElement instanceof SVGElement)?document.activeElement:null
    const request=++evidenceRequest.current
    setEvidence(null);setEvidenceLoading(true);setError('')
    try{const data=await api<Evidence>('/experiments/'+encodeURIComponent(experiment.id)+'/evidence?event_id='+encodeURIComponent(id));if(request===evidenceRequest.current)setEvidence(data)}
    catch(e){if(request===evidenceRequest.current)setError(message(e))}
    finally{if(request===evidenceRequest.current)setEvidenceLoading(false)}
  }
  return <><PageHead title="Her iddianın arkasındaki olay.">Yalnızca kayıptan sonra korunan test olayları gösterilir. Ham satır, dosya kimliği ve özet değeriyle izlenebilir.</PageHead><div className="stack"><Notice>İlişkiler gözlenen kanıtlarla desteklenir; nedensellik iddiası değildir. Aynı IP veya işlem numarası tek başına ilişki kurmak için yeterli değildir.</Notice>
    <section className="panel"><div className="tabs" role="tablist" aria-label="Kanıt görünümleri">{tabs.map(({id,label,icon:Icon})=><button id={'tab-'+id} aria-controls={'panel-'+id} key={id} className="tab" role="tab" aria-selected={tab===id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const index=tabs.findIndex(x=>x.id===id);const next=tabs[(index+(e.key==='ArrowRight'?1:3))%4];setTab(next.id);document.getElementById('tab-'+next.id)?.focus()}}}><Icon size={15}/>{label}</button>)}</div>
      {error&&<ErrorBox error={error} retry={()=>setRetry(x=>x+1)}/>}
      <div role="tabpanel" id={'panel-'+tab} aria-labelledby={'tab-'+tab}>
      {(tab==='events'||tab==='timeline')&&<><form className="evidence-filter" onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(draft.trim())}}><div className="field"><label htmlFor="evidence-source">Kaynak</label><select id="evidence-source" value={source} onChange={e=>{setSource(e.target.value);setOffset(0)}}><option value="">Tüm kaynaklar</option>{sources.map(x=><option key={x} value={x}>{sourceNames[x]}</option>)}</select></div><div className="field"><label htmlFor="event-search">Olaylarda ara</label><input id="event-search" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Olay, varlık veya içerik…"/></div><button className="button"><Search size={15}/>Ara</button></form>
        {loading?<Loading/>:result?.items.length?tab==='events'?<EventTable events={result.items} open={openEvidence}/>:<ol className="timeline" aria-label="Gözlenen olay zaman çizgisi">{result.items.map(event=><li key={event.event_id}><time dateTime={event.event_time}>{date(event.event_time)}</time><p><span className="tag">{event.source_type}</span> {event.action??event.event_type} · {event.host_id??'Bilinmeyen makine'} · {event.result??'Sonuç bilinmiyor'} <button className="event-link" onClick={()=>void openEvidence(event.event_id)} aria-label={event.event_id+' kanıtını aç'}>{event.event_id.slice(0,12)}</button></p></li>)}</ol>:!error&&<Empty title="Gözlenen olay yok">Filtreyi değiştirin veya kayıp yapılandırmasını inceleyin. Kayıp olaylar kanıt görünümüne geri eklenmez.</Empty>}
        {result&&<Pagination offset={offset} total={result.total} setOffset={setOffset} disabled={loading}/>}
      </>}
      {tab==='graph'&&<GraphView graph={experiment.perturbed.graph} open={openEvidence}/>}
      {tab==='alerts'&&<AlertView alerts={experiment.perturbed.alerts} open={openEvidence}/>}
      </div>
      {evidenceLoading&&<Loading>Ham kanıt getiriliyor…</Loading>}
      {evidence&&<section className="evidence-detail" aria-label="Ham kanıt" ref={evidencePanel} tabIndex={-1}><div className="detail-top"><h3>Ham olay · <code>{evidence.event.event_id}</code></h3><button className="icon-button" aria-label="Kanıtı kapat" onClick={()=>{evidenceRequest.current++;setEvidence(null);evidenceTrigger.current?.focus()}}><X size={17}/></button></div><dl className="detail-grid"><div><dt>Kaynak</dt><dd>{sourceNames[evidence.event.source_type]}</dd></div><div><dt>Olay zamanı</dt><dd>{date(evidence.event.event_time)}</dd></div><div><dt>Gözlenme zamanı</dt><dd>{date(evidence.event.observed_time)}</dd></div><div><dt>Dosya kimliği</dt><dd><code>{evidence.reference.file_id}</code></dd></div><div><dt>Satır</dt><dd>{evidence.reference.line}</dd></div><div><dt>Ayrıştırıcı / şema</dt><dd>{evidence.event.parser_version} / {evidence.event.schema_version}</dd></div></dl><p className="caption">SHA-256: <code>{evidence.reference.sha256}</code></p><pre aria-label="Ham satır">{evidence.raw}</pre><details className="details-plain"><summary>Normalleştirilmiş olay alanları</summary><pre>{JSON.stringify(evidence.event,null,2)}</pre></details></section>}
    </section>
  </div></>
}

function EventTable({events,open}:{events:Event[];open:(id:string)=>Promise<void>}) {
  return <div className="table-wrap"><table aria-label="Gözlenen olaylar"><thead><tr><th scope="col">Olay zamanı (UTC)</th><th scope="col">Kaynak</th><th scope="col">Makine / kullanıcı</th><th scope="col">Eylem</th><th scope="col">Sonuç</th><th scope="col">Kanıt</th></tr></thead><tbody>{events.map(event=><tr key={event.event_id}><td style={{whiteSpace:'nowrap'}}>{date(event.event_time)}</td><td><span className="tag">{event.source_type}</span></td><td>{event.host_id??'Bilinmiyor'}<br/><span className="muted">{event.user_id??'Bilinmiyor'}</span></td><td>{event.action??event.event_type}</td><td>{event.result??'Bilinmiyor'}</td><td><button className="event-link" aria-label={event.event_id+' kanıtını aç'} onClick={()=>void open(event.event_id)}>{event.event_id.slice(0,12)}</button></td></tr>)}</tbody></table></div>
}
function Pagination({offset,total,setOffset,disabled=false}:{offset:number;total:number;setOffset:(n:number)=>void;disabled?:boolean}) {return <div className="pagination"><span>{total?num(offset+1)+'–'+num(Math.min(offset+limit,total)):'0'} / {num(total)} kayıt</span><div className="button-row"><button className="button small quiet" disabled={disabled||offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}><ChevronLeft size={13}/>Önceki</button><button className="button small quiet" disabled={disabled||offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Sonraki<ChevronRight size={13}/></button></div></div>}
function GraphView({graph,open}:{graph:Graph;open:(id:string)=>Promise<void>}) {
  const [offset,setOffset]=useState(0)
  const nodes=graph.nodes.slice(0,36)
  const positions=new Map(nodes.map((node,index)=>[node.id,{x:55+(index%6)*112,y:42+Math.floor(index/6)*47}]))
  const labels=new Map(graph.nodes.map(node=>[node.id,node.label]))
  if(!graph.nodes.length)return <Empty title="Gözlenen ilişki yok">Bu sonuçta kanıtla desteklenen ilişki bulunmuyor.</Empty>
  return <><p className="caption">Grafik ilk {nodes.length} düğümü gösterir; tüm {num(graph.edges.length)} ilişki aşağıdaki erişilebilir tabloda sayfalanır. Olay düğümleri tıklama, Enter veya boşluk tuşuyla ham kanıtı açar.</p><svg className="graph-svg" viewBox="0 0 680 320" role="group" aria-label="Gözlenen olay ve varlık ilişkileri"><title>Gözlenen olay ve varlık ilişkileri</title>{graph.edges.filter(edge=>positions.has(edge.source)&&positions.has(edge.target)).map((edge,index)=><line key={index} x1={positions.get(edge.source)!.x} y1={positions.get(edge.source)!.y} x2={positions.get(edge.target)!.x} y2={positions.get(edge.target)!.y}/>)}{nodes.map(node=>{const p=positions.get(node.id)!;return <g key={node.id} className={node.kind==='event'?'graph-node':undefined} role={node.kind==='event'?'button':undefined} tabIndex={node.kind==='event'?0:undefined} aria-label={node.kind==='event'?node.label+' olayının kanıtını aç':undefined} onClick={node.kind==='event'?()=>void open(node.id):undefined} onKeyDown={node.kind==='event'?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void open(node.id)}}:undefined}>{node.kind==='event'&&<><circle className="graph-hit-area" cx={p.x} cy={p.y} r={18}/><circle className="graph-focus-ring" cx={p.x} cy={p.y} r={13}/></>}<circle className={'graph-'+node.kind} cx={p.x} cy={p.y} r={7}/><text x={p.x} y={p.y+19} textAnchor="middle">{node.label.length>15?node.label.slice(0,13)+'…':node.label}</text></g>})}</svg><div className="graph-legend"><span><i/>Olay</span><span><i/>Makine</span><span><i/>Kullanıcı</span><span><i/>Oturum</span></div><div className="table-wrap"><table aria-label="Kanıta dayalı ilişkiler"><thead><tr><th scope="col">Başlangıç</th><th scope="col">İlişki</th><th scope="col">Hedef</th><th scope="col">Belirsizlik</th><th scope="col">Gözlenen kanıt</th></tr></thead><tbody>{graph.edges.slice(offset,offset+limit).map((edge,index)=><tr key={index}><td>{labels.get(edge.source)??edge.source}</td><td>{edge.relation}</td><td>{labels.get(edge.target)??edge.target}</td><td>{edge.uncertainty||'Belirtilmedi'}</td><td>{edge.evidence_ids.length?<details><summary>{edge.evidence_ids.length} kanıt</summary>{edge.evidence_ids.map(id=><p key={id} style={{margin:'8px 0'}}><button className="event-link" aria-label={id+' kanıtını aç'} onClick={()=>void open(id)}>{id.slice(0,12)}</button></p>)}</details>:'Kanıt yok'}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={graph.edges.length} setOffset={setOffset}/></>
}
function AlertView({alerts,open}:{alerts:Alert[];open:(id:string)=>Promise<void>}) {
  const [offset,setOffset]=useState(0)
  if(!alerts.length)return <Empty title="Bu sonuçta alarm yok">Alarm olmaması saldırı bulunmadığını kanıtlamaz. Kaynak görünürlüğünü ve değerlendirme metriklerini birlikte inceleyin.</Empty>
  return <><p className="caption">Anomali skoru kalibre edilmemiştir; saldırı olasılığı değildir. Her alarm gözlenen olay kimliklerine bağlanır.</p><div className="table-wrap"><table aria-label="Gözlenen alarmlar"><thead><tr><th scope="col">Zaman</th><th scope="col">Yöntem</th><th scope="col">Alarm</th><th scope="col">Önem</th><th scope="col">Anomali skoru</th><th scope="col">Kanıt</th></tr></thead><tbody>{alerts.slice(offset,offset+limit).map(alert=><tr key={alert.id}><td>{date(alert.event_time)}</td><td>{alert.method==='rules'?'Kural':'Isolation Forest'}</td><td>{alert.message}<br/><code className="muted">{alert.rule_id}</code></td><td><span className={'tag '+(alert.severity==='high'?'red':'amber')}>{alert.severity==='high'?'Yüksek':'Orta'}</span></td><td>{alert.score===null?'—':num(alert.score)}</td><td>{alert.evidence_ids.map(id=><p key={id} style={{margin:'5px 0'}}><button className="event-link" aria-label={id+' kanıtını aç'} onClick={()=>void open(id)}>{id.slice(0,12)}</button></p>)}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={alerts.length} setOffset={setOffset}/></>
}
