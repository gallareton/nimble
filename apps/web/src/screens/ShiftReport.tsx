import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ShiftEntry, ShiftReport as ShiftReportView } from '@nimble/shared'
import { SUPPORTED_FIAT_CURRENCY } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { StatusBadge } from '../components/StatusBadge'
import { t } from '../i18n'

// Every section of a shift report lives here, so the running shift, the
// just-closed shift and a past shift reached from History can never drift
// apart the way they once did (span-wrapped fields in one copy, flat text
// in the other).

/** One definition of "takings" for every screen: NIM *and* cash. The audit
 *  found a shift with two cash sales headlined "0 NIM · 0 sales" with 35.00
 *  USD sitting right under it — the count came from `confirmed`, which is
 *  NIM-charges-only by design, and the headline from grossNim alone. */
export function reportHeadline(totals: ShiftReportView['totals']) {
  const cashSales = totals.cashSales ?? 0
  const isFiat = totals.grossFiatMinor != null && Boolean(totals.fiatCurrency)
  const cashMinor = totals.byPaymentMethod?.cash.fiatMinor ?? 0
  return {
    sales: totals.confirmed + cashSales,
    cashSales,
    cashMinor,
    currency: totals.fiatCurrency ?? null,
    /** True when the headline is the fiat gross — the one figure that covers
     *  both payment methods. Without fiat the headline falls back to NIM,
     *  and the NIM/cash split line below it would only repeat itself. */
    isFiat,
    gross: isFiat
      ? `${(totals.grossFiatMinor! / 100).toFixed(2)} ${totals.fiatCurrency!}`
      : `${totals.grossNim} NIM`,
  }
}

/** The R12 rule — an amount and a count are never one glued string — as a
 *  helper: each part its own element, the dots only between them. */
export function dotted(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<span key={`d${i}`}> · </span>, part]))
}

/** The line under the headline: where the takings came from. The NIM figure
 *  is skipped when the headline is already that same NIM total. */
export function splitParts(totals: ShiftReportView['totals']): ReactNode[] {
  const { isFiat, sales, cashSales, cashMinor, currency } = reportHeadline(totals)
  const parts: ReactNode[] = []
  if (isFiat) parts.push(<span key="nim">{totals.grossNim} NIM</span>)
  if (cashSales > 0 && currency)
    parts.push(<span key="cash">{(cashMinor / 100).toFixed(2)} {currency} {t('cash')}</span>)
  parts.push(<span key="sales">{sales} {t('sales')}</span>)
  return parts
}

export function ReportSummary({ report }: { report: ShiftReportView }) {
  const { failed } = report.totals
  const head = reportHeadline(report.totals)
  const empty = head.sales === 0 && report.entries.length === 0
  return (
    <section className="form-card">
      {/* R12: never one concatenated string — the amount and the sale count
          are separate elements, which is what the audit's "glued together"
          screens were really complaining about. */}
      <p className="amt">{head.gross}</p>
      <p className="quiet">{dotted(splitParts(report.totals))}</p>
      {failed > 0 && <p className="quiet">{failed} {t('failed')}</p>}
      {empty && <p className="quiet">{t('No sales yet — takings will appear here.')}</p>}
      {report.fiatIncomplete && <p className="quiet">{t('Some sales had no exchange rate, so the fiat total is partial.')}</p>}
    </section>
  )
}

// A refund is marked up beyond its negative sign (§ spec: "not only by the
// sign") because a glance at a long list must not depend on reading a minus
// sign correctly. Only a CONFIRMED sale with no refund pointers of its own
// is refundable — an unconfirmed entry has no money to give back yet, and a
// refund cannot itself be refunded.
function isRefundEntry(e: ShiftEntry): boolean {
  return e.refundOfLocalNumber !== null || e.refundOfOccurredAt !== null
}

// `locked` only hides the "Refund" link — a convenience so a cashier under
// an active lock never taps something the server (POST .../refunds) is
// going to answer with 423 CASHIER_LOCKED anyway. Removing this prop would
// not reopen refunds; only DELETE /v1/me/cashier-lock does that.
export function EntryList({ entries, locked }: { entries: ShiftEntry[]; locked: boolean }) {
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

// Sold-by-product and NIM/cash split. Both are additive fields on
// ShiftReport — a report from before this feature (or a test double that
// doesn't bother stubbing them) simply renders neither section, never a
// crash.
export function ProductBreakdown({ report }: { report: ShiftReportView }) {
  if (!report.byProduct || report.byProduct.length === 0) return null
  // A bare "35.00" next to "Soda × 7" reads as a quantity or a NIM price;
  // every money figure on this screen names its currency (ruling Q2).
  const cur = report.totals.fiatCurrency ?? SUPPORTED_FIAT_CURRENCY
  return (
    <section className="form-card">
      <h2>{t('Sold by product')}</h2>
      <ul className="rows rows--plain">
        {report.byProduct.map(p => (
          <li key={p.name} className="row">
            <span className="row__title">{p.name} × {p.quantity}</span>
            <span className="row__amt">{(p.totalMinor / 100).toFixed(2)} {cur}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function PaymentSplit({ report }: { report: ShiftReportView }) {
  if (!report.totals.byPaymentMethod) return null
  const { nim, cash } = report.totals.byPaymentMethod
  const cur = report.totals.fiatCurrency ?? SUPPORTED_FIAT_CURRENCY
  // "sales" here counted transactions, not the items in them — the audit
  // read it as pieces sold. Say which one it is.
  const transactions = (n: number) => t('{n} transactions').replace('{n}', String(n))
  return (
    <section className="form-card">
      <h2>{t('By payment method')}</h2>
      <ul className="rows rows--plain">
        <li className="row">
          <span className="row__main">
            <span className="row__title">{t('NIM')}</span>
            <span className="row__sub">{transactions(nim.count)}</span>
          </span>
          <span className="row__amt">{(nim.fiatMinor / 100).toFixed(2)} {cur}</span>
        </li>
        <li className="row">
          <span className="row__main">
            <span className="row__title">{t('Cash')}</span>
            <span className="row__sub">{transactions(cash.count)}</span>
          </span>
          <span className="row__amt">{(cash.fiatMinor / 100).toFixed(2)} {cur}</span>
        </li>
      </ul>
      {report.cashEntries && report.cashEntries.length > 0 && (
        <ul className="rows rows--plain">
          {report.cashEntries.map(e => (
            <li key={e.saleId} className="row">
              <span className="row__main">
                <span className="row__sub">{t('Cash')} · {new Date(e.occurredAt).toLocaleTimeString()}</span>
                <span className="row__title">{e.reference ?? t('Cash sale')}</span>
              </span>
              <span className="row__amt">{(e.amountFiatMinor / 100).toFixed(2)} {cur}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface ExportState {
  download: (id: string, format: 'csv' | 'json') => Promise<void>
  exportPanel: { text: string; filename: string } | null
  copyExport: () => Promise<void>
  copyDone: boolean
  actionError: string | null
  exportPanelSection: ReactElement | null
}

// The wallet's webview has no download manager, so <a download> is a silent
// no-op there. Instead: try the OS share sheet first (this is what lets a
// vendor hand the file to their accountant), and if that is not available,
// show the text on screen so it can be copied by hand. Every branch that can
// fail sets actionError — a tap must never do nothing.
export function useExport(api: Api): ExportState {
  const [exportPanel, setExportPanel] = useState<{ text: string; filename: string } | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  return { download, exportPanel, copyExport, copyDone, actionError, exportPanelSection: exportPanelSection || null }
}

// R13: one "Export" tap-target, which opens the two ≥ 44 px format buttons.
// Two bare links side by side were the audit's complaint — they were both
// too small and too easy to hit by accident.
export function ExportButton({ id, download }: { id: string; download: (id: string, format: 'csv' | 'json') => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <p>
        <button className="link-btn" onClick={() => setOpen(true)}>{t('Export')}</button>
      </p>
    )
  }
  return (
    <div className="actions">
      <button onClick={() => download(id, 'csv')}>{t('Export CSV')}</button>
      <button onClick={() => download(id, 'json')}>{t('Export JSON')}</button>
    </div>
  )
}

// A past shift is its own read-only screen now (R15): History owns the list,
// this owns one report. Reading stays available offline (BR-P10 blocks
// accepting a payment, not looking at what already happened), so this screen
// deliberately never checks connectivity.
export function PastShiftReport({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<ShiftReportView | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [locked, setLocked] = useState(false)
  const { download, actionError, exportPanelSection } = useExport(api)

  useEffect(() => {
    if (!id) return
    setLoadError(false)
    setReport(null)
    void api.getShiftReport(id).then(setReport).catch(() => { setLoadError(true) })
    void api.getMe?.().then(me => setLocked(me.cashierLocked)).catch(() => {})
  }, [api, id])

  if (loadError) {
    return (
      <main>
        <p role="alert">{t('Could not load the shift. Check your connection and try again.')}</p>
      </main>
    )
  }
  if (!report) return <main><p className="quiet">{t('Loading…')}</p></main>

  return (
    <main>
      <p className="shift-who">{t('On the till')}: <strong>{report.shift.operatorLabel}</strong></p>
      <ReportSummary report={report} />
      <EntryList entries={report.entries} locked={locked} />
      <ProductBreakdown report={report} />
      <PaymentSplit report={report} />
      {actionError && <p role="alert">{actionError}</p>}
      {/* Export is one of the four gated operations (spec §5, GET
          .../export → 423 CASHIER_LOCKED). Hiding it while locked is
          convenience, not the guard — the server rejects the request
          regardless of whether this stayed on screen. */}
      {!locked && <ExportButton id={report.shift.id} download={(i, f) => void download(i, f)} />}
      {exportPanelSection}
      <p className="quiet">{t('NIMble tracks one station. Takings from another phone are not in this report.')}</p>
    </main>
  )
}
