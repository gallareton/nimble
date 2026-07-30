import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { Landing } from '../components/Landing'
import { inNimiqPay } from '../lib/host'
import { t } from '../i18n'
import { formatUsdValue } from '../lib/fiat'

export function Home() {
  const { api, token, login } = useApp()
  const [recent, setRecent] = useState<HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.history().then(h => setRecent(h.items.slice(0, 3))).catch(() => {})
  }, [api, token])

  if (!token) {
    if (!inNimiqPay()) return <Landing />
    return (
      <main>
        <div className="hero">
          <h1 className="brand">Nim<em>ble</em></h1>
          <p>{t('Pay or get paid with a 6-digit code.')}</p>
          <button className="primary" onClick={() => { setError(null); login().catch(e => setError(String(e.message ?? e))) }}>
            Connect wallet
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 className="brand">Nim<em>ble</em></h1>
      <nav className="home-actions">
        <Link to="/pay"><button className="primary" aria-label="Pay">
          {t('Pay')}<span className="sub" aria-hidden>{t('show a code')}</span></button></Link>
        <Link to="/charge"><button aria-label="Charge">
          {t('Charge')}<span className="sub" aria-hidden>{t('enter a code')}</span></button></Link>
      </nav>
      {recent.length > 0 && (
        <section>
          <h2>{t('Recent')}</h2>
          <ul className="list">
            {recent.map(r => (
              <li key={r.receiptId}>
                <Link to={`/receipt/${r.receiptId}`}>
                  <span className="dir">{r.role === 'payer' ? t('Sent') : t('Received')}
                    {r.snapshot.reference ? ` · ${String(r.snapshot.reference)}` : ''}</span>
                  <span className="amt">{String(r.snapshot.amountNim)} NIM
                    {typeof r.snapshot.amountUsd === 'number' &&
                      <small className="fiat">{formatUsdValue(r.snapshot.amountUsd)}</small>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="footer-nav"><Link to="/history">{t('History')}</Link> · <Link to="/settings">{t('Settings')}</Link></p>
    </main>
  )
}
