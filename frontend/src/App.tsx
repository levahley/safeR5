import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, ArrowRightLeft, Check, ChevronRight, Database, FileText, Fingerprint, FlaskConical, LayoutDashboard, LoaderCircle, Play, Radar, RefreshCw, ShieldCheck, SlidersHorizontal, Square, X } from 'lucide-react'
import { api, message } from './api'
import { Empty, ErrorBox, Loading, Notice, PageHead } from './shared'
import { date, defaultConfig, lossNames, num } from './domain'
import type { Experiment, Job, Overview, RunConfig } from './types'
import EvidenceWorkspace from './Evidence'
import { Comparison, ExperimentForm, Laboratory, OptimizationWorkspace, Reports } from './Workspaces'

type View = 'overview'|'lab'|'experiment'|'comparison'|'evidence'|'optimization'|'reports'
const navigation = [
  {id:'overview',label:'Genel bakış',icon:LayoutDashboard},
  {id:'lab',label:'Veri laboratuvarı',icon:Database},
  {id:'experiment',label:'Deney tasarımı',icon:FlaskConical},
  {id:'comparison',label:'Karşılaştırma',icon:ArrowRightLeft},
  {id:'evidence',label:'Kanıt inceleme',icon:Fingerprint},
  {id:'optimization',label:'Kaynak optimizasyonu',icon:SlidersHorizontal},
  {id:'reports',label:'Raporlar ve ayarlar',icon:FileText},
] as const
const statuses:Record<Job['status'],string> = {queued:'Sırada',running:'Çalışıyor',succeeded:'Tamamlandı',failed:'Başarısız',cancelled:'İptal edildi',interrupted:'Yarıda kesildi'}
const isActive = (job:Job|null) => job?.status==='queued'||job?.status==='running'
function savedExperiment() {try{return localStorage.getItem('safer5.experiment')}catch{return null}}

export default function App() {
  const [view,setView] = useState<View>('overview')
  const navigate=(next:View)=>{
    setView(next)
    ;(document.scrollingElement??document.documentElement).scrollTo({top:0,left:0,behavior:'instant'})
    queueMicrotask(()=>document.getElementById('main')?.focus({preventScroll:true}))
  }
  const [overview,setOverview] = useState<Overview|null>(null)
  const [experiment,setExperiment] = useState<Experiment|null>(null)
  const [job,setJob] = useState<Job|null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [submitting,setSubmitting] = useState(false)
  const [resultLoading,setResultLoading] = useState(false)
  const [connected,setConnected] = useState(false)
  const resultRequest=useRef(0)
  const loadExperiment = useCallback(async(id:string) => {
    const request=++resultRequest.current
    setResultLoading(true)
    setExperiment(null)
    try {
      const result = await api<Experiment>('/experiments/'+encodeURIComponent(id))
      if(request!==resultRequest.current)return
      setExperiment(result)
      try{localStorage.setItem('safer5.experiment',id)}catch{/* Browser storage can be disabled. */}
    } catch(e) {if(request===resultRequest.current)setError(message(e))}
    finally {if(request===resultRequest.current)setResultLoading(false)}
  },[])
  const loadOverview = useCallback(async() => {
    setLoading(true);setError('')
    try{
      const data = await api<Overview>('/overview')
      setOverview(data);setConnected(true)
      setJob(previous=>previous ?? data.jobs.find(j=>isActive(j)) ?? data.jobs.find(j=>j.status==='failed'||j.status==='interrupted') ?? null)
    }catch(e){setError(message(e));setConnected(false)}
    finally{setLoading(false)}
  },[])
  // Persisted state is external; mount initiates network requests rather than deriving state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{void loadOverview();const saved=savedExperiment();if(saved)void loadExperiment(saved)},[loadOverview,loadExperiment])
  const jobId=job?.id,jobStatus=job?.status
  useEffect(()=>{
    if(!jobId||(jobStatus!=='queued'&&jobStatus!=='running'))return
    let stopped=false
    let timer:ReturnType<typeof setTimeout>
    const poll=async()=>{
      try{
        const next=await api<Job>('/jobs/'+encodeURIComponent(jobId))
        if(stopped)return
        setJob(next);setConnected(true)
        if(next.status==='succeeded') {
          if(next.kind==='experiment'&&next.result_id)await loadExperiment(next.result_id)
          await loadOverview()
        }
      }catch(e){if(!stopped){setError(message(e));setConnected(false)}}
      if(!stopped)timer=setTimeout(poll,1200)
    }
    void poll()
    return ()=>{stopped=true;clearTimeout(timer)}
  },[jobId,jobStatus,loadOverview,loadExperiment])
  const run = async(config:RunConfig) => {
    if(submitting||isActive(job))return
    setSubmitting(true);setError('')
    try{setJob(await api<Job>('/experiments',config));setConnected(true)}catch(e){setError(message(e))}finally{setSubmitting(false)}
  }
  const generate = async(seed:number,count:number) => {
    setSubmitting(true);setError('')
    try{setJob(await api<Job>('/lab/generate',{profile:'demo',seed,n_events:count,include_attacks:true}))}catch(e){setError(message(e))}finally{setSubmitting(false)}
  }
  const cancel = async() => {if(!job)return;try{setJob(await api<Job>('/jobs/'+encodeURIComponent(job.id)+'/cancel',{}))}catch(e){setError(message(e))}}
  const busy=submitting||isActive(job)
  const demoButton=<button className="button primary" disabled={busy} onClick={()=>void run(defaultConfig)}>{busy?<LoaderCircle size={16} className="spin"/>:<Play size={16}/>}Demo deneyi başlat</button>
  const needExperiment=<Empty title="Önce bir deney seçin" action={demoButton}>Sonuçları açmak için genel bakıştan tamamlanmış bir deney seçin veya demo başlatın.</Empty>
  return <div className="app">
    <a href="#main" className="skip-link">İçeriğe geç</a>
    <aside className="sidebar"><div className="brand"><ShieldCheck className="brand-icon" strokeWidth={1.5}/><span>safeR<span>5</span></span></div><nav aria-label="Çalışma alanları">{navigation.map(({id,label,icon:Icon},index)=><div key={id} style={{display:'contents'}}>{index===3&&<div className="nav-section">Araştırma ve sonuçlar</div>}<button className={'nav-button'+(view===id?' active':'')} onClick={()=>navigate(id)} aria-current={view===id?'page':undefined}><Icon size={18} strokeWidth={1.6}/>{label}</button></div>)}</nav><div className="sidebar-foot"><strong><span className="local-dot"/>Yerel araştırma ortamı</strong>Veriniz bu cihazda kalır.<br/>Tekrarlanabilir deneyler.<br/>İzlenebilir kanıtlar.</div></aside>
    <div className="shell"><div className="topbar"><div className="breadcrumbs"><span>Çalışma alanı</span><ChevronRight size={13}/><strong>{navigation.find(x=>x.id===view)?.label}</strong></div><div className="topbar-status"><span className="local-dot" style={{background:connected?'var(--accent)':'var(--warning)'}}/>{connected?'Yerel sunucu bağlı':'Bağlantı bekleniyor'}</div></div>
      <main id="main" tabIndex={-1}>
        {error&&<ErrorBox error={error} retry={()=>void loadOverview()}/>}
        {job&&<section className="job-panel" aria-label="İş durumu" aria-live="polite"><div className="job-top">{isActive(job)?<LoaderCircle size={18} className="spin"/>:job.status==='succeeded'?<Check size={18}/>:<Square size={16}/>}<div><strong>{statuses[job.status]}</strong><p>{job.stage!==statuses[job.status]?job.stage:''}{job.error?' · '+job.error:''}</p></div>{isActive(job)?<><span className="caption">%{num(job.progress)}</span><button className="button small danger" onClick={()=>void cancel()}><X size={14}/>İşi iptal et</button></>:<>{job.status==='succeeded'&&job.kind==='experiment'&&experiment?.id===job.result_id&&<button className="button small" onClick={()=>navigate('comparison')}>Sonucu aç</button>}<button className="icon-button" onClick={()=>setJob(null)} aria-label="İş bildirimini kapat"><X size={16}/></button></>}</div>{isActive(job)&&<progress max={100} value={job.progress} aria-label="İş ilerlemesi"/>}{(job.status==='failed'||job.status==='interrupted')&&<p className="caption" style={{margin:'12px 0 0'}}>Sonuç kaydedilmedi. Ayarları kontrol edip yeni bir deney başlatabilirsiniz.</p>}</section>}
        {resultLoading&&<Loading>Deney sonucu açılıyor…</Loading>}
        {experiment&&!resultLoading&&view!=='overview'&&<section className="current-result"><div><h2>{experiment.name}</h2><p>{date(experiment.created_at)} · Tohum {experiment.config.seed} · {lossNames[experiment.loss_kind]??experiment.loss_kind}</p></div><span className="tag teal"><Check size={12}/>Kaydedilmiş sonuç</span></section>}
        {view==='overview'&&<>
          <PageHead title="Kayıp loglar, eksilen kanıtlar." action={demoButton}>Bir kaynak sustuğunda neyi göremediğinizi ölçün. Tam veri ile kayıplı veriyi, aynı dondurulmuş algılayıcı üzerinden karşılaştırın.</PageHead>
          <section className="lab-strip"><div><h2>Görünürlükten tespitteki<br/>etkiye, tek deneyde.</h2><p>Yerel sentetik veri üretin; kaybı uygulayın; bağımsız testteki farkı inceleyin.</p></div><div className="flow" aria-label="Deney akışı"><div className="flow-node"><div className="source-glyph" aria-hidden="true"><span/><span/><span/></div><span>auth / audit / dns</span></div><ArrowRight className="flow-arrow" size={24}/><div className="flow-node"><Radar size={30} strokeWidth={1.4}/><span>Dondurulmuş algılayıcı</span></div><ArrowRight className="flow-arrow" size={24}/><div className="flow-node"><Fingerprint size={30} strokeWidth={1.4}/><span>Gözlenen kanıt</span></div></div></section>
          {loading&&!overview?<Loading/>:overview&&<>
            <div className="summary-strip" aria-label="Çalışma alanı sayıları"><div className="summary-item"><div><strong>{num(overview.stats.datasets)}</strong><span>Veri kümesi</span></div><Database size={23} strokeWidth={1.4}/></div><div className="summary-item"><div><strong>{num(overview.stats.experiments)}</strong><span>Tamamlanan deney</span></div><FlaskConical size={23} strokeWidth={1.4}/></div><div className="summary-item"><div><strong>{num(overview.stats.events)}</strong><span>Kayıtlı olay</span></div><Activity size={23} strokeWidth={1.4}/></div></div>
            {experiment&&<section className="current-result"><div><h2>{experiment.name}</h2><p>{num(experiment.retained_count)} / {num(experiment.event_count)} test olayı korundu · {date(experiment.created_at)}</p></div><button className="button small" onClick={()=>navigate('comparison')}>Sonucu incele<ArrowRight size={14}/></button></section>}
            <div className="grid-two"><section className="panel"><div className="panel-head"><h2>Deney geçmişi</h2><button className="icon-button" aria-label="Geçmişi yenile" onClick={()=>void loadOverview()}><RefreshCw size={16}/></button></div>{overview.experiments.length?<div className="workspace-list">{overview.experiments.map(item=><button key={item.id} className="experiment-item" onClick={()=>{void loadExperiment(item.id);navigate('comparison')}}><FlaskConical size={19}/><div><span className="experiment-name">{item.name}</span><span className="caption">{date(item.created_at)} · {num(item.retained_count)} gözlenen olay</span></div><span className="tag">{lossNames[item.loss_kind]??item.loss_kind}</span></button>)}</div>:<Empty title="Henüz deney yok">Demo, üç kaynağı ve saldırı senaryolarını hazırlar. İlk ölçümünüz için tek tıklama yeterli.</Empty>}</section><div className="stack"><div className="quick-links"><button className="quick-link" onClick={()=>navigate('experiment')}><FlaskConical size={21}/><span><strong>Deneyinizi tasarlayın</strong><small>Kaynak, kayıp ve bütçeyi belirleyin</small></span></button><button className="quick-link" onClick={()=>navigate('lab')}><Database size={21}/><span><strong>Veriyi tanıyın</strong><small>Sentetik üretim veya JSONL içe aktarma</small></span></button><button className="quick-link" onClick={()=>navigate('optimization')}><SlidersHorizontal size={21}/><span><strong>Kaynak bütçesini araştırın</strong><small>Doğrulamada seçin, bağımsız testte ölçün</small></span></button></div><Notice>Demo sentetik bir araştırma ortamıdır. Sonuçlar üretim ortamı güvenlik güvencesi değildir.</Notice></div></div>
            {overview.jobs.length>0&&<section className="panel" style={{marginTop:22}}><h2>Son işler</h2>{overview.jobs.slice(0,6).map(j=><div className="job-history" key={j.id}><span className={'tag '+(j.status==='succeeded'?'teal':j.status==='failed'||j.status==='interrupted'?'red':'')}>{statuses[j.status]}</span><span>{j.stage}</span><span className="caption">{date(j.created_at)}</span></div>)}</section>}
          </>}
        </>}
        {view==='lab'&&<Laboratory datasets={overview?.datasets??[]} busy={busy} generate={generate} refresh={loadOverview}/>}
        {view==='experiment'&&<ExperimentForm datasets={overview?.datasets??[]} busy={busy} run={run}/>}
        {view==='comparison'&&!resultLoading&&(experiment?<Comparison experiment={experiment} inspect={()=>navigate('evidence')}/>:needExperiment)}
        {view==='evidence'&&!resultLoading&&(experiment?<EvidenceWorkspace key={experiment.id} experiment={experiment}/>:<Empty title="Gözlenen olaylardan kanıta">Kanıtları incelemek için bir deney seçin.</Empty>)}
        {view==='optimization'&&!resultLoading&&(experiment?<OptimizationWorkspace experiment={experiment} busy={busy} run={run}/>:needExperiment)}
        {view==='reports'&&!resultLoading&&<Reports experiment={experiment}/>}
        <footer className="page-bottom"><span>safeR5 · Yerel log kaybı araştırma laboratuvarı</span><span>Kanıta dayalı analiz. Tekrarlanabilir sonuç.</span></footer>
      </main>
    </div>
  </div>
}
