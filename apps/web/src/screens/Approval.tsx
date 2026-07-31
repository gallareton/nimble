import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TERMINAL_STATES, lunaToNim, type SessionView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import { Countdown } from '../components/Countdown'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { t } from '../i18n'
import { describeError } from '../lib/errors'
import { formatUsd, useUsdRate } from '../lib/fiat'
import { WalletError, type WalletProvider } from '../wallet/types'
import type { Api } from '../api/client'
import { uuid } from '../lib/uuid'

// Role-aware session screen: payer sees the approval flow (spec §5.2),
// receiver sees neutral status. Props are injectable for tests; the app
// passes context values.
export function Approval(props: { api?: Api; wallet?: WalletProvider }) {
  const ctx = useAppOptional()
  // NOTE: all hooks stay above the early returns below
  const api = props.api ?? ctx?.api
  const wallet = props.wallet ?? ctx?.wallet
  if (!api || !wallet) throw new Error('Approval needs api+wallet via props or AppProvider')
  const usdRate = useUsdRate(api)
  const { id } = useParams<{ id: string }>()
  const [view, setView] = useState<SessionView | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const hashRef = useRef<{ hash: string; idemKey: string } | null>(null)

  const refresh = useCallback(() => {
    if (id) api.getSession(id).then(setView).catch(() => {})
  }, [api, id])

  useEffect(() => {
    refresh()
    let close: (() => void) | undefined
    if (id) void api.openEvents(id, () => refresh()).then(c => { close = c })
    return () => close?.()
  }, [api, id, refresh])

  if (!view) return <main><p>{t('Loading…')}</p></main>

  const confirm = async () => {
    if (!view.charge) return
    setBusy(true)
    setNotice(null)
    try {
      const intent = await api.intent(view.charge.chargeId)
      const { hash } = await wallet.sendTransaction({
        recipient: intent.recipientAddress,
        valueLuna: BigInt(intent.amountLuna),
        data: intent.reconciliationToken,
      })
      hashRef.current = { hash, idemKey: uuid() }
      await api.registerTx(view.charge.chargeId, hash, hashRef.current.idemKey)
      refresh()
    } catch (e) {
      if (e instanceof WalletError && e.code === 'PERMISSION_DENIED') {
        await api.reject(view.charge.chargeId).catch(() => {})
        setNotice(t('Payment cancelled.'))
        refresh()
      } else {
        setNotice(describeError(e))
      }
    } finally {
      setBusy(false)
    }
  }

  const retryRegister = async () => {
    if (!view.charge || !hashRef.current) return
    await api.registerTx(view.charge.chargeId, hashRef.current.hash, hashRef.current.idemKey).catch(() => {})
    refresh()
  }

  const rejectCharge = async () => {
    if (!view.charge) return
    await api.reject(view.charge.chargeId).catch(() => {})
    setNotice(t('Payment cancelled.'))
    refresh()
  }

  const cancelSession = async () => {
    if (!id) return
    await api.cancel(id).catch(() => {})
    refresh()
  }

  const isPayer = view.role === 'payer'
  // Product-wise the payment is done at inclusion (CONFIRMING): the user
  // gets closure immediately; macro-block finality and the receipt land in
  // the background.
  const settled = view.status === 'CONFIRMING' || TERMINAL_STATES.has(view.status)

  return (
    <main>
      <h1>{isPayer ? t('Payment') : t('Charge status')}</h1>
      <p><StatusBadge status={view.status} />{' '}
        {!settled && <Spinner />}</p>
      {view.status === 'CONFIRMING' && (
        <p className="quiet">{t('Finalizing in the background — the receipt will appear in History shortly.')}</p>
      )}

      {isPayer && view.status === 'AWAITING_PAYER_APPROVAL' && view.charge && view.counterpart && (
        <section aria-label="approval" className="sheet">
          <div>
            <p className="quiet"><strong>{view.counterpart.displayName}</strong> <em>{t('(Unverified profile)')}</em> asks for</p>
            <p className="amount">{lunaToNim(BigInt(view.charge.amountLuna))} NIM
              <small>{view.charge.amountLuna} luna</small>
              {formatUsd(Number(lunaToNim(BigInt(view.charge.amountLuna))), usdRate) &&
                <small>{formatUsd(Number(lunaToNim(BigInt(view.charge.amountLuna))), usdRate)}</small>}</p>
            {view.charge.reference && <p className="quiet"><span>{view.charge.reference}</span></p>}
          </div>
          <dl>
            <dt>{t('Recipient wallet')}</dt>
            <dd>…{view.counterpart.addressTail}</dd>
            <dt>{t('Asset / network')}</dt>
            <dd>NIM · Nimiq</dd>
            <dt>{t('Network fee')}</dt>
            <dd>{t('shown by wallet on confirmation')}</dd>
          </dl>
          {view.payerCanCover === false && (
            <p role="alert">{t('Not enough NIM in your wallet for this amount.')}</p>
          )}
          <div className="actions">
            <button onClick={rejectCharge} disabled={busy}>{t('Reject')}</button>
            <button className="primary" onClick={confirm}
              disabled={busy || view.payerCanCover === false}>{t('Confirm')}</button>
          </div>
        </section>
      )}

      {isPayer && view.status === 'AWAITING_WALLET_AUTH' && (
        <section className="sheet">
          {hashRef.current ? (
            <button className="primary" onClick={retryRegister}>{t('Finish registration')}</button>
          ) : (
            <p className="quiet">{t('If you approved the payment in your wallet, it will be matched automatically.')}</p>
          )}
          <button onClick={rejectCharge} disabled={busy}>{t('Start over')}</button>
        </section>
      )}

      {!isPayer && (
        <section className="sheet">
          {view.charge && <p className="amount">{lunaToNim(BigInt(view.charge.amountLuna))} NIM
            {view.charge.reference ? <small>{view.charge.reference}</small> : null}
            {formatUsd(Number(lunaToNim(BigInt(view.charge.amountLuna))), usdRate) &&
              <small>{formatUsd(Number(lunaToNim(BigInt(view.charge.amountLuna))), usdRate)}</small>}</p>}
          {!['CONFIRMING', 'CONFIRMED'].includes(view.status) && !TERMINAL_STATES.has(view.status) &&
            <p><strong>{t('Do not release goods before it says Paid.')}</strong></p>}
          {view.status === 'CLAIMED' && view.chargeDeadlineAt && (
            <p>Submit the charge within <Countdown until={view.chargeDeadlineAt} /></p>
          )}
          {(view.status === 'CLAIMED' || view.status === 'AWAITING_PAYER_APPROVAL') && (
            <button onClick={cancelSession}>{t('Cancel')}</button>
          )}
        </section>
      )}

      {view.transaction && (
        <p className="quiet"><small>tx …{view.transaction.hash.slice(-8)}</small></p>
      )}
      {notice && <p role="alert">{notice}</p>}
      {settled && (
        <nav aria-label="after payment">
          <p className="footer-nav"><Link to="/">{t('Back to home')}</Link> · <Link to="/history">{t('History')}</Link></p>
        </nav>
      )}
    </main>
  )
}
