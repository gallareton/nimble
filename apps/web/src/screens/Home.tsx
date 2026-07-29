import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'

export function Home() {
  const { api, token, login } = useApp()
  const [recent, setRecent] = useState<HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.history().then(h => setRecent(h.items.slice(0, 3))).catch(() => {})
  }, [api, token])

  if (!token) {
    return (
      <main>
        <div className="hero">
          <h1 className="brand">Nim<em>ble</em></h1>
          <p>Pay or get paid with a 6-digit code.</p>
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
          Pay<span className="sub" aria-hidden>show a code</span></button></Link>
        <Link to="/charge"><button aria-label="Charge">
          Charge<span className="sub" aria-hidden>enter a code</span></button></Link>
      </nav>
      {recent.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul className="list">
            {recent.map(r => (
              <li key={r.receiptId}>
                <Link to={`/receipt/${r.receiptId}`}>
                  <span className="dir">{r.role === 'payer' ? 'Sent' : 'Received'}</span>
                  <span className="amt">{String(r.snapshot.amountNim)} NIM</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="footer-nav"><Link to="/history">History</Link> · <Link to="/settings">Settings</Link></p>
    </main>
  )
}
