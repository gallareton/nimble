import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ShiftEntry, ShiftListItem, ShiftReport, ShiftView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { StatusBadge } from '../components/StatusBadge'
import { t } from '../i18n'
import { usePoll } from '../lib/usePoll'

// Shared by both the open-a-shift view and the running/closed-shift view so
// they can never drift apart the way they once did (span-wrapped fields in
// one copy, flat text in the other).
function PastShiftsList({ items, onSelect }: { items: ShiftListItem[]; onSelect: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <section className="form-card">
      <h2>{t('Past shifts')}</h2>
      <ul className="past-shifts">
        {items.map(p => (
          <li key={p.id}>
            <a href="#" onClick={e => { e.preventDefault(); onSelect(p.id) }}>
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
  )
}

function ReportSummary({ report }: { report: ShiftReport }) {
  return (
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
  )
}

// The summary above shows totals only — a vendor looking at their own shift
// wants to see what they actually sold, not just the sum of it. A refund is
// marked up beyond its negative sign (§ spec: "not only by the sign") because
// a glance at a long list must not depend on reading a minus sign correctly.
// Only a CONFIRMED sale with no refund pointers of its own is refundable —
// an unconfirmed entry has no money to give back yet, and a refund cannot
// itself be refunded.
function isRefundEntry(e: ShiftEntry): boolean {
  return e.refundOfLocalNumber !== null || e.refundOfOccurredAt !== null
}

// `locked` only hides the "Refund" link — a convenience so a cashier under
// an active lock never taps something the server (POST .../refunds) is
// going to answer with 423 CASHIER_LOCKED anyway. Removing this prop would
// not reopen refunds; only DELETE /v1/me/cashier-lock does that.
function EntryList({ entries, locked }: { entries: ShiftEntry[]; locked: boolean }) {
  if (entries.length === 0) return null
  return (
    <section className="form-card">
      <h2>{t('Transactions')}</h2>
      <ul className="entries">
        {entries.map(e => {
          const refund = isRefundEntry(e)
          const refundable = !refund && e.status === 'CONFIRMED' && !locked
          return (
            <li key={e.chargeId} className={refund ? 'entries__row entries__row--refund' : 'entries__row'}>
              <div className="entries__main">
                <span className="quiet">#{e.localNumber} · {new Date(e.occurredAt).toLocaleTimeString()}</span>
                <span className="amt">{e.amountNim} NIM</span>
              </div>
              <div className="entries__meta">
                <StatusBadge status={e.status} />
                {e.reference && <span className="quiet">{e.reference}</span>}
              </div>
              {refund && (
                <p className="quiet entries__refund-tag">
                  {e.refundOfLocalNumber !== null
                    ? t('↩ Refund of sale #{n}').replace('{n}', String(e.refundOfLocalNumber))
                    : t('↩ Refund of a sale from {date}').replace('{date}', new Date(e.refundOfOccurredAt!).toLocaleDateString())}
                </p>
              )}
              {refundable && (
                <p>
                  <Link to={`/refund/${e.chargeId}`} state={{ amountNim: e.amountNim, reference: e.reference }}>
                    {t('Refund')}
                  </Link>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Sold-by-product and NIM/cash split (Task 4). Both are additive fields on
// ShiftReport — a report from before this feature (or a test double that
// doesn't bother stubbing them) simply renders neither section, never a
// crash, so the six pre-existing report fixtures in shift.test.tsx keep
// passing unchanged.
function ProductBreakdown({ report }: { report: ShiftReport }) {
  if (!report.byProduct || report.byProduct.length === 0) return null
  return (
    <section className="form-card">
      <h2>{t('Sold by product')}</h2>
      <ul className="list">
        {report.byProduct.map(p => (
          <li key={p.name}>
            <span>{p.name} × {p.quantity}</span>
            <span className="amt">{(p.totalMinor / 100).toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PaymentSplit({ report }: { report: ShiftReport }) {
  if (!report.totals.byPaymentMethod) return null
  const { nim, cash } = report.totals.byPaymentMethod
  return (
    <section className="form-card">
      <h2>{t('By payment method')}</h2>
      <p>{t('NIM')}: {nim.count} · {(nim.fiatMinor / 100).toFixed(2)}</p>
      <p>{t('Cash')}: {cash.count} · {(cash.fiatMinor / 100).toFixed(2)}</p>
      {report.cashEntries && report.cashEntries.length > 0 && (
        <ul className="list">
          {report.cashEntries.map(e => (
            <li key={e.saleId}>
              <span className="quiet">🪙 {t('Cash')} · {new Date(e.occurredAt).toLocaleTimeString()}</span>
              <span>{(e.amountFiatMinor / 100).toFixed(2)}{e.reference ? ` · ${e.reference}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

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
  const [report, setReport] = useState<ShiftReport | null>(null)
  // A selected past shift is a view the vendor is *visiting*, kept separate
  // from `report` (the current/just-closed shift's own report) so leaving it
  // never depends on reloading or remounting — just clearing this state.
  const [pastReport, setPastReport] = useState<ShiftReport | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [exportPanel, setExportPanel] = useState<{ text: string; filename: string } | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [pastShifts, setPastShifts] = useState<ShiftListItem[]>([])
  // null = not asked yet; a number = asked, and this many bills are unpaid.
  const [pendingBills, setPendingBills] = useState<number | null>(null)
  // Cashier lock state (spec §6). This is display-only: the badge tells the
  // cashier the till isn't broken, and it drives which of the four gated
  // actions this screen offers — the server enforces the lock regardless of
  // what this screen shows or hides.
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    setLoadError(false)
    void api.getCurrentShift().then(async s => {
      setShift(s)
      if (s) setReport(await api.getShiftReport(s.id))
    }).catch(() => { setLoadError(true) })
    // A vendor with no history yet should see nothing extra — an empty list
    // just means the section below never renders, no separate error state.
    void (api.getShifts?.() ?? Promise.resolve([])).then(setPastShifts).catch(() => {})
    void api.getMe?.().then(me => setLocked(me.cashierLocked)).catch(() => {})
  }, [api])

  // Sales arrive because a customer paid, so the till has no other way to
  // learn about them: poll the whole time a shift is open, not just while
  // something is already in flight. Without this the list stayed frozen at
  // whatever it held when the screen was opened.
  //
  // Deliberately silent on failure — a dropped refresh is the next tick's
  // problem, and turning a blip into an error banner over a list that is
  // merely a few seconds stale would be worse than the staleness.
  usePoll(() => {
    if (!shift) return
    void api.getShiftReport(shift.id).then(setReport).catch(() => {})
  }, REPORT_POLL_MS, Boolean(shift) && !report?.shift.closedAt)

  const selectPastShift = async (id: string) => {
    setActionError(null)
    // Whatever export was open for the previously viewed shift (current or
    // another past one) must not survive onto this one's screen.
    setExportPanel(null)
    setCopyDone(false)
    try {
      setPastReport(await api.getShiftReport(id))
    } catch {
      setActionError(t('Could not load the shift. Check your connection and try again.'))
    }
  }

  const backFromPastShift = () => {
    setPastReport(null)
    setExportPanel(null)
    setCopyDone(false)
    setActionError(null)
  }

  // A closed shift's report otherwise sticks around forever (nothing ever
  // clears `report`), stranding the vendor away from the open-a-shift form
  // that reappears only once `shift` and `report` are both null. Same idiom
  // as leaving a past shift: clear the view-only state, keep everything else.
  const backFromClosedShift = () => {
    setReport(null)
    setExportPanel(null)
    setCopyDone(false)
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

  // Asked for only when the vendor moves to close, not polled: this is the one
  // moment the answer changes a decision, and a till does not need a standing
  // count of it on screen all day.
  const close = async () => {
    if (!shift) return
    setBusy(true)
    setActionError(null)
    try {
      if (pendingBills === null) {
        // A bill paid after this shift closes lands in whatever shift is open
        // then — or in none at all. The vendor can only act on that here, so
        // say it once and let the next tap go through.
        const res = await api.getOutstandingBills?.()
        const count = res?.bills.length ?? 0
        if (count > 0) { setPendingBills(count); return }
      }
      setReport(await api.closeShift(shift.id))
      setShift(null)
      setPendingBills(null)
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
      </main>
    )
  }


  const exportPanelSection = exportPanel && (
    <section className="form-card export-panel">
      <p className="quiet">{exportPanel.filename}</p>
      <textarea id="export-textarea" className="export-textarea" readOnly value={exportPanel.text} />
      <div className="actions">
        <button onClick={() => void copyExport()}>{copyDone ? t('Copied') : t('Copy')}</button>
        <button onClick={() => { setExportPanel(null); setCopyDone(false) }}>{t('Close')}</button>
      </div>
    </section>
  )

  // Viewing a past shift is a state the vendor can leave — a "Back" action
  // clears it and returns to whichever default view was underneath, without
  // touching (or remounting) that view's own state.
  if (pastReport) {
    return (
      <main>
        <h1>{t('Shift')}</h1>
        <p>
          <a href="#" onClick={e => { e.preventDefault(); backFromPastShift() }}>‹ {t('Back')}</a>
        </p>
        <p className="quiet">{pastReport.shift.operatorLabel}</p>
        <ReportSummary report={pastReport} />
        <EntryList entries={pastReport.entries} locked={locked} />
        <ProductBreakdown report={pastReport} />
        <PaymentSplit report={pastReport} />
        {actionError && <p role="alert">{actionError}</p>}
        {/* Export is one of the four gated operations (spec §5, GET
            .../export → 423 CASHIER_LOCKED). Hiding these links while
            locked is convenience, not the guard — the server rejects the
            request regardless of whether this stayed on screen. */}
        {!locked && (
          <p>
            <a href="#" onClick={e => { e.preventDefault(); void download(pastReport.shift.id, 'csv') }}>{t('Download CSV')}</a>
            {' · '}
            <a href="#" onClick={e => { e.preventDefault(); void download(pastReport.shift.id, 'json') }}>{t('Download JSON')}</a>
          </p>
        )}
        {exportPanelSection}
        <PastShiftsList items={pastShifts} onSelect={id => void selectPastShift(id)} />
        <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
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
        <PastShiftsList items={pastShifts} onSelect={id => void selectPastShift(id)} />
        <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
      </main>
    )
  }

  return (
    <main>
      <h1>{t('Shift')}</h1>
      {report && !shift && (
        <p>
          <a href="#" onClick={e => { e.preventDefault(); backFromClosedShift() }}>‹ {t('Back')}</a>
        </p>
      )}
      {shift && <p className="quiet">{shift.operatorLabel}</p>}
      {report && <ReportSummary report={report} />}
      {report && <EntryList entries={report.entries} locked={locked} />}
      {report && <ProductBreakdown report={report} />}
      {report && <PaymentSplit report={report} />}
      {actionError && <p role="alert">{actionError}</p>}
      {/* Not gated on an open shift: a remote bill produces receipts, on-chain
          reconciliation and live status whether or not one is running — only
          the report line needs a shift, and that is a bonus, not a condition.
          Bill creation and payment acceptance are outside the four gated
          operations (spec §5) and stay available while locked. */}
      <p>
        <Link to="/charge/remote">{t('Bill someone who isn\'t here')}</Link>
      </p>
      <p>
        <Link to="/products">{t('Manage products')}</Link>
      </p>
      {/* Shift close is gated (spec §5, POST .../close → 423). Hiding the
          button while locked is convenience, not the guard. */}
      {shift && !locked && (<>
        {pendingBills !== null && (
          <p role="alert" className="quiet">
            {t('{n} bills are still unpaid. Anything paid after you close lands outside this report.')
              .replace('{n}', String(pendingBills))}
          </p>
        )}
        <button disabled={busy} onClick={close}>
          {pendingBills !== null ? t('Close it anyway') : t('Close the shift')}
        </button>
      </>)}
      {/* Export is gated too (spec §5, GET .../export → 423) — same
          convenience-not-guard note as above. */}
      {report && !shift && !locked && (
        <p>
          <a href="#" onClick={e => { e.preventDefault(); void download(report.shift.id, 'csv') }}>{t('Download CSV')}</a>
          {' · '}
          <a href="#" onClick={e => { e.preventDefault(); void download(report.shift.id, 'json') }}>{t('Download JSON')}</a>
        </p>
      )}
      {exportPanelSection}
      {!shift && <PastShiftsList items={pastShifts} onSelect={id => void selectPastShift(id)} />}
      <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
    </main>
  )
}
