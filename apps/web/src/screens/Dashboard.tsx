import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardView } from '@nimble/shared'
import { SUPPORTED_FIAT_CURRENCY } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { t } from '../i18n'
import { usePoll } from '../lib/usePoll'

// Same cents→text idea as Charge.tsx's own formatMinor — money is an
// integer everywhere until the moment it is rendered.
function formatMinor(minor: number): string {
  return (minor / 100).toFixed(2)
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// The API reads a UTC calendar day (see routes/dashboard.ts's dayRangeUtc);
// stepping by a day here has to agree with that, not with the viewer's own
// timezone, or "yesterday" on the API and "yesterday" on screen would drift
// apart for anyone not on UTC.
function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC' })
}

const POLL_MS = 10000

// The owner's read-only summary of a day: today's gross, what's still
// awaiting payment, who's on the till, the cash/NIM split, top products, and
// a breakdown by shift operator. Available while the cashier lock is on —
// this only ever reads, never gates an operation the way refunds/export/
// close do. AppShell supplies the header (title + "‹" to /) and the tab
// bar — this screen renders no header or back link of its own.
export function Dashboard(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Dashboard needs api via props or AppProvider')

  const [day, setDay] = useState<string>(todayUtc)
  const [view, setView] = useState<DashboardView | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setLoadError(false)
    void api.getDashboard?.(day).then(setView).catch(() => setLoadError(true))
  }, [api, day])

  // Refresh only while there's something that can change on its own without
  // this screen doing anything — money coming in via `awaiting`, or a shift
  // someone else might close. A quiet day with no shift open costs nothing.
  usePoll(
    () => { void api.getDashboard?.(day).then(setView).catch(() => {}) },
    POLL_MS,
    Boolean(view && (view.awaiting.length > 0 || view.openShift !== null)),
  )

  const isToday = day === todayUtc()

  if (loadError) {
    return <main><p role="alert">{t('Could not load the dashboard. Check your connection and try again.')}</p></main>
  }

  if (!view) return <main />

  const isEmptyDay = view.salesCount === 0 && view.refundsCount === 0 && view.awaiting.length === 0
    && view.outstandingBills === 0 && view.openShift === null

  return (
    <main>
      <section className="form-card">
        <div className="dash-day-nav">
          <button type="button" onClick={() => setDay(d => shiftDay(d, -1))}>‹ {t('day')}</button>
          <span className="quiet">{formatDay(day)}</span>
          <button type="button" disabled={isToday} onClick={() => setDay(d => shiftDay(d, 1))}>{t('day')} ›</button>
        </div>
        {isEmptyDay ? (
          <p className="quiet">{t('Nothing recorded for this day yet.')}</p>
        ) : (
          <>
            {/* A bare number is not money: name the currency (ruling Q2). */}
            <p className="amt">{formatMinor(view.grossFiatMinor)} {SUPPORTED_FIAT_CURRENCY}</p>
            <p className="quiet">{view.grossNim} NIM · {view.salesCount} {t('sales')}</p>
            {view.refundsCount > 0 && (
              <p className="quiet">{view.refundsCount} {t('refunds')} · {view.refundedNim} NIM</p>
            )}
          </>
        )}
      </section>

      {view.awaiting.length > 0 && (
        <section className="form-card">
          <h2>{t('Awaiting payment')}</h2>
          <ul className="list">
            {view.awaiting.map(a => (
              <li key={a.saleId}>
                {a.sessionId ? (
                  <Link to={`/session/${a.sessionId}`}>
                    <span className="dir">{new Date(a.createdAt).toLocaleTimeString()}</span>
                    <span className="amt">{formatMinor(a.totalMinor)}</span>
                  </Link>
                ) : (
                  <span className="dir">{new Date(a.createdAt).toLocaleTimeString()} · {formatMinor(a.totalMinor)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.outstandingBills > 0 && (
        <p className="quiet">
          {t('{n} remote bills are still unpaid.').replace('{n}', String(view.outstandingBills))}
          {' '}
          <Link to="/charge/remote">{t("Bill someone who isn't here")}</Link>
        </p>
      )}

      <section className="form-card">
        <h2>{t('Who is working')}</h2>
        {view.openShift ? (
          <p>{view.openShift.operatorLabel} · {t('since')} {new Date(view.openShift.openedAt).toLocaleTimeString()}</p>
        ) : (
          <p className="quiet">{t('No shift open')} · <Link to="/shift">{t('Open a shift')}</Link></p>
        )}
      </section>

      {!isEmptyDay && (
        <section className="form-card">
          <h2>{t('Cash / NIM')}</h2>
          <p>{t('Cash')}: {view.byPaymentMethod.cash.count} · {formatMinor(view.byPaymentMethod.cash.fiatMinor)} {SUPPORTED_FIAT_CURRENCY}</p>
          <p>{t('NIM')}: {view.byPaymentMethod.nim.count} · {formatMinor(view.byPaymentMethod.nim.fiatMinor)} {SUPPORTED_FIAT_CURRENCY}</p>
        </section>
      )}

      {view.topProducts.length > 0 && (
        <section className="form-card">
          <h2>{t('Top products')}</h2>
          <ul className="rows rows--plain">
            {view.topProducts.map(p => (
              <li key={p.name} className="row">
                <span className="row__title">{p.name} × {p.quantity}</span>
                <span className="row__amt">{formatMinor(p.totalMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* "Wg operatora zmiany" — never "wg pracownika": grouped by
          shift.operator_label, the only identity a cashier has today. */}
      {view.byOperator.length > 0 && (
        <section className="form-card">
          <h2>{t('By shift operator')}</h2>
          <ul className="rows rows--plain">
            {view.byOperator.map(o => (
              <li key={o.operatorLabel ?? '(no shift)'} className="row">
                <span className="row__main">
                  <span className="row__title">{o.operatorLabel ?? t('No shift')}</span>
                  <span className="row__sub">{o.salesCount} {t('sales')}</span>
                </span>
                <span className="row__amt">{formatMinor(o.grossFiatMinor)} · {o.grossNim} NIM</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
