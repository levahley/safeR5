import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const metrics = { attack_step_recall: .5, false_positive_rate: .1, evidence_coverage: .4, detection_delay_seconds: 3, steps_detected: 2, steps_total: 4, false_positives: 1, normal_events: 100, false_positive_windows: 1, normal_windows: 10, evidence_flag_rate:.01, alerts_total: 3, status: 'measured' }
const config = { dataset_id: 'd1', name: 'Kontrollü deney', seed: 42, sources: ['auth', 'audit', 'dns'], loss: { kind: 'none', rate: 0, source: null, start: null, end: null }, budget_fraction: .7, max_false_positive_rate: 1 }
const analysis = { event_count: 200, source_counts: {auth: 80, audit: 60, dns: 60}, alerts: [], incidents: [], metrics, method_metrics:{rules:{...metrics,attack_step_recall:.25,false_positive_rate:.2},iforest:metrics}, graph: {nodes: [], edges: []}, source_health: { auth: 'healthy', audit: 'healthy', dns: 'healthy' } }
const experiment = { id: 'e1', name: 'Kontrollü deney', dataset_id: 'd1', created_at: '2026-10-17T00:00:00Z', event_count: 200, retained_count: 200, loss_kind: 'none', status: 'succeeded', config, baseline: analysis, perturbed: analysis, optimization: {budget_bytes: 700, budget_fraction: .7, cost_unit: 'bytes', validation_dataset_hash: 'abc123', recommended_sources: ['auth'], candidates: [{sources:['auth'],cost_bytes:500,recall:.5,false_positive_rate:.01,feasible:true}], comparisons: [{method:'optimized',sources:['auth'],validation_recall:.5,test_recall:.5,cost_bytes:500,within_budget:true}], independent_test: metrics, actual_test_cost_bytes: 500, estimated_cost_bytes: 500, policy: 'validation_only' }, provenance: {seed:42}, performance: {elapsed_seconds:1}, loss_manifest: {lost:0} }
const job = {id:'j1',kind:'experiment',status:'running',stage:'Analiz',progress:30,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',result_id:null,error:null,config}
const event = {event_id:'v1',event_time:'2026-10-17T00:00:00Z',observed_time:'2026-10-17T00:00:01Z',source_type:'auth',host_id:'host-a',user_id:'u1',session_id:null,event_type:'login',action:'login',result:'failed',process_id:null,parent_process_id:null,process_start_time:null,src_ip:null,dst_ip:null,dns_query:null,bytes_out:null,privileged:false,raw_ref:{file_id:'f1',line:1,sha256:'abc'},parser_version:'1',schema_version:'1'}
let requests: {path:string; body:unknown}[]
function serve(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    requests.push({path, body:init?.body ? JSON.parse(String(init.body)):null})
    const defaults:Record<string,unknown> = {
      '/api/v1/overview':{datasets:[],experiments:[],jobs:[],stats:{datasets:0,experiments:0,events:0}},
      '/api/v1/experiments':job,
      '/api/v1/experiments/e1':experiment,
      '/api/v1/jobs/j1':job,
      '/api/v1/jobs/j1/cancel':{...job,status:'cancelled'},
      '/api/v1/experiments/e1/events?offset=0&limit=25':{items:[event],total:1},
      '/api/v1/experiments/e1/evidence?event_id=v1':{event,raw:'<img src=x onerror="alert(1)">',reference:event.raw_ref},
      '/api/v1/settings':{version:'0.1.0',data_directory:'/local/data',limits:{max_import_bytes:1024},dependencies:{},ait:{status:'not_configured',record_url:'https://example.org',note:'Yerel arşiv gerekli'}},
      '/api/v1/models':[],
    }
    const data = path in overrides ? overrides[path] : defaults[path]
    return new Response(JSON.stringify(data ?? {detail:'Bulunamadı'}),{status:data === undefined ? 404:200, headers:{'Content-Type':'application/json'}})
  }))
}
beforeEach(() => { requests=[]; serve() })

describe('safeR5 çalışma alanı', () => {
  it('tek eylemle gerçek demo isteğini gönderir ve iş durumunu gösterir', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button',{name:'Demo deneyi başlat'}))
    await screen.findByRole('button',{name:'İşi iptal et'})
    expect(requests.find(x=>x.path==='/api/v1/experiments')?.body).toEqual({dataset_id:null,name:'Demo deneyi',seed:42,sources:['auth','audit','dns'],loss:{kind:'none',rate:0,source:null,start:null,end:null},budget_fraction:.7,max_false_positive_rate:1})
  })
  it('boş çalışma alanında ölçüm uydurmaz ve kullanıcıyı yönlendirir', async () => {
    render(<App />)
    expect(await screen.findByText('Henüz deney yok')).toBeInTheDocument()
    expect(screen.queryByText('%50,0')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Kanıt inceleme'}))
    expect(screen.getByText('Kanıtları incelemek için bir deney seçin.')).toBeInTheDocument()
  })
  it('bağlantı kesildiğinde hatayı ve yeniden deneme eylemini gösterir', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Yerel sunucuya ulaşılamadı')
    expect(screen.getByRole('button',{name:'Yeniden dene'})).toBeInTheDocument()
  })
  it('zaman aralığı kaybında bitişin başlangıçtan sonra olmasını zorunlu kılar', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button',{name:'Deney tasarımı'}))
    await userEvent.selectOptions(screen.getByLabelText('Kayıp modeli'),'interval')
    await userEvent.type(screen.getByLabelText('Başlangıç (UTC)'),'2026-10-17T10:00')
    await userEvent.type(screen.getByLabelText('Bitiş (UTC)'),'2026-10-17T09:00')
    await userEvent.click(screen.getByRole('button',{name:'Deneyi çalıştır'}))
    expect(screen.getByRole('alert')).toHaveTextContent('Bitiş, başlangıçtan sonra olmalı')
    expect(requests.some(x=>x.path==='/api/v1/experiments')).toBe(false)
  })
  it('kaynak seçimi boşsa deney göndermez', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button',{name:'Deney tasarımı'}))
    for(const name of ['Kimlik doğrulama','Sistem denetimi','DNS']) await userEvent.click(screen.getByRole('checkbox',{name}))
    await userEvent.click(screen.getByRole('button',{name:'Deneyi çalıştır'}))
    expect(screen.getByRole('alert')).toHaveTextContent('En az bir kaynak seçin')
  })
  it('yenilemeden sonra etkin işi geri yükler ve iptal sonucunu gösterir', async () => {
    serve({'/api/v1/overview':{datasets:[],experiments:[],jobs:[job],stats:{datasets:0,experiments:0,events:0}}})
    render(<App />)
    await userEvent.click(await screen.findByRole('button',{name:'İşi iptal et'}))
    expect(await screen.findByText('İptal edildi')).toBeInTheDocument()
    expect(requests.some(x=>x.path==='/api/v1/jobs/j1/cancel')).toBe(true)
  })
  it('tamamlanan işi sorgulayıp deney sonucuna geçer', async () => {
    serve({'/api/v1/overview':{datasets:[],experiments:[],jobs:[job],stats:{datasets:0,experiments:0,events:0}},'/api/v1/jobs/j1':{...job,status:'succeeded',progress:100,result_id:'e1'}})
    render(<App />)
    expect(await screen.findByText('Kontrollü deney',{}, {timeout:3000})).toBeInTheDocument()
    expect(requests.some(x=>x.path==='/api/v1/experiments/e1')).toBe(true)
    await userEvent.click(screen.getByRole('button',{name:'Sonucu aç'}))
    expect(screen.getByRole('table',{name:'Metrik karşılaştırması'})).toBeInTheDocument()
  })
  it('kaydedilen deney için dört gerçek rapor indirme bağlantısı sunar', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Raporlar ve ayarlar'}))
    for(const [label,format] of [['JSON','json'],['CSV','csv'],['Markdown','markdown'],['HTML','html']]) expect(screen.getByRole('link',{name:`${label} indir`})).toHaveAttribute('href',`/api/v1/experiments/e1/report?format=${format}`)
  })
  it('yalnızca gözlenen kanıtı getirir ve ham HTML metnini çalıştırmadan gösterir', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Kanıt inceleme'}))
    await userEvent.click(await screen.findByRole('button',{name:'v1 kanıtını aç'}))
    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    expect(screen.getByRole('region',{name:'Ham kanıt'})).toHaveFocus()
    expect(document.querySelector('img')).toBeNull()
  })
  it('kaynak önerisini ayrı bir deney olarak yeniden çalıştırır', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Kaynak optimizasyonu'}))
    await userEvent.click(screen.getByRole('button',{name:'Önerilen kaynaklarla yeni deney'}))
    await waitFor(()=>expect(requests.find(x=>x.path==='/api/v1/experiments')?.body).toMatchObject({dataset_id:'d1',sources:['auth'],name:'Kontrollü deney · kaynak önerisi'}))
  })
  it('karşılaştırmada gizli saldırı adımlarının paydaya dahil olduğunu açıklar', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    expect(screen.getByText(/Görünmeyen gerçek saldırı adımları da paydaya dahildir/)).toBeInTheDocument()
    expect(within(screen.getByRole('table',{name:'Metrik karşılaştırması'})).getAllByText('%50,0')).toHaveLength(2)
  })
  it('başka bir deney açılırken eski deneyin metriklerini yeni seçim gibi göstermez', async () => {
    localStorage.setItem('safer5.experiment','e1')
    let resolveNew:(response:Response)=>void = ()=>{}
    serve({'/api/v1/overview':{datasets:[],experiments:[{...experiment,id:'e2',name:'İkinci deney'}],jobs:[],stats:{datasets:1,experiments:2,events:200}}})
    const realFetch=globalThis.fetch
    vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/v1/experiments/e2'?new Promise<Response>(resolve=>{resolveNew=resolve}):realFetch(input,init))
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:/İkinci deney/}))
    expect(screen.getByText('Deney sonucu açılıyor…')).toBeInTheDocument()
    expect(screen.queryByRole('table',{name:'Metrik karşılaştırması'})).not.toBeInTheDocument()
    resolveNew(new Response(JSON.stringify({...experiment,id:'e2',name:'İkinci deney'}),{headers:{'Content-Type':'application/json'}}))
    expect(await screen.findByRole('table',{name:'Metrik karşılaştırması'})).toBeInTheDocument()
  })
  it('kaynak sağlığını Türkçe gösterir', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    expect(screen.queryByText('healthy')).not.toBeInTheDocument()
    expect(screen.getAllByText('Veri mevcut')).toHaveLength(3)
  })
  it('bilinmeyen gözlenme zamanından tarih üretmez ve olayın UTC saniyesini korur', async () => {
    localStorage.setItem('safer5.experiment','e1')
    serve({'/api/v1/experiments/e1/evidence?event_id=v1':{event:{...event,observed_time:null},raw:'bir olay',reference:event.raw_ref}})
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Kanıt inceleme'}))
    await userEvent.click(await screen.findByRole('button',{name:'v1 kanıtını aç'}))
    const region=await screen.findByRole('region',{name:'Ham kanıt'})
    expect(within(region).getByText('Bilinmiyor')).toBeInTheDocument()
    expect(within(region).getByText('17 Eki 2026 00:00:00 UTC')).toBeInTheDocument()
  })
  it('yanlış pozitif oranının paydasında olay yerine normal zaman pencerelerini gösterir', async () => {
    localStorage.setItem('safer5.experiment','e1')
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    const table=screen.getByRole('table',{name:'Metrik karşılaştırması'})
    const row=within(table).getByText('Yanlış pozitif / normal pencere').closest('tr')!
    expect(within(row).getAllByText('1 / 10')).toHaveLength(2)
    const flagRow=within(table).getByText('Normal olay işaretleme oranı').closest('tr')!
    expect(within(flagRow).getAllByText('%1,0')).toHaveLength(2)
    expect(screen.getByText(/kaynak, makine ve kullanıcıya göre ayrı beş dakikalık normal pencerelerde/)).toBeInTheDocument()
  })
  it('yeni deney açılamadığında önceki deneyin metriklerini geri getirmez', async () => {
    localStorage.setItem('safer5.experiment','e1')
    serve({'/api/v1/overview':{datasets:[],experiments:[{...experiment,id:'e2',name:'Kayıp sonuç'}],jobs:[],stats:{datasets:1,experiments:2,events:200}}})
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:/Kayıp sonuç/}))
    await screen.findByRole('alert')
    expect(screen.queryByRole('table',{name:'Metrik karşılaştırması'})).not.toBeInTheDocument()
  })
  it('geciken eski yanıtın en son seçilen deneyi değiştirmesine izin vermez', async () => {
    localStorage.setItem('safer5.experiment','e1')
    let resolveOld:(response:Response)=>void=()=>{}
    serve({'/api/v1/overview':{datasets:[],experiments:[{...experiment,id:'e2',name:'Yeni seçim'}],jobs:[],stats:{datasets:1,experiments:2,events:200}},'/api/v1/experiments/e2':{...experiment,id:'e2',name:'Yeni seçim'}})
    const realFetch=globalThis.fetch
    vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/v1/experiments/e1'?new Promise<Response>(resolve=>{resolveOld=resolve}):realFetch(input,init))
    render(<App />)
    await userEvent.click(await screen.findByRole('button',{name:/Yeni seçim/}))
    await screen.findByRole('heading',{name:'Yeni seçim'})
    await act(async()=>{resolveOld(new Response(JSON.stringify(experiment),{headers:{'Content-Type':'application/json'}}))})
    expect(screen.getByRole('heading',{name:'Yeni seçim'})).toBeInTheDocument()
    expect(localStorage.getItem('safer5.experiment')).toBe('e2')
  })
  it('çalışma alanı değiştiğinde başa döner ve klavye odağını içeriğe taşır', async () => {
    render(<App />)
    await screen.findByText('Henüz deney yok')
    document.documentElement.scrollTop=500
    await userEvent.click(screen.getByRole('button',{name:'Deney tasarımı'}))
    expect(document.documentElement.scrollTop).toBe(0)
    expect(screen.getByRole('main')).toHaveFocus()
  })
  it('kurallar ve Isolation Forest için gerçek yöntem ölçümlerini tam ve kayıplı veride ayrı gösterir', async () => {
    localStorage.setItem('safer5.experiment','e1')
    serve({'/api/v1/experiments/e1':{...experiment,perturbed:{...analysis,method_metrics:{rules:{...metrics,attack_step_recall:0,false_positive_rate:.05},iforest:{...metrics,attack_step_recall:.25,false_positive_rate:.15}}}}})
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    expect(screen.getByRole('heading',{name:'Birleşik sonuç (kurallar + IsolationForest)'})).toBeInTheDocument()
    const table=screen.getByRole('table',{name:'Yöntem karşılaştırması'})
    const rows=within(table).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell').map(cell=>cell.textContent))
    expect(rows).toEqual([['Kurallar','Tam veri','%25,0','%20,0'],['Kurallar','Kayıplı veri','%0,0','%5,0'],['Isolation Forest','Tam veri','%50,0','%10,0'],['Isolation Forest','Kayıplı veri','%25,0','%15,0']])
  })
  it('eski kayıtta yöntem ölçümleri yoksa birleşik sonuçtan değer uydurmaz', async () => {
    localStorage.setItem('safer5.experiment','e1')
    const legacyAnalysis={...analysis,method_metrics:undefined}
    serve({'/api/v1/experiments/e1':{...experiment,baseline:legacyAnalysis,perturbed:legacyAnalysis}})
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    const table=screen.getByRole('table',{name:'Yöntem karşılaştırması'})
    expect(within(table).getAllByText('Ölçülmedi')).toHaveLength(8)
    expect(within(table).queryByText('%50,0')).not.toBeInTheDocument()
  })
  it.each(['fare','{Enter}',' '])('grafikte olay düğümünü %s ile açıp gerçek ham kanıtı getirir', async key => {
    localStorage.setItem('safer5.experiment','e1')
    serve({'/api/v1/experiments/e1':{...experiment,perturbed:{...analysis,graph:{nodes:[{id:'v1',label:'Oturum olayı',kind:'event'},{id:'host:h1',label:'host-a',kind:'host'}],edges:[{source:'v1',target:'host:h1',relation:'observed_on',evidence_ids:['v1'],uncertainty:'Gözlenen ilişki'}]}}}})
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await userEvent.click(screen.getByRole('button',{name:'Kanıt inceleme'}))
    await userEvent.click(screen.getByRole('tab',{name:'İlişki grafiği'}))
    const node=screen.getByRole('button',{name:'Oturum olayı olayının kanıtını aç'})
    if(key==='fare')await userEvent.click(node)
    else{node.focus();await userEvent.keyboard(key)}
    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    expect(requests.some(request=>request.path==='/api/v1/experiments/e1/evidence?event_id=v1')).toBe(true)
    expect(screen.getByRole('table',{name:'Kanıta dayalı ilişkiler'})).toBeInTheDocument()
  })
  it('kayıpsız deneyde sayıların neden eşit olduğunu ve kaynakların görünürlüğünü gösterir', async () => {
    localStorage.setItem('safer5.experiment','e1')
    serve({'/api/v1/experiments/e1/event-map':{status:'empty',focus:null,nodes:[],edges:[]}})
    const user=userEvent.setup()
    render(<App />)
    await screen.findByText('Kontrollü deney')
    await user.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    await user.click(screen.getByRole('button',{name:'Olay haritasını aç'}))
    const summary=screen.getByRole('region',{name:'Kayıp özeti'})
    expect(within(summary).getByText(/Bu deney tam kayıtla çalıştırıldı/)).toBeVisible()
    expect(within(summary).getByRole('columnheader',{name:'Tam kayıt'})).toBeVisible()
    expect(within(summary).getByRole('columnheader',{name:'Kayıp sonrası'})).toBeVisible()
    const events=within(summary).getByRole('row',{name:/^Olay /})
    expect(within(events).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['200','200','0'])
    expect(within(summary).getByText('80 / 80 kayıt kaldı')).toBeVisible()
  })
  it('olay haritasında kayıp DNS düğümünü yalnız tam görünümde inceler ve görünüm değişince ham kaydı temizler', async () => {
    localStorage.setItem('safer5.experiment','e1')
    const alert = {id:'a1',method:'rules',rule_id:'auth-burst',message:'Giriş kuralı',severity:'high',evidence_ids:['v1'],host_id:'host-a',user_id:'u1',event_time:event.event_time,score:null}
    const dnsAlert = {...alert,id:'a2',rule_id:'dns-pattern',evidence_ids:['v2']}
    const auth = {id:'event:v1',kind:'event',label:'login',angle:null,lane:0,time:event.event_time,sources:['auth'],risk:'high',event_id:'v1',evidence_ids:['v1'],missing:false,message:null}
    const dns = {...auth,id:'event:v2',label:'dns_query',event_id:'v2',evidence_ids:['v2'],angle:150,sources:['dns'],missing:true}
    const map = {status:'ready',focus:{kind:'event',id:'v1'},nodes:[auth],edges:[]}
    const relation = {source:auth.id,target:dns.id,relation:'time_proximity',evidence_ids:['v1','v2'],distance_seconds:8,missing:true}
    serve({
      '/api/v1/experiments/e1':{...experiment,event_count:3,retained_count:2,loss_kind:'source',config:{...config,loss:{...config.loss,kind:'source',source:'dns'}},baseline:{...analysis,event_count:3,source_counts:{auth:1,audit:1,dns:1},alerts:[alert,dnsAlert],metrics:{...metrics,alerts_total:2}},perturbed:{...analysis,event_count:2,source_counts:{auth:1,audit:1,dns:0},alerts:[alert],metrics:{...metrics,alerts_total:1}}},
      '/api/v1/experiments/e1/event-map':map,
      '/api/v1/experiments/e1/event-map?view=baseline':{...map,nodes:[auth,dns],edges:[relation]},
      '/api/v1/experiments/e1/events?offset=0&limit=25&view=baseline':{items:[event],total:1},
      '/api/v1/experiments/e1/evidence?event_id=v2&view=baseline':{event:{...event,event_id:'v2',source_type:'dns'},raw:'DNS ham satırı',reference:event.raw_ref},
      '/api/v1/experiments/e1/event-map?source=auth&q=login':map,
      '/api/v1/experiments/e1/events?offset=0&limit=25&source=auth&q=login':{items:[event],total:1},
    })
    render(<App />)
    const user=userEvent.setup()
    await screen.findByText('Kontrollü deney')
    await user.click(screen.getByRole('button',{name:'Karşılaştırma'}))
    await user.click(screen.getByRole('button',{name:'Olay haritasını aç'}))
    const graph=await screen.findByRole('group',{name:'Dairesel olay haritası'})
    const center = within(graph).getByRole('button',{name:/login/})
    const position = center.getAttribute('transform')
    const summary=screen.getByRole('region',{name:'Kayıp özeti'})
    expect(within(summary).getByText(/Kesilen kaynak DNS/)).toBeVisible()
    expect(within(summary).getByText('0 / 1 kayıt kaldı')).toBeVisible()
    const deltas = within(summary).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell').at(-1)?.textContent)
    expect(deltas).toEqual(['1','1','1'])
    expect(within(graph).queryByRole('button',{name:/dns_query/})).not.toBeInTheDocument()

    await user.click(screen.getByRole('button',{name:'Tam kayıt'}))
    const complete = await screen.findByRole('group',{name:'Dairesel olay haritası'})
    expect(within(complete).getByRole('button',{name:/login/})).toHaveAttribute('transform',position)
    const ghost = within(complete).getByRole('button',{name:/dns_query.*Bu deneyde görünmüyor/})
    const originalProjection = ghost.getAttribute('transform')
    expect(screen.getByRole('button',{name:'3B görünüm'})).toHaveAttribute('aria-pressed','true')
    complete.focus()
    await user.keyboard('{ArrowRight}')
    expect(ghost.getAttribute('transform')).not.toBe(originalProjection)
    await user.click(screen.getByRole('button',{name:'Görünümü sıfırla'}))
    expect(ghost).toHaveAttribute('transform',originalProjection)
    await user.click(screen.getByRole('button',{name:'Üstten görünüm'}))
    expect(ghost.getAttribute('transform')).not.toBe(originalProjection)
    await user.click(screen.getByRole('button',{name:'3B görünüm'}))
    expect(ghost).toHaveAttribute('transform',originalProjection)
    ghost.focus()
    await user.keyboard('{Enter}')
    const details=screen.getByRole('region',{name:'Harita ayrıntıları'})
    expect(details).toHaveFocus()
    expect(await within(details).findByText('DNS ham satırı')).toBeInTheDocument()
    expect(within(details).getByText('Bu deneyde görünmüyor')).toBeInTheDocument()
    await user.click(within(details).getByRole('button',{name:'Kanıtı kapat'}))
    expect(ghost).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await within(details).findByText('DNS ham satırı')).toBeInTheDocument()
    const relations=screen.getByRole('table',{name:'Haritadaki ilişkiler'})
    await user.click(within(relations).getByRole('button',{name:/Olası ilişki/}))
    expect(within(details).getByText(/8 sn/)).toBeInTheDocument()

    await user.click(screen.getByRole('button',{name:'Kayıt kaybı uygulanmış'}))
    const reduced=await screen.findByRole('group',{name:'Dairesel olay haritası'})
    expect(within(reduced).queryByRole('button',{name:/dns_query/})).not.toBeInTheDocument()
    expect(screen.queryByText('DNS ham satırı')).not.toBeInTheDocument()
    expect(requests.filter(request=>request.path.includes('event_id=v2')).map(request=>request.path)).toEqual([
      '/api/v1/experiments/e1/evidence?event_id=v2&view=baseline',
      '/api/v1/experiments/e1/evidence?event_id=v2&view=baseline',
    ])
    await user.selectOptions(screen.getByLabelText('Kaynak',{exact:true}),'auth')
    await user.type(screen.getByLabelText('Olaylarda ara'),'login')
    await user.click(screen.getByRole('button',{name:'Ara'}))
    await waitFor(()=>expect(requests.some(request=>request.path.endsWith('/event-map?source=auth&q=login'))).toBe(true))
    expect(await screen.findByRole('table',{name:'Gözlenen olaylar'})).toBeInTheDocument()
  })
  it('AIT örnek doğrulamasını gerçek arşiv doğrulaması gibi sunmaz', async () => {
    serve({'/api/v1/settings':{version:'0.1.0',data_directory:'/local/data',limits:{},dependencies:{},ait:{status:'fixture_verified',record_url:'https://example.org',note:'Gerçek arşiv ayrıca doğrulanmalı.'}}})
    render(<App />)
    await userEvent.click(screen.getByRole('button',{name:'Raporlar ve ayarlar'}))
    expect(await screen.findByText('Örneklerle doğrulandı')).toBeInTheDocument()
    expect(screen.queryByText('fixture_verified')).not.toBeInTheDocument()
  })
})
