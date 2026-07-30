import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { copyText } from '../lib/copy'
import { t } from '../i18n'
import { formatUsdValue } from '../lib/fiat'

export function Receipt() {
  const { api } = useApp()
  const { id } = useParams<{ id: string }>()
  const [item, setItem] = useState<HistoryItem | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.history().then(h => setItem(h.items.find(i => i.receiptId === id) ?? null)).catch(() => {})
  }, [api, id])

  if (!item) return <main><p>{t('Loading receipt…')}</p></main>
  const s = item.snapshot
  const hash = String(s.hash ?? '')

  return (
    <main>
      <h1>{t('Receipt')}</h1>
      <dl>
        <dt>{t('Direction')}</dt><dd>{item.role === 'payer' ? t('Sent') : t('Received')}</dd>
        <dt>{t('Amount')}</dt><dd>{String(s.amountNim)} NIM <small>({String(s.amountLuna)} luna)</small></dd>
        {typeof s.amountUsd === 'number' && (<>
          <dt>{t('Value at confirmation')}</dt><dd>{formatUsdValue(s.amountUsd)}</dd>
        </>)}
        <dt>{t('Asset / network')}</dt><dd>{String(s.asset)} · {String(s.network)}</dd>
        <dt>{t('From')}</dt><dd>…{String(s.sender).slice(-4)}</dd>
        <dt>{t('To')}</dt><dd>…{String(s.recipient).slice(-4)}</dd>
        {Boolean(s.reference) && (<><dt>{t('Reference')}</dt><dd>{String(s.reference)}</dd></>)}
        <dt>{t('Confirmed')}</dt><dd>{new Date(String(s.confirmedAt)).toLocaleString()}</dd>
        <dt>{t('Transaction')}</dt>
        <dd>
          <a href={`https://test.nimiq.watch/#${hash}`} target="_blank" rel="noreferrer">
            …{hash.slice(-8)} ↗
          </a>{' '}
          <button className="chip" onClick={() => {
            void copyText(hash).then(ok => {
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
            })
          }}>
            {copied ? t('Copied') : t('Copy hash')}
          </button>
        </dd>
      </dl>
      <p className="footer-nav"><Link to="/">{t('Back to home')}</Link> · <Link to="/history">{t('History')}</Link></p>
    </main>
  )
}
