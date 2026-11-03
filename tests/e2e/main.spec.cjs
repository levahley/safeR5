const {test,expect}=require('../../frontend/node_modules/@playwright/test');
const fs=require('node:fs/promises');

async function finish(page, post){
  const response=await post;
  expect(response.status()).toBe(202);
  const job=await response.json();
  await expect.poll(async()=>{
    const r=await page.request.get(`/api/v1/jobs/${job.id}`);
    return (await r.json()).status;
  },{timeout:60000,intervals:[100,300,500]}).toBe('succeeded');
  await expect(page.getByRole('button',{name:'Sonucu aç',exact:true})).toBeVisible({timeout:10000});
  await page.getByRole('button',{name:'Sonucu aç',exact:true}).click();
  await expect(page.getByRole('table',{name:'Metrik karşılaştırması'})).toBeVisible();
  const done=await (await page.request.get(`/api/v1/jobs/${job.id}`)).json();
  return (await page.request.get(`/api/v1/experiments/${done.result_id}`)).json();
}

test('hazır demo, kaynak kesintisi, bağımsız öneri, delil ve dört rapor',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Demo deneyi başlat'})).toBeEnabled();
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/v1/experiments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Demo deneyi başlat'}).click();
  const full=await finish(page,posted);
  expect(full.baseline.event_count).toBe(2400);
  expect(full.baseline.metrics.steps_total).toBe(6);
  expect(full.baseline.method_metrics.rules.steps_total).toBe(6);
  await page.screenshot({path:'artifacts/qa/desktop-comparison.png',fullPage:true});
  await page.reload();
  await page.getByRole('button',{name:'Karşılaştırma',exact:true}).click();
  await expect(page.getByRole('table',{name:'Metrik karşılaştırması'})).toBeVisible();
  await page.getByRole('button',{name:'Deney tasarımı',exact:true}).click();
  await page.getByLabel('Veri kümesi',{exact:true}).selectOption(full.dataset_id);
  await page.getByLabel('Deney adı',{exact:true}).fill('DNS kesintisi · tarayıcı doğrulaması');
  await page.getByLabel('Kayıp modeli',{exact:true}).selectOption('source');
  await page.getByLabel('Kesilecek kaynak',{exact:true}).selectOption('dns');
  const budget=page.locator('#budget');
  await budget.focus();await budget.press('Home');
  for(let i=0;i<12;i++)await budget.press('ArrowRight');
  const outagePost=page.waitForResponse(r=>r.url().endsWith('/api/v1/experiments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Deneyi çalıştır',exact:true}).click();
  const outage=await finish(page,outagePost);
  expect(outage.perturbed.source_counts.dns).toBe(0);
  expect(outage.perturbed.event_count).toBeLessThan(outage.baseline.event_count);
  expect(outage.config.budget_fraction).toBe(.6);
  expect(outage.perturbed.metrics.steps_total).toBe(6);
  await page.getByRole('button',{name:'Kanıt inceleme',exact:true}).click();
  const evidenceButton=page.getByRole('button',{name:/kanıtını aç$/}).first();
  await expect(evidenceButton).toBeVisible();
  await evidenceButton.click();
  await expect(page.getByRole('region',{name:'Ham kanıt',exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/qa/desktop-evidence.png',fullPage:true});
  await page.getByRole('button',{name:'Kaynak optimizasyonu',exact:true}).click();
  await expect(page.getByRole('table',{name:'Kaynak adayları'}).locator('tbody tr')).toHaveCount(8);
  const rec=outage.optimization;
  expect(rec.estimated_cost_bytes).toBeLessThanOrEqual(rec.budget_bytes);
  expect(rec.recommended_sources.length).toBeGreaterThan(0);
  const recPost=page.waitForResponse(r=>r.url().endsWith('/api/v1/experiments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Önerilen kaynaklarla yeni deney',exact:true}).click();
  const selected=await finish(page,recPost);
  expect(selected.id).not.toBe(outage.id);
  expect(selected.config.sources).toEqual(rec.recommended_sources);
  expect(selected.config.dataset_id).toBe(outage.dataset_id);
  const previous=await (await page.request.get(`/api/v1/experiments/${outage.id}`)).json();
  expect(previous.provenance).toEqual(outage.provenance);
  await page.getByRole('button',{name:'Raporlar ve ayarlar',exact:true}).click();
  for(const [label,format] of [['JSON','json'],['CSV','csv'],['Markdown','markdown'],['HTML','html']]){
    const download=page.waitForEvent('download');
    await page.getByRole('link',{name:`${label} indir`,exact:true}).click();
    const file=await download;
    const path=await file.path();
    expect((await fs.stat(path)).size).toBeGreaterThan(100);
    if(format==='json')expect(JSON.parse(await fs.readFile(path,'utf8')).id).toBe(selected.id);
  }
  expect(errors).toEqual([]);
});

test('dar ekranda tüm çalışma alanları ve klavye erişimi',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const list=await (await page.request.get('/api/v1/experiments')).json();
  await page.addInitScript(id=>localStorage.setItem('safer5.experiment',id),list[0].id);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'İçeriğe geç'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  for(const name of ['Genel bakış','Veri laboratuvarı','Deney tasarımı','Karşılaştırma','Kanıt inceleme','Kaynak optimizasyonu','Raporlar ve ayarlar']){
    await page.getByRole('button',{name,exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    if(name==='Genel bakış')await page.screenshot({path:'artifacts/qa/mobile-overview.png',fullPage:true});
    if(name==='Karşılaştırma')await page.screenshot({path:'artifacts/qa/mobile-comparison.png',fullPage:true});
  }
});

test('bağlantı hatası, boş filtre, yüzde100 kayıp ve iptal',async({page})=>{
  await page.route('**/api/v1/overview',route=>route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Yerel sunucuya ulaşılamadı');
  await page.unroute('**/api/v1/overview');
  await page.getByRole('button',{name:'Yeniden dene',exact:true}).click();
  const post=page.waitForResponse(r=>r.url().endsWith('/api/v1/experiments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Deney tasarımı',exact:true}).click();
  await page.getByLabel('Deney adı',{exact:true}).fill('Tam kayıt kaybı');
  await page.getByLabel('Kayıp modeli',{exact:true}).selectOption('random');
  await page.locator('#loss-rate').focus();await page.locator('#loss-rate').press('End');
  await page.getByRole('button',{name:'Deneyi çalıştır',exact:true}).click();
  const empty=await finish(page,post);
  expect(empty.retained_count).toBe(0);
  expect(empty.perturbed.metrics.attack_step_recall).toBe(0);
  expect(empty.perturbed.metrics.false_positive_rate).toBeNull();
  await page.getByRole('button',{name:'Kanıt inceleme',exact:true}).click();
  await expect(page.getByText('Gözlenen olay yok',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Genel bakış',exact:true}).click();
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/experiments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Demo deneyi başlat'}).click();
  const job=await (await pending).json();
  await page.getByRole('button',{name:'İşi iptal et',exact:true}).click();
  await expect.poll(async()=> (await (await page.request.get(`/api/v1/jobs/${job.id}`)).json()).status).toBe('cancelled');
  await expect(page.getByText('İptal edildi',{exact:true})).toBeVisible();
});
