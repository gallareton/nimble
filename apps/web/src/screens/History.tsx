import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { t } from '../i18n'
import { formatUsdValue } from '../lib/fiat'

type Role = '' | 'payer' | 'receiver'

export function History() {
  const { api } = useApp()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role>('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({ cursor: null as string | null, loading: false, q: '', role: '' as Role })
  stateRef.current = { cursor, loading, q, role }

  const load = useCallback(async (reset: boolean) => {
    const st = stateRef.current
    if (st.loading) return
    if (!reset && st.cursor === null) return
    setLoading(true)
    try {
      const res = await api.history({
        cursor: reset ? undefined : st.cursor ?? undefined,
        q: st.q || undefined,
        role: st.role || undefined,
      })
      setItems(prev => reset ? res.items : [...prev, ...res.items])
      setCursor(res.nextCursor)
    } catch { /* keep whatever we have */ } finally {
      setLoading(false)
    }
  }, [api])

  // first page + reload on filter change (debounced for typing)
  useEffect(() => {
    const h = setTimeout(() => { void load(true) }, q ? 300 : 0)
    return () => clearTimeout(h)
  }, [q, role, load])

  // infinite scroll: fetch older rows when the sentinel becomes visible
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void load(false)
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [load])

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
          onChange={e => setQ(e.target.value)}
          placeholder={t('Search: reference, amount or date (e.g. 31.07.2026)')}
          aria-label={t('Search history')}
        />
        <div className="chips" role="group" aria-label={t('Direction')}>
          {([['', t('All')], ['payer', t('Sent')], ['receiver', t('Received')]] as const).map(([value, label]) => (
            <button key={value} className={`chip ${role === value ? 'chip--on' : ''}`}
              onClick={() => setRole(value)}>{label}</button>
          ))}
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <p className="quiet">{q || role ? t('Nothing matches your search.') : t('No confirmed payments yet.')}</p>
      ) : (
        <ul className="list">
          {items.map(r => (
            <li key={r.receiptId ?? r.sessionId} className={r.pending ? 'pending' : undefined}>
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
