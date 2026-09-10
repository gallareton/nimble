import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { nimToLuna } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { t } from '../i18n'
import { uuid } from '../lib/uuid'

/** What Shift.tsx hands over via router state when it links here: the report
 *  entry's own rendering of the sale, so this screen never has to fetch the
 *  charge again (there is no GET-one-charge endpoint, and none is needed —
 *  the report already had everything this screen shows). */
interface RefundLocationState {
  amountNim?: string
  reference?: string | null
}

/** A refund is a normal payment run backward — the vendor signs it in their
 *  wallet exactly like any charge. So this screen only ever *creates* the
 *  refund; it hands the vendor off to the existing Approval screen
 *  (/session/:id) to sign, rather than building a second signing screen.
 *  See private/docs/specs/2026-09-08-refunds.md §4, §6: unlike a sale, a
 *  refund is the vendor's own initiative with nobody on the other side
 *  checking it before it goes out — that is why this screen has to say the
 *  irreversibility out loud rather than leaving it implied. */
export function Refund(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Refund needs api via props or AppProvider')
  const { chargeId } = useParams<{ chargeId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const original = (location.state ?? {}) as RefundLocationState
  const originalAmountNim = original.amountNim ?? null

  const [amount, setAmount] = useState(originalAmountNim ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!chargeId) return
    setError(null)

    let amountLuna: string
    try {
      const luna = nimToLuna(amount.replace(',', '.'))
      if (luna <= 0n) throw new RangeError('non-positive NIM amount')
      amountLuna = luna.toString()
    } catch {
      setError(t('Enter a valid NIM amount (max 5 decimals).'))
      return
    }

    // Client-side convenience only, not a security boundary — the server
    // re-checks the running total of every refund against the original
    // charge, under a row lock, because two concurrent refunds could each
    // pass a client-side check like this one and together over-refund.
    if (originalAmountNim !== null) {
      try {
        if (nimToLuna(amount.replace(',', '.')) > nimToLuna(originalAmountNim)) {
          setError(t('The refund cannot be more than the original amount.'))
          return
        }
      } catch { /* already reported above */ }
    }

    setBusy(true)
    try {
      const res = await api.createRefund(chargeId, { amountLuna, reason: reason || undefined }, uuid())
      navigate(`/session/${res.sessionId}`)
    } catch {
      setError(t('Could not create the refund. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <div className="form-card">
        {originalAmountNim !== null && (
          <p className="amt">{originalAmountNim} NIM</p>
        )}
        {original.reference && <p className="quiet">{original.reference}</p>}
        <label>
          {t('Amount to refund (NIM)')}
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2.5" />
        </label>
        <label>
          {t('Reason (optional)')}
          <input value={reason} maxLength={100} onChange={e => setReason(e.target.value)} />
        </label>
        <p><strong>{t('This cannot be undone once you sign it in your wallet.')}</strong></p>
        {error && <p role="alert">{error}</p>}
        <button className="primary" onClick={() => void submit()} disabled={busy || !amount}>
          {t('Send refund')}
        </button>
      </div>
    </main>
  )
}
