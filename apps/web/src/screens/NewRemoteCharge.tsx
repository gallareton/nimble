import { useCallback, useEffect, useState } from 'react'
import { lunaToNim, nimToLuna, SUPPORTED_FIAT_CURRENCY } from '@nimble/shared'
import type { OutstandingBill } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { formatUsd, useUsdRate } from '../lib/fiat'
import { copyText } from '../lib/copy'
import { remoteChargeUrl } from '../lib/host'
import { toMinorUnits } from './Charge'

type Unit = 'USD' | 'NIM'
const UNIT_KEY = 'nimble.charge.unit'

function loadUnit(): Unit {
  try { return localStorage.getItem(UNIT_KEY) === 'NIM' ? 'NIM' : 'USD' } catch { return 'USD' }
}

function saveUnit(unit: Unit) {
  try { localStorage.setItem(UNIT_KEY, unit) } catch { /* private mode */ }
}

/** A bill for a payer who isn't at the counter: no code, no immediate pairing —
 *  the vendor prices it, gets back a link good for a day, and hands that link
 *  over however works (chat, a QR they photograph, reading it aloud). Kept out
 *  of Charge.tsx on purpose: that screen's whole shape is built around a code
 *  entered by a payer standing right there, on a 120-second window. Wedging a
 *  second, code-less, day-long flow into it would mean conditioning half its
 *  fields and running two lifecycles in the app's already most complex screen. */
export function NewRemoteCharge(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('NewRemoteCharge needs api via props or AppProvider')
  const [unit, setUnit] = useState<Unit>(loadUnit)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [bills, setBills] = useState<OutstandingBill[] | null>(null)

  // A vendor who cannot see what they issued cannot correct a mistake: a bill
  // typed wrong would stay payable for its full day. Loaded on entry and after
  // every change, not polled — nobody else can add to this list.
  const loadBills = useCallback(() => {
    void api.getOutstandingBills?.().then(r => setBills(r.bills)).catch(() => setBills(null))
  }, [api])
  useEffect(loadBills, [loadBills])

  const cancelBill = async (id: string) => {
    setError(null)
    try {
      await api.cancelChargeRequest?.(id)
    } catch {
      // Most likely someone opened it in the meantime; reloading shows the truth.
      setError(t('Could not cancel that bill. Someone may already be paying it.'))
    }
    loadBills()
  }
  const usdRate = useUsdRate(api)

  const chooseUnit = (next: Unit) => {
    setUnit(next)
    saveUnit(next)
  }

  const approx = (() => {
    const n = Number(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return null
    if (unit === 'USD') return usdRate ? `≈ ${(n / usdRate).toFixed(5)} NIM` : null
    return formatUsd(n, usdRate)
  })()

  const submit = async () => {
    setError(null)
    setCopied(false)

    if (unit === 'USD') {
      const fiatAmountMinor = toMinorUnits(amount)
      if (fiatAmountMinor === null) {
        setError(t('Enter a valid amount (max 2 decimals).'))
        return
      }
      setBusy(true)
      try {
        const res = await api.createChargeRequest(
          { fiatAmountMinor, fiatCurrency: SUPPORTED_FIAT_CURRENCY, reference: reference || undefined })
        setCreated(res)
      loadBills()
      } catch (e) {
        if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
        else if (e instanceof ApiError && e.code === 'NO_RATE') setError(t('No exchange rate available right now. Try again shortly.'))
        else setError(t('Could not create the bill. Check your connection and try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    let amountLuna: string
    try {
      // Same comma-normalisation as Charge.tsx — five of our six locales use
      // a comma decimal separator, and a phone keypad emits one.
      const luna = nimToLuna(amount.replace(',', '.'))
      if (luna <= 0n) throw new RangeError('non-positive NIM amount')
      amountLuna = luna.toString()
    } catch {
      setError(t('Enter a valid NIM amount (max 5 decimals).'))
      return
    }
    setBusy(true)
    try {
      const res = await api.createChargeRequest({ amountLuna, reference: reference || undefined })
      setCreated(res)
      loadBills()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
      else setError(t('Could not create the bill. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  // Which of the two links was copied last, so the button that was pressed is
  // the one that says "Copied" — a single shared flag would light up both.
  const copyLink = async () => {
    if (!created) return
    const ok = await copyText(remoteChargeUrl(created.id))
    if (ok) setCopied(true)
    else setError(t('Could not copy the export. Select the text and copy it manually.'))
  }

  if (created) {
    const url = remoteChargeUrl(created.id)
    return (
      <main>
        <section className="form-card export-panel">
          <p className="quiet">{t('Share this link with the payer.')}</p>
          <textarea id="remote-charge-link" className="export-textarea" readOnly value={url} />
          <div className="actions">
            <button aria-label={t('Copy the link')} onClick={() => void copyLink()}>
              {copied ? t('Copied') : t('Copy')}
            </button>
          </div>

        </section>
      </main>
    )
  }

  return (
    <main>
      <div className="form-card">
        <div className="chips" role="group" aria-label={t('Pricing unit')}>
          <button type="button" className={`chip ${unit === 'USD' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'USD'} onClick={() => chooseUnit('USD')}>{t('USD')}</button>
          <button type="button" className={`chip ${unit === 'NIM' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'NIM'} onClick={() => chooseUnit('NIM')}>{t('NIM')}</button>
        </div>
        <label>
          {unit === 'USD' ? t('Amount (USD)') : t('Amount (NIM)')}
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder={unit === 'USD' ? '2.50' : '2.5'} />
          {approx !== null && <span className="quiet">{approx}</span>}
        </label>
        <label>
          {t('Reference')}
          <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
        </label>
        <button className="primary" onClick={() => void submit()} disabled={busy || !amount}>
          {t('Create bill')}
        </button>
      </div>
      {bills && bills.length > 0 && (
          <section className="list-card">
            <h2>{t('Bills waiting to be paid')}</h2>
            <ul className="list">
              {bills.map(b => (
                <li key={b.id}>
                  <span className="dir">
                    {b.fiatAmountMinor !== null && b.fiatCurrency
                      ? `${(b.fiatAmountMinor / 100).toFixed(2)} ${b.fiatCurrency}`
                      : `${lunaToNim(BigInt(b.amountLuna))} NIM`}
                    {b.reference ? ` · ${b.reference}` : ''}<br />
                    <small className="quiet">
                      {t('Expires')} {new Date(b.expiresAt).toLocaleString()}
                    </small>
                  </span>
                  <button onClick={() => void cancelBill(b.id)}>{t('Cancel')}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
