import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { copyText } from '../lib/copy'

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
          <a href={`https://test.nimiq.watch/#${hash}`} target="_blank" rel="noreferrer">
            …{hash.slice(-8)} ↗
          </a>{' '}
          <button className="chip" onClick={() => {
            void copyText(hash).then(ok => {
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
            })
          }}>
            {copied ? 'Copied' : 'Copy hash'}
          </button>
        </dd>
      </dl>
      <p className="footer-nav"><Link to="/">Back to home</Link> · <Link to="/history">History</Link></p>
    </main>
  )
}
