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
  await page.getByRole('button',{name:'Olay haritasını aç',exact:true}).click();
  await expect(page.getByRole('region',{name:'Kayıp özeti'})).toContainText('Bu deney tam kayıtla çalıştırıldı');
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
  await checkEventMap(page, outage);
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

async function checkEventMap(page, outage) {
  const base = `/api/v1/experiments/${outage.id}`;
  const read = async (path, params) => (await page.request.get(base + path, {params})).json();
  const completeDns = await read('/events', {view:'baseline', source:'dns', q:'.updates.example.test'});
  const session = completeDns.items[0].session_id;
  const auth = (await read('/events', {source:'auth', q:session})).items[0];
  expect(auth).toBeTruthy();
  const focus = {focus_kind:'event', focus_id:auth.event_id, q:session};
  const full = await read('/event-map', {...focus, view:'baseline'});
  const lost = await read('/event-map', focus);
  const dns = full.nodes.find(node => node.kind === 'event' && node.sources.includes('dns'));
  expect(dns.missing).toBe(true);
  expect(lost.nodes.some(node => node.event_id === dns.event_id)).toBe(false);

  await page.getByRole('button', {name:'Olay haritasını aç', exact:true}).click();
  await page.getByRole('textbox', {name:'Olaylarda ara'}).fill(session);
  await page.getByRole('button', {name:'Ara', exact:true}).click();
  const table = page.getByRole('table', {name:'Gözlenen olaylar'});
  await table.getByRole('button', {name:auth.event_id + ' olayını haritada aç'}).click();
  const graph = page.getByRole('group', {name:'Dairesel olay haritası'});
  const glyph = id => graph.locator(`[data-node-id="${id}"]`);
  const common = lost.nodes.find(node => node.angle !== null && node.kind === 'event' && node.sources.includes('auth'));
  await expect(glyph(common.id)).toBeVisible();
  await expect(page.locator('canvas.map-solid-scene')).toBeVisible();
  await expect(page.locator('.map-viewport')).toHaveAttribute('data-solid-scene', 'true');
  const position = await glyph(common.id).getAttribute('transform');
  const fmt = new Intl.NumberFormat('tr-TR');
  const summary = page.getByRole('region', {name:'Kayıp özeti'});
  const summaryCells = name => summary.getByRole('row',{name}).getByRole('cell');
  await expect(summaryCells(/^Alarm /)).toHaveText([
    fmt.format(outage.baseline.metrics.alerts_total), fmt.format(outage.perturbed.metrics.alerts_total), '31',
  ]);
  await expect(summaryCells(/^Olay /)).toHaveText([
    fmt.format(outage.baseline.event_count), fmt.format(outage.perturbed.event_count), '808',
  ]);
  await expect(summary.getByText(/Kesilen kaynak DNS/)).toBeVisible();
  await expect(summary.getByText('0 / 808 kayıt kaldı')).toBeVisible();
  await summary.screenshot({path:'artifacts/qa/event-map-summary.png'});
  await expect(glyph(dns.id)).toHaveCount(0);
  await glyph(common.id).press('Enter');
  const inspector = page.getByRole('region', {name:'Harita ayrıntıları'});
  await expect(inspector.getByLabel('Ham satır', {exact:true})).toContainText('"source_type":"auth"');

  await page.getByRole('button', {name:'Tam kayıt', exact:true}).click();
  await expect(glyph(common.id)).toHaveAttribute('transform', position);
  await expect(glyph(dns.id)).toHaveAccessibleName(/Bu deneyde görünmüyor/);
  await glyph(dns.id).press('Enter');
  await expect(inspector.getByLabel('Ham satır', {exact:true})).toContainText('"source_type":"dns"');
  await expect(inspector.getByText('Bu deneyde görünmüyor', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Merkeze dön', exact:true}).click();
  await page.locator('.map-body').screenshot({path:'artifacts/qa/event-map-full.png'});

  await page.getByRole('button', {name:'Kayıt kaybı uygulanmış', exact:true}).click();
  await expect(glyph(common.id)).toHaveAttribute('transform', position);
  await expect(glyph(dns.id)).toHaveCount(0);
  await expect(inspector.getByLabel('Ham satır', {exact:true})).toHaveCount(0);
  expect((await page.request.get(base + '/evidence', {params:{event_id:dns.event_id}})).status()).toBe(404);

  await page.getByRole('button', {name:'Üstten görünüm'}).click();
  await expect(page.locator('canvas.map-solid-scene')).toBeHidden();
  await expect(glyph(common.id)).not.toHaveAttribute('transform', position);
  await page.getByRole('button', {name:'3B görünüm'}).click();
  await expect(page.locator('canvas.map-solid-scene')).toBeVisible();
  await expect(glyph(common.id)).toHaveAttribute('transform', position);
  const layer = graph.locator(':scope > g');
  const initial = await layer.getAttribute('transform');
  await page.getByRole('button', {name:'Yakınlaştır', exact:true}).click();
  await expect(page.getByLabel('Yakınlaştırma düzeyi')).toHaveText('125%');
  const zoomed = await layer.getAttribute('transform');
  await graph.scrollIntoViewIfNeeded();
  await page.emulateMedia({reducedMotion:'no-preference'});
  const movable = glyph(common.id);
  await movable.evaluate(el => {
    let updates = 0;
    const rotation = new MutationObserver(() => {
      el.setAttribute('data-rotation-updates', String(++updates));
      if (updates === 3) rotation.disconnect();
    });
    rotation.observe(el, {attributeFilter:['transform']});
  });
  const bounds = await graph.boundingBox();
  await page.mouse.move(bounds.x + 20, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 68, bounds.y + 100);
  await page.mouse.up();
  await expect(movable).not.toHaveAttribute('transform', position);
  await expect(movable).toHaveAttribute('data-rotation-updates', '3');
  await expect(layer).toHaveAttribute('transform', zoomed);
  await page.getByRole('button', {name:'Kaydırma modu'}).click();
  const panBounds = await graph.boundingBox();
  await page.mouse.move(panBounds.x + 20, panBounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(panBounds.x + 68, panBounds.y + 100, {steps:6});
  await page.mouse.up();
  await expect(layer).not.toHaveAttribute('transform', zoomed);
  await page.getByRole('button', {name:'Görünümü sıfırla'}).click();
  await expect(layer).toHaveAttribute('transform', initial);
  await expect(glyph(common.id)).toHaveAttribute('transform', position);
  await page.locator('.map-body').screenshot({path:'artifacts/qa/event-map-loss.png'});

  const enterFullscreen = page.getByRole('button', {name:'Tam ekran', exact:true});
  await expect(enterFullscreen).toBeVisible();
  await enterFullscreen.click();
  const exitFullscreen = page.getByRole('button', {name:'Tam ekrandan çık', exact:true});
  await expect(exitFullscreen).toBeVisible();
  const workspace = page.getByRole('dialog',{name:'Tam ekran olay haritası'});
  await expect(workspace).toHaveAttribute('data-fullscreen', 'native');
  await expect.poll(() => workspace.evaluate(el => Math.abs(el.getBoundingClientRect().width - window.innerWidth))).toBeLessThan(1);
  await expect(inspector).toBeVisible();

  const nodeOrigin = () => glyph(common.id).evaluate(el => {
    const matrix = el.getScreenCTM();
    return {x:matrix.e, y:matrix.f};
  });
  const underCursor = await nodeOrigin();
  const scroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(underCursor.x, underCursor.y);
  await page.mouse.wheel(0, -120);
  const zoomLabel = page.getByLabel('Yakınlaştırma düzeyi');
  await expect(zoomLabel).not.toHaveText('100%');
  const zoomLevel = await zoomLabel.textContent();
  const afterWheel = await nodeOrigin();
  expect(Math.hypot(afterWheel.x - underCursor.x, afterWheel.y - underCursor.y)).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await glyph(common.id).press('Enter');
  await expect(inspector.getByLabel('Ham satır', {exact:true})).toContainText('"source_type":"auth"');
  await page.screenshot({path:'artifacts/qa/event-map-fullscreen.png'});
  await exitFullscreen.click();
  await expect(workspace).toHaveCount(0);
  await expect(zoomLabel).toHaveText(zoomLevel);
  await expect(enterFullscreen).toBeFocused();
  await page.getByRole('button', {name:'Görünümü sıfırla'}).click();

  const start = auth.event_time.slice(0, 19);
  const end = new Date(Date.parse(auth.event_time) + 1000).toISOString().slice(0, 19);
  await page.getByLabel('Başlangıç (UTC)').fill(start);
  await page.getByLabel('Bitiş (UTC)').fill(end);
  await page.getByRole('button', {name:'Ara', exact:true}).click();
  await expect(graph.locator('[data-kind="event"]')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toHaveCount(1);

  await page.setViewportSize({width:390,height:844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({width:1440,height:1000});

  await page.getByRole('button', {name:'Filtreleri temizle'}).click();
  await page.getByRole('button', {name:'Tam kayıt', exact:true}).click();
  await page.getByText('Deney alarmlarından merkez seç').click();
  await page.getByRole('textbox', {name:'Alarmlarda ara'}).fill('dns-pattern');
  await page.getByRole('button', {name:'dns-pattern alarmını haritada aç'}).first().click();
  await expect(graph.locator('[data-center][data-kind="alert"]')).toHaveAccessibleName(/Bu deneyde görünmüyor/);
  await page.getByRole('button', {name:'Kayıt kaybı uygulanmış', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Bu deneyde görünmüyor'})).toBeVisible();
  await expect(graph).toHaveCount(0);
  await expect(inspector.getByLabel('Ham satır', {exact:true})).toHaveCount(0);
}

test('dar ekranda tüm çalışma alanları ve klavye erişimi',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const list=await (await page.request.get('/api/v1/experiments')).json();
  await page.addInitScript(id=>localStorage.setItem('safer5.experiment',id),list[0].id);
  await page.addInitScript(()=>Object.defineProperty(window,'WebGLRenderingContext',{value:undefined}));
  await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{value:false}));
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
  await page.getByRole('button',{name:'Karşılaştırma',exact:true}).click();
  await page.getByRole('button',{name:'Olay haritasını aç',exact:true}).click();
  const graph=page.getByRole('group',{name:'Dairesel olay haritası'});
  await expect(graph).toBeVisible();
  await expect(page.locator('.map-viewport')).not.toHaveAttribute('data-solid-scene','true');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  const event=graph.locator('[data-kind="event"]').first();
  await event.press('Enter');
  const raw=page.getByRole('region',{name:'Harita ayrıntıları'}).getByLabel('Ham satır');
  await expect(raw).toBeVisible();
  const enterFullscreen=page.getByRole('button',{name:'Tam ekran',exact:true});
  await enterFullscreen.click();
  const workspace=page.getByRole('dialog',{name:'Tam ekran olay haritası'});
  await expect(workspace).toHaveAttribute('data-fullscreen','overlay');
  await expect(workspace.getByRole('button',{name:'Tam ekrandan çık'})).toBeFocused();
  await expect(raw).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveCount(0);
  await expect(enterFullscreen).toBeFocused();
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
  await expect(page.getByRole('region',{name:'İş durumu'}).getByText('İptal edildi',{exact:true})).toBeVisible();
});
