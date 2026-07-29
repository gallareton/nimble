import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'

export function Receipt() {
  const { api } = useApp()
  const { id } = useParams<{ id: string }>()
  const [item, setItem] = useState<HistoryItem | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.history().then(h => setItem(h.items.find(i => i.receiptId === id) ?? null)).catch(() => {})
  }, [api, id])

  if (!item) return <main><p>Loading receipt…</p></main>
  const s = item.snapshot
  const hash = String(s.hash ?? '')

  return (
    <main>
      <h1>Receipt</h1>
      <dl>
        <dt>Direction</dt><dd>{item.role === 'payer' ? 'Sent' : 'Received'}</dd>
        <dt>Amount</dt><dd>{String(s.amountNim)} NIM <small>({String(s.amountLuna)} luna)</small></dd>
        <dt>Asset / network</dt><dd>{String(s.asset)} · {String(s.network)}</dd>
        <dt>From</dt><dd>…{String(s.sender).slice(-4)}</dd>
        <dt>To</dt><dd>…{String(s.recipient).slice(-4)}</dd>
        {Boolean(s.reference) && (<><dt>Reference</dt><dd>{String(s.reference)}</dd></>)}
        <dt>Confirmed</dt><dd>{new Date(String(s.confirmedAt)).toLocaleString()}</dd>
        <dt>Transaction</dt>
        <dd>
          …{hash.slice(-8)}{' '}
          <button onClick={() => { void navigator.clipboard?.writeText(hash); setCopied(true) }}>
            {copied ? 'Copied' : 'Copy hash'}
          </button>
        </dd>
      </dl>
      <p><Link to="/">Back to home</Link> · <Link to="/history">History</Link></p>
    </main>
  )
}
