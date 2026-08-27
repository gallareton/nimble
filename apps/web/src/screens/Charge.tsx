import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { useUsdRate } from '../lib/fiat'

const FIAT_CURRENCY = 'USD'

/** '12.34' → 1234. Rejects more than two decimals rather than rounding money
 *  behind the cashier's back. */
export function toMinorUnits(input: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'))
  return minor > 0 ? minor : null
}

// BLIK-style: the receiver fills in what they are asking for FIRST; the code
// is the last thing entered, and the payer gets the approval prompt the
// moment it is submitted — no second data-entry step on this side. The
// cashier prices the sale in fiat; the server converts and freezes the quote.
export function Charge(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Charge needs api via props or AppProvider')
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usdRate = useUsdRate(api)

  const nimApprox = (() => {
    const usd = Number(amount.replace(',', '.'))
    return usdRate && Number.isFinite(usd) && usd > 0 ? usd / usdRate : null
  })()

  const submit = async () => {
    setError(null)
    const fiatAmountMinor = toMinorUnits(amount)
    if (fiatAmountMinor === null) {
      setError(t('Enter a valid amount (max 2 decimals).'))
      return
    }
    setBusy(true)
    try {
      const res = await api.claim(code.replace(/\s/g, ''),
        { fiatAmountMinor, fiatCurrency: FIAT_CURRENCY, reference: reference || undefined })
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
      else if (e instanceof ApiError && e.code === 'NO_RATE') setError(t('No exchange rate available right now. Try again shortly.'))
      else setError(t('Code unavailable. Check and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header className="top-bar">
        <Link to="/" className="back" aria-label={t('Back to home')}>‹ {t('Home')}</Link>
        <h1>{t('Charge')}</h1>
      </header>
      <div className="form-card">
      <label>
        {t('Amount (USD)')}
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2.50" />
        {nimApprox !== null && <span className="quiet">≈ {nimApprox.toFixed(5)} NIM</span>}
      </label>
      <label>
        {t('Reference')}
        <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
      </label>
      <label>
        {t('Code from the payer')}
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={e => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits)
          }}
          placeholder="123 456"
        />
      </label>
      <button className="primary" onClick={submit} disabled={busy || !amount || code.replace(/\s/g, '').length !== 6}>
        Request payment
      </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <Link to="/" className="back-bottom"><button>‹ {t('Back to home')}</button></Link>
    </main>
  )
}
