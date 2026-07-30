import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { t } from '../i18n'
import { formatUsdValue } from '../lib/fiat'

export function History() {
  const { api } = useApp()
  const [items, setItems] = useState<HistoryItem[]>([])

  useEffect(() => {
    api.history().then(h => setItems(h.items)).catch(() => {})
  }, [api])

  return (
    <main>
      <h1>{t('History')}</h1>
      {items.length === 0 ? <p className="quiet">{t('No confirmed payments yet.')}</p> : (
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
      <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
    </main>
  )
}
