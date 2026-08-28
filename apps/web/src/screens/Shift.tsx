import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ShiftListItem, ShiftReport, ShiftView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'

export function Shift({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const [shift, setShift] = useState<ShiftView | null>(null)
  const [report, setReport] = useState<ShiftReport | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [exportPanel, setExportPanel] = useState<{ text: string; filename: string } | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [pastShifts, setPastShifts] = useState<ShiftListItem[]>([])

  useEffect(() => {
    setLoadError(false)
    void api.getCurrentShift().then(async s => {
      setShift(s)
      if (s) setReport(await api.getShiftReport(s.id))
    }).catch(() => { setLoadError(true) })
    // A vendor with no history yet should see nothing extra — an empty list
    // just means the section below never renders, no separate error state.
    void (api.getShifts?.() ?? Promise.resolve([])).then(setPastShifts).catch(() => {})
  }, [api])

  const selectPastShift = async (id: string) => {
    setActionError(null)
    try {
      setReport(await api.getShiftReport(id))
    } catch {
      setActionError(t('Could not load the shift. Check your connection and try again.'))
    }
  }

  const open = async () => {
    setBusy(true)
    setActionError(null)
    try {
      setShift(await api.openShift(label.trim()))
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SHIFT_OPEN')
        setActionError(t('A shift is already open on this device.'))
      else
        setActionError(t('Could not open the shift. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    if (!shift) return
    setBusy(true)
    setActionError(null)
    try {
      setReport(await api.closeShift(shift.id))
      setShift(null)
    } catch {
      setActionError(t('Could not close the shift. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  // The wallet's webview has no download manager, so <a download> is a
  // silent no-op there. Instead: try the OS share sheet first (this is what
  // lets a vendor hand the file to their accountant), and if that is not
  // available, show the text on screen so it can be copied by hand. Every
  // branch that can fail sets actionError — a tap must never do nothing.
  const download = async (id: string, format: 'csv' | 'json') => {
    setActionError(null)
    setCopyDone(false)
    let text: string, filename: string, mime: string
    try {
      ;({ text, filename, mime } = await api.fetchShiftExport(id, format))
    } catch {
      setActionError(t('Could not download the export. Check your connection and try again.'))
      return
    }
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
      share?: (data: { files: File[]; title?: string }) => Promise<void>
    }
    const file = new File([text], filename, { type: mime })
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share!({ files: [file], title: filename })
      } catch (e) {
        // The vendor cancelling the share sheet is not a failure.
        if (e instanceof Error && e.name === 'AbortError') return
        setActionError(t('Could not share the export. Check your connection and try again.'))
      }
      return
    }
    setExportPanel({ text, filename })
  }

  const copyExport = async () => {
    if (!exportPanel) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportPanel.text)
        setCopyDone(true)
        return
      }
      throw new Error('no clipboard API')
    } catch {
      const el = document.getElementById('export-textarea') as HTMLTextAreaElement | null
      try {
        el?.select()
        const ok = el ? document.execCommand('copy') : false
        if (ok) { setCopyDone(true); return }
        throw new Error('execCommand failed')
      } catch {
        setActionError(t('Could not copy the export. Select the text and copy it manually.'))
      }
    }
  }

  if (loadError) {
    return (
      <main>
        <h1>{t('Shift')}</h1>
        <p role="alert">{t('Could not load the shift. Check your connection and try again.')}</p>
        <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
      </main>
    )
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
        {actionError && <p role="alert">{actionError}</p>}
        {pastShifts.length > 0 && (
          <section className="form-card">
            <h2>{t('Past shifts')}</h2>
            <ul className="past-shifts">
              {pastShifts.map(p => (
                <li key={p.id}>
                  <a href="#" onClick={e => { e.preventDefault(); void selectPastShift(p.id) }}>
                    <span>{new Date(p.openedAt).toLocaleDateString()}</span>
                    {' · '}
                    <span>{p.operatorLabel}</span>
                    {' · '}
                    <span>{p.grossNim} NIM</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
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
      {actionError && <p role="alert">{actionError}</p>}
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
      {exportPanel && (
        <section className="form-card export-panel">
          <p className="quiet">{exportPanel.filename}</p>
          <textarea id="export-textarea" className="export-textarea" readOnly value={exportPanel.text} />
          <div className="actions">
            <button onClick={() => void copyExport()}>{copyDone ? t('Copied') : t('Copy')}</button>
            <button onClick={() => { setExportPanel(null); setCopyDone(false) }}>{t('Close')}</button>
          </div>
        </section>
      )}
      {!shift && pastShifts.length > 0 && (
        <section className="form-card">
          <h2>{t('Past shifts')}</h2>
          <ul className="past-shifts">
            {pastShifts.map(p => (
              <li key={p.id}>
                <a href="#" onClick={e => { e.preventDefault(); void selectPastShift(p.id) }}>
                  {new Date(p.openedAt).toLocaleDateString()} · {p.operatorLabel} · {p.grossNim} NIM
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
      <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
    </main>
  )
}
