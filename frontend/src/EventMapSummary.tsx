import { useMemo } from 'react'
import { FileTerminal, Globe2, KeyRound } from 'lucide-react'
import { date, lossNames, num, percent, sourceNames, sources } from './domain'
import type { EvidenceView, Experiment, LossConfig } from './types'

const icons = { auth: KeyRound, audit: FileTerminal, dns: Globe2 }

function scenarioDescription(loss: LossConfig) {
  const range = loss.start && loss.end ? date(loss.start) + ' – ' + date(loss.end) : null
  switch (loss.kind) {
    case 'none':
      return 'Bu deney tam kayıtla çalıştırıldı. İki görünümde de aynı sayıları görürsünüz.'
    case 'source':
      return loss.source
        ? 'Kesilen kaynak ' + sourceNames[loss.source] + (range ? ' · ' + range : ' · tüm deney boyunca')
        : 'Seçili kaynağın kayıtlarına kesinti uygulandı.'
    case 'interval':
      return range ?? 'Kayıp seçili zaman aralığına uygulandı.'
    case 'random':
      return 'Hedef kayıt kaybı oranı ' + percent(loss.rate)
  }
}

export default function EventMapSummary({ experiment, view }: { experiment: Experiment; view: EvidenceView }) {
  const { baseline, perturbed, config } = experiment
  const rows = useMemo(() => {
    const retained = new Map(perturbed.alerts.map(alert => [alert.id, new Set(alert.evidence_ids)]))
    let fullLinks = 0, missingLinks = 0, missingAlerts = 0
    for (const alert of baseline.alerts) {
      const current = retained.get(alert.id)
      if (!current) missingAlerts++
      for (const id of new Set(alert.evidence_ids)) {
        fullLinks++
        if (!current?.has(id)) missingLinks++
      }
    }
    const keptLinks = [...retained.values()].reduce((total, ids) => total + ids.size, 0)
    return [
      { label: 'Olay', full: baseline.event_count, kept: perturbed.event_count, missing: baseline.event_count - perturbed.event_count },
      { label: 'Delil bağlantısı', full: fullLinks, kept: keptLinks, missing: missingLinks },
      { label: 'Alarm', full: baseline.metrics.alerts_total, kept: perturbed.metrics.alerts_total, missing: missingAlerts },
    ]
  }, [baseline, perturbed])
  return <section className="map-summary" aria-label="Kayıp özeti">
    <header className="map-summary-head">
      <div>
        <h3>Deney özeti</h3>
        <p>{scenarioDescription(config.loss)}</p>
      </div>
      <span className={'map-scenario' + (config.loss.kind === 'none' ? '' : ' scenario-loss')}>{lossNames[config.loss.kind]}</span>
    </header>
    <div className="map-summary-grid">
      <table className="map-summary-counts" aria-label="Tam kayıt ve kayıt kaybı karşılaştırması">
        <thead><tr>
          <th scope="col">Ölçüm</th>
          <th scope="col" data-current={view === 'baseline' || undefined}>Tam kayıt</th>
          <th scope="col" data-current={view === 'perturbed' || undefined}>Kayıp sonrası</th>
          <th scope="col">Eksik</th>
        </tr></thead>
        <tbody>{rows.map(({ label, full, kept, missing }) => <tr key={label}>
          <th scope="row">{label}</th>
          <td data-current={view === 'baseline' || undefined}>{num(full)}</td>
          <td data-current={view === 'perturbed' || undefined}>{num(kept)}</td>
          <td className={missing ? 'map-summary-missing' : 'muted'}>{num(missing)}</td>
        </tr>)}</tbody>
      </table>
      <div className="map-source-summary">
        <h4>Kaynaklara göre kalan kayıt</h4>
        <ul>{sources.map(source => {
          const Icon = icons[source]
          const before = baseline.source_counts[source]
          const after = perturbed.source_counts[source]
          return <li className={'map-source ' + source} key={source}>
            <div className="map-source-summary-row">
              <span><Icon size={13} aria-hidden="true"/>{sourceNames[source]}</span>
              <strong>{num(after)} / {num(before)} kayıt kaldı</strong>
            </div>
            <div className="map-source-meter" aria-hidden="true">
              <span style={{ width: (before ? Math.min(1, after / before) * 100 : 0) + '%' }}/>
            </div>
          </li>
        })}</ul>
      </div>
    </div>
    <details className="map-summary-note">
      <summary>Sayılar nasıl hesaplandı?</summary>
      <p>Özet tüm deneyi kapsar. Eksik sütunu, tam kayıtta bulunup kayıplı kolda görünmeyen kayıtları ve alarm kimliklerini sayar. Her alarm ve dayandığı bir olay, bir delil bağlantısı olarak sayılır.</p>
    </details>
  </section>
}
