import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { Api, HistoryItem } from '../api/client'
import { copyText } from '../lib/copy'
import { t } from '../i18n'
import { receiptFiat } from '../lib/fiat'

export function Receipt({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const { id } = useParams<{ id: string }>()
  const [item, setItem] = useState<HistoryItem | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.history().then(h => setItem(h.items.find(i => i.receiptId === id) ?? null)).catch(() => {})
  }, [api, id])

  if (!item) return <main><p>{t('Loading receipt…')}</p></main>
  const s = item.snapshot
  const fiat = receiptFiat(s)
  const hash = String(s.hash ?? '')

  return (
    <main>
      <h1>{t('Receipt')}</h1>
      {Boolean(s.receiverBusinessName) && <p className="business-name">{String(s.receiverBusinessName)}</p>}
      <dl className="dl-rows">
        {Boolean(s.receiverTaxId) && (<><dt>{t('Tax ID')}</dt><dd>{String(s.receiverTaxId)}</dd></>)}
        <dt>{t('Direction')}</dt><dd>{item.role === 'payer' ? t('Sent') : t('Received')}</dd>
        <dt>{t('Amount')}</dt><dd>{String(s.amountNim)} NIM <small className="luna">({String(s.amountLuna)} luna)</small></dd>
        {fiat && (<>
          <dt>{t('Price')}</dt><dd>{fiat.price}</dd>
        </>)}
        {fiat?.settled && (<>
          <dt>{t('Value at confirmation')}</dt><dd>{fiat.settled}</dd>
        </>)}
        <dt>{t('Asset / network')}</dt><dd>{String(s.asset)} · {String(s.network)}</dd>
        <dt>{t('From')}</dt><dd>…{String(s.sender).slice(-4)}</dd>
        <dt>{t('To')}</dt><dd>…{String(s.recipient).slice(-4)}</dd>
        {Boolean(s.reference) && (<><dt>{t('Reference')}</dt><dd>{String(s.reference)}</dd></>)}
        <dt>{t('Confirmed')}</dt><dd>{new Date(String(s.confirmedAt)).toLocaleString()}</dd>
        <dt>{t('Transaction')}</dt>
        <dd className="hash-row">
          <a href={`https://test.nimiq.watch/#${hash}`} target="_blank" rel="noreferrer">
            …{hash.slice(-8)} ↗
          </a>
          <button className="chip" onClick={() => {
            void copyText(hash).then(ok => {
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
            })
          }}>
            {copied ? t('Copied') : t('Copy hash')}
          </button>
        </dd>
      </dl>
      {/* A receipt is the end of one job and the start of the next: the
          primary is whichever action this person would actually take again
          (R20), and "Done" simply goes home. */}
      <div className="actions">
        {item.role === 'payer'
          ? <Link to="/pay"><button className="primary">{t('New payment')}</button></Link>
          : <Link to="/charge"><button className="primary">{t('New charge')}</button></Link>}
        <Link to="/"><button>{t('Done')}</button></Link>
      </div>
    </main>
  )
}
