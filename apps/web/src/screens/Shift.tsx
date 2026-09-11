import { useEffect, useState } from 'react'
import type { ShiftReport as ShiftReportView, ShiftView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { usePoll } from '../lib/usePoll'
import { EntryList, ExportButton, PaymentSplit, ProductBreakdown, ReportSummary, dotted, reportHeadline, splitParts, useExport } from './ShiftReport'

// Reading stays available offline (BR-P10 blocks accepting a payment, not
// looking at what already happened): this screen deliberately never checks
// connectivity, so a vendor reviewing yesterday's takings on a bad
// connection is never locked out. Only Charge, which mints new claims,
// gates on `useOnline`.
const REPORT_POLL_MS = 5000

export function Shift({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const [shift, setShift] = useState<ShiftView | null>(null)
  const [report, setReport] = useState<ShiftReportView | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // null = the vendor has not asked to close; an object = the confirmation
  // panel is up, carrying the outstanding-bill count the server just gave us.
  const [confirmClose, setConfirmClose] = useState<{ unpaid: number } | null>(null)
  // Cashier lock state (spec §6). This is display-only: it drives which of
  // the four gated actions this screen offers — the server enforces the lock
  // regardless of what this screen shows or hides.
  const [locked, setLocked] = useState(false)
  const { download, exportPanelSection, actionError: exportError } = useExport(api)

  useEffect(() => {
    setLoadError(false)
    void api.getCurrentShift().then(async s => {
      setShift(s)
      if (s) setReport(await api.getShiftReport(s.id))
    }).catch(() => { setLoadError(true) })
    void api.getMe?.().then(me => setLocked(me.cashierLocked)).catch(() => {})
  }, [api])

  // Sales arrive because a customer paid, so the till has no other way to
  // learn about them: poll the whole time a shift is open, not just while
  // something is already in flight.
  //
  // Deliberately silent on failure — a dropped refresh is the next tick's
  // problem, and turning a blip into an error banner over a list that is
  // merely a few seconds stale would be worse than the staleness.
  usePoll(() => {
    if (!shift) return
    void api.getShiftReport(shift.id).then(setReport).catch(() => {})
  }, REPORT_POLL_MS, Boolean(shift) && !report?.shift.closedAt)

  // A closed shift's report otherwise sticks around forever (nothing ever
  // clears `report`), stranding the vendor away from the open-a-shift form
  // that reappears only once `shift` and `report` are both null.
  const backFromClosedShift = () => {
    setReport(null)
    setActionError(null)
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

  // Outstanding bills are asked for only when the vendor moves to close, not
  // polled: this is the one moment the answer changes a decision, and a till
  // does not need a standing count of it on screen all day. The count then
  // rides into the confirmation panel rather than becoming a second, separate
  // "Close it anyway" idiom (R14).
  const askClose = async () => {
    if (!shift) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await api.getOutstandingBills?.()
      setConfirmClose({ unpaid: res?.bills.length ?? 0 })
    } catch {
      setActionError(t('Could not close the shift. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCloseNow = async () => {
    if (!shift) return
    setBusy(true)
    setActionError(null)
    try {
      setReport(await api.closeShift(shift.id))
      setShift(null)
      setConfirmClose(null)
    } catch {
      setActionError(t('Could not close the shift. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <main>
        <h1>{t('Shift')}</h1>
        <p role="alert">{t('Could not load the shift. Check your connection and try again.')}</p>
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
        <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
      </main>
    )
  }

  const who = shift?.operatorLabel ?? report?.shift.operatorLabel ?? ''
  const close = report ? reportHeadline(report.totals) : null

  return (
    <main>
      <h1>{t('Shift')}</h1>
      {report && !shift && (
        <p>
          <button className="link-btn" onClick={backFromClosedShift}>‹ {t('Back')}</button>
        </p>
      )}
      <p className="shift-who">{t('On the till')}: <strong>{who}</strong></p>
      {report && <ReportSummary report={report} />}
      {report && <EntryList entries={report.entries} locked={locked} />}
      {report && <ProductBreakdown report={report} />}
      {report && <PaymentSplit report={report} />}
      {actionError && <p role="alert">{actionError}</p>}
      {exportError && <p role="alert">{exportError}</p>}
      {/* Export is gated (spec §5, GET .../export → 423) — hiding it while
          locked is convenience, not the guard. */}
      {report && !shift && !locked && <ExportButton id={report.shift.id} download={(i, f) => void download(i, f)} />}
      {exportPanelSection}
      <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
      {/* Shift close is gated too (spec §5, POST .../close → 423). */}
      {/* A bottom sheet, not an inline panel: the "Close the shift" button is
          sticky and can be tapped from anywhere on the page, so the question
          it opens has to appear where the finger is — an inline panel above
          the button rendered off-screen and looked like a dead tap. */}
      {shift && !locked && confirmClose && (
        <div className="app-sheet-backdrop" onClick={() => setConfirmClose(null)}>
          <section className="app-sheet confirm-sheet" role="dialog" aria-label={t('Close the shift')}
            onClick={e => e.stopPropagation()}>
            <p>{t("Closing {name}'s shift").replace('{name}', who)}</p>
            {/* The same takings the report shows, at the irreversible
                moment: a dialog that repeats a wrong summary is worse than
                no summary. Until the report has loaded there is no total to
                show and the confirm button below stays disabled. */}
            {close && <>
              <p className="amt">{close.gross}</p>
              <p className="quiet">{dotted(splitParts(report!.totals))}</p>
              {close.cashSales > 0 && close.currency && (
                <p>{t('Cash to settle')}: {(close.cashMinor / 100).toFixed(2)} {close.currency}</p>
              )}
            </>}
            {!report && <p className="quiet">{t('Loading…')}</p>}
            {confirmClose.unpaid > 0 && (
              <p role="alert" className="quiet">
                {t('{n} bills are still unpaid. Anything paid after you close lands outside this report.')
                  .replace('{n}', String(confirmClose.unpaid))}
              </p>
            )}
            <div className="actions">
              <button className="primary" disabled={busy || !report} onClick={() => void confirmCloseNow()}>{t('Close the shift')}</button>
              <button onClick={() => setConfirmClose(null)}>{t('Keep it open')}</button>
            </div>
          </section>
        </div>
      )}
      {shift && !locked && (
        <div className="cta-bar">
          <button className="primary" disabled={busy} onClick={() => void askClose()}>{t('Close the shift')}</button>
        </div>
      )}
    </main>
  )
}
