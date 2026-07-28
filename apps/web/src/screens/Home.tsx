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
        <h1>NIMblink</h1>
        <p>Pay or get paid with a 6-digit code.</p>
        <button onClick={() => { setError(null); login().catch(e => setError(String(e.message ?? e))) }}>
          Connect wallet
        </button>
        {error && <p role="alert">{error}</p>}
      </main>
    )
  }

  return (
    <main>
      <h1>NIMblink</h1>
      <nav className="home-actions">
        <Link to="/pay"><button>Pay</button></Link>
        <Link to="/charge"><button>Charge</button></Link>
      </nav>
      {recent.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul>
            {recent.map(r => (
              <li key={r.receiptId}>
                <Link to={`/receipt/${r.receiptId}`}>
                  {r.role === 'payer' ? 'Sent' : 'Received'} {String(r.snapshot.amountNim)} NIM
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p><Link to="/history">History</Link> · <Link to="/settings">Settings</Link></p>
    </main>
  )
}
