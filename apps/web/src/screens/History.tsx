import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'

export function History() {
  const { api } = useApp()
  const [items, setItems] = useState<HistoryItem[]>([])

  useEffect(() => {
    api.history().then(h => setItems(h.items)).catch(() => {})
  }, [api])

  return (
    <main>
      <h1>History</h1>
      {items.length === 0 ? <p>No confirmed payments yet.</p> : (
        <ul>
          {items.map(r => (
            <li key={r.receiptId}>
              <Link to={`/receipt/${r.receiptId}`}>
                {r.role === 'payer' ? 'Sent' : 'Received'} {String(r.snapshot.amountNim)} NIM
                {r.snapshot.reference ? ` — ${String(r.snapshot.reference)}` : ''}
                {' · '}{new Date(r.createdAt).toLocaleString()}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p><Link to="/">Home</Link></p>
    </main>
  )
}
