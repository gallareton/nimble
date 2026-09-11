import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { ShiftListItem } from '@nimble/shared'
import type { Api, HistoryItem } from '../api/client'
import { t } from '../i18n'
import { usePoll } from '../lib/usePoll'
import { FiatBadge, fiatAmount } from '../lib/fiat'

const FILTERS_KEY = 'nimble:historyFilters'
const POLL_MS = 5000
const key = (i: HistoryItem) => i.sessionId ?? i.receiptId ?? i.saleId ?? ''

export function History({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  // Filters live in the URL so opening a receipt and coming back keeps them;
  // the last set is remembered for entries that arrive without params.
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const role = params.get('role') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const view = params.get('view') === 'shifts' ? 'shifts' : 'transactions'
  const hasFilters = Boolean(q || role || from || to)
  // R19: the search box and the two date fields fold away behind one
  // "Filters" button. `null` = the vendor has not decided, so the block
  // follows whether anything is actually filtering; once they tap, their
  // choice wins.
  const [openFilters, setOpenFilters] = useState<boolean | null>(null)
  const activeFilters = [q, from, to].filter(Boolean).length
  const filtersOpen = openFilters ?? Boolean(q || from || to)
  const [shifts, setShifts] = useState<ShiftListItem[]>([])

  const [items, setItems] = useState<HistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({ cursor: null as string | null, loading: false, q, role, from, to })
  stateRef.current = { ...stateRef.current, cursor, loading, q, role, from, to }

  // Entering /history without params (e.g. the link on a receipt) restores
  // the filters last used, so browsing a single day survives detours.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (params.toString()) return
    const remembered = sessionStorage.getItem(FILTERS_KEY)
    if (remembered) setParams(new URLSearchParams(remembered), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setFilter = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
    sessionStorage.setItem(FILTERS_KEY, next.toString())
    setParams(next, { replace: true })
  }

  // A vendor with no closed shifts yet should see the empty line, not an
  // error state — an unavailable endpoint is simply an empty list.
  useEffect(() => {
    if (view !== 'shifts') return
    void (api.getShifts?.() ?? Promise.resolve([])).then(setShifts).catch(() => {})
  }, [api, view])

  const query = () => {
    const st = stateRef.current
    return { q: st.q || undefined, role: st.role || undefined,
      from: st.from || undefined, to: st.to || undefined }
  }

  const load = useCallback(async (reset: boolean) => {
    const st = stateRef.current
    if (st.loading) return
    if (!reset && st.cursor === null) return
    setLoading(true)
    try {
      const res = await api.history({ ...query(), cursor: reset ? undefined : st.cursor ?? undefined })
      setItems(prev => reset ? res.items : [...prev, ...res.items])
      setCursor(res.nextCursor)
    } catch { /* keep whatever we have */ } finally {
      setLoading(false)
    }
  }, [api])

  // first page + reload on filter change (debounced while typing)
  useEffect(() => {
    const h = setTimeout(() => { void load(true) }, q ? 300 : 0)
    return () => clearTimeout(h)
  }, [q, role, from, to, load])

  // infinite scroll: older rows as the sentinel comes into view
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void load(false)
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [load])

  // While a payment is still finalizing, refresh the top of the list so its
  // row turns into a finished receipt on its own. Merge by key — scrolled-in
  // older rows stay put.
  const hasPending = items.some(i => i.pending)
  usePoll(() => {
    void api.history(query()).then(res => {
      setItems(prev => {
        const fresh = res.items
        const freshKeys = new Set(fresh.map(key))
        return [...fresh, ...prev.filter(i => !freshKeys.has(key(i)))]
      })
    }).catch(() => {})
  }, POLL_MS, hasPending)

  return (
    <main>
      <div className="seg seg--wide" role="tablist" aria-label={t('History')}>
        <button type="button" role="tab" aria-selected={view === 'transactions'}
          onClick={() => setFilter({ view: '' })}>{t('Transactions')}</button>
        <button type="button" role="tab" aria-selected={view === 'shifts'}
          onClick={() => setFilter({ view: 'shifts' })}>{t('Shifts')}</button>
      </div>

      {view === 'shifts' ? (
        shifts.length === 0 ? (
          <p className="quiet">{t('No closed shifts yet.')}</p>
        ) : (
          <ul className="rows">
            {shifts.map(s => (
              <li key={s.id}>
                <Link className="row row--link" to={`/history/shifts/${s.id}`}>
                  <span className="row__main">
                    <span className="row__title">{new Date(s.openedAt).toLocaleDateString()}</span>
                    {/* Takings = NIM + cash, and a sale is a sale whichever
                        way it was paid — the list must say what the report
                        says (ruling Q1). Older rows carry neither field; they
                        fall back to the NIM-only figure rather than 0.00. */}
                    <span className="row__sub">
                      {s.operatorLabel} · {s.confirmed + (s.cashSales ?? 0)} {t('sales')}
                    </span>
                  </span>
                  <span className="row__amt">
                    {s.grossFiatMinor != null && s.fiatCurrency
                      ? `${(s.grossFiatMinor / 100).toFixed(2)} ${s.fiatCurrency}`
                      : `${s.grossNim} NIM`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (<>
      <div className="filters">
        <button className="link-btn" aria-expanded={filtersOpen}
          onClick={() => setOpenFilters(!filtersOpen)}>
          {t('Filters')}{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
        {filtersOpen && (<>
          <input
            type="search"
            value={q}
            onChange={e => setFilter({ q: e.target.value })}
            placeholder={t('Search by reference or amount')}
            aria-label={t('Search history')}
          />
          <div className="dates">
            {/* A native date input has no placeholder, so the label carries
                the hint about what an empty field actually means (R18). */}
            <label>
              <span>{t('From')}{!from && <span className="quiet"> · {t('any date')}</span>}</span>
              <input type="date" value={from} max={to || undefined}
                onChange={e => setFilter({ from: e.target.value })} />
            </label>
            <label>
              <span>{t('To')}{!to && <span className="quiet"> · {t('today')}</span>}</span>
              <input type="date" value={to} min={from || undefined}
                onChange={e => setFilter({ to: e.target.value })} />
            </label>
          </div>
        </>)}
        <div className="chips" role="group" aria-label={t('Direction')}>
          {([['', t('All')], ['payer', t('Sent')], ['receiver', t('Received')]] as const).map(([value, label]) => (
            <button key={value} className={`chip ${role === value ? 'chip--on' : ''}`}
              onClick={() => setFilter({ role: value })}>{label}</button>
          ))}
          {hasFilters && (
            <button className="chip"
              onClick={() => setFilter({ q: '', role: '', from: '', to: '' })}>{t('Clear')}</button>
          )}
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <p className="quiet">{hasFilters ? t('Nothing matches your search.') : t('No confirmed payments yet.')}</p>
      ) : (
        <ul className="list">
          {items.map(r => (
            <li key={key(r)} className={r.pending ? 'pending' : undefined}>
              {r.kind === 'cash' ? (
                <span className="list__static">
                  <span className="dir"><span className="cash-tag">{t('Cash')}</span>
                    {r.snapshot.reference ? ` · ${String(r.snapshot.reference)}` : ''}<br />
                    {new Date(r.createdAt).toLocaleString()}</span>
                  <span className="amt">{fiatAmount(r)}</span>
                </span>
              ) : (
              <Link to={r.pending ? `/session/${r.sessionId}` : `/receipt/${r.receiptId}`}>
                <span className="dir">{r.role === 'payer' ? t('Sent') : t('Received')}
                  {r.snapshot.reference ? ` · ${String(r.snapshot.reference)}` : ''}<br />
                  {r.pending ? t('Paid — finalizing…') : new Date(r.createdAt).toLocaleString()}</span>
                <span className="amt">{String(r.snapshot.amountNim)} NIM
                  <FiatBadge snapshot={r.snapshot} /></span>
              </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinelRef} aria-hidden />
      {loading && <p className="quiet center">{t('Loading…')}</p>}
      </>)}
    </main>
  )
}
