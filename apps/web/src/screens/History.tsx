import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { Api, HistoryItem } from '../api/client'
import { t } from '../i18n'
import { formatUsdValue } from '../lib/fiat'

const FILTERS_KEY = 'nimble:historyFilters'
const POLL_MS = 5000
const key = (i: HistoryItem) => i.sessionId ?? i.receiptId ?? ''

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
  const hasFilters = Boolean(q || role || from || to)

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
  useEffect(() => {
    if (!hasPending) return
    const h = setInterval(() => {
      void api.history(query()).then(res => {
        setItems(prev => {
          const fresh = res.items
          const freshKeys = new Set(fresh.map(key))
          return [...fresh, ...prev.filter(i => !freshKeys.has(key(i)))]
        })
      }).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(h)
  }, [hasPending, api])

  return (
    <main>
      <header className="top-bar">
        <Link to="/" className="back" aria-label={t('Back to home')}>‹ {t('Home')}</Link>
        <h1>{t('History')}</h1>
      </header>

      <div className="filters">
        <input
          type="search"
          value={q}
          onChange={e => setFilter({ q: e.target.value })}
          placeholder={t('Search by reference or amount')}
          aria-label={t('Search history')}
        />
        <div className="dates">
          <label>{t('From')}
            <input type="date" value={from} max={to || undefined}
              onChange={e => setFilter({ from: e.target.value })} />
          </label>
          <label>{t('To')}
            <input type="date" value={to} min={from || undefined}
              onChange={e => setFilter({ to: e.target.value })} />
          </label>
        </div>
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
              <Link to={r.pending ? `/session/${r.sessionId}` : `/receipt/${r.receiptId}`}>
                <span className="dir">{r.role === 'payer' ? t('Sent') : t('Received')}
                  {r.snapshot.reference ? ` · ${String(r.snapshot.reference)}` : ''}<br />
                  {r.pending ? t('Paid — finalizing…') : new Date(r.createdAt).toLocaleString()}</span>
                <span className="amt">{String(r.snapshot.amountNim)} NIM
                  {typeof r.snapshot.amountUsd === 'number' &&
                    <small className="fiat">{formatUsdValue(r.snapshot.amountUsd)}</small>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinelRef} aria-hidden />
      {loading && <p className="quiet center">{t('Loading…')}</p>}
    </main>
  )
}
