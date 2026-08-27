import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ShiftReport, ShiftView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { t } from '../i18n'

export function Shift({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const [shift, setShift] = useState<ShiftView | null>(null)
  const [report, setReport] = useState<ShiftReport | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.getCurrentShift().then(async s => {
      setShift(s)
      if (s) setReport(await api.getShiftReport(s.id))
    }).catch(() => {})
  }, [api])

  const open = async () => {
    setBusy(true)
    try { setShift(await api.openShift(label.trim())) } finally { setBusy(false) }
  }

  const close = async () => {
    if (!shift) return
    setBusy(true)
    try {
      setReport(await api.closeShift(shift.id))
      setShift(null)
    } finally { setBusy(false) }
  }

  // A plain <a href> cannot carry the bearer token the export endpoint
  // requires, so pull the file down with auth and hand the browser a blob
  // URL to save, revoking it once the download has started.
  const download = async (id: string, format: 'csv' | 'json') => {
    const { url, filename } = await api.fetchShiftExport(id, format)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!shift && !report) {
    return (
      <main>
        <h1>{t('Shift')}</h1>
        <div className="form-card">
          <label>
            {t('Who is on the till?')}
            <input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
          </label>
          <button className="primary" disabled={!label.trim() || busy} onClick={open}>
            {t('Open a shift')}
          </button>
        </div>
        <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
        <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
      </main>
    )
  }

  return (
    <main>
      <h1>{t('Shift')}</h1>
      {shift && <p className="quiet">{shift.operatorLabel}</p>}
      {report && (
        <section className="form-card">
          <p className="amt">{report.totals.grossNim} NIM</p>
          {report.totals.grossFiatMinor !== null && report.totals.fiatCurrency && (
            <p className="quiet">
              {(report.totals.grossFiatMinor / 100).toFixed(2)} {report.totals.fiatCurrency}
            </p>
          )}
          <p className="quiet">
            {report.totals.confirmed} {t('sales')}
            {report.totals.failed > 0 && ` · ${report.totals.failed} ${t('failed')}`}
          </p>
          {report.fiatIncomplete && <p className="quiet">{t('Some sales had no exchange rate, so the fiat total is partial.')}</p>}
        </section>
      )}
      {shift && (
        <button disabled={busy} onClick={close}>{t('Close the shift')}</button>
      )}
      {report && !shift && (
        <p>
          <a href="#" onClick={e => { e.preventDefault(); void download(report.shift.id, 'csv') }}>{t('Download CSV')}</a>
          {' · '}
          <a href="#" onClick={e => { e.preventDefault(); void download(report.shift.id, 'json') }}>{t('Download JSON')}</a>
        </p>
      )}
      <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
      <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
    </main>
  )
}
