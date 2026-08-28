import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nimToLuna, SUPPORTED_FIAT_CURRENCY } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { formatUsd, useUsdRate } from '../lib/fiat'

type Unit = 'USD' | 'NIM'
const UNIT_KEY = 'nimble.charge.unit'

function loadUnit(): Unit {
  try { return localStorage.getItem(UNIT_KEY) === 'NIM' ? 'NIM' : 'USD' } catch { return 'USD' }
}

function saveUnit(unit: Unit) {
  try { localStorage.setItem(UNIT_KEY, unit) } catch { /* private mode */ }
}

/** '12.34' → 1234. Rejects more than two decimals rather than rounding money
 *  behind the cashier's back. */
export function toMinorUnits(input: string): number | null {
  // Bounded to 9 major-unit digits — a till will never exceed $999,999,999,
  // and it keeps the intermediate well clear of 2^53.
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(input.trim())
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
  const [unit, setUnit] = useState<Unit>(loadUnit)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    if (unit === 'USD') {
      const fiatAmountMinor = toMinorUnits(amount)
      if (fiatAmountMinor === null) {
        setError(t('Enter a valid amount (max 2 decimals).'))
        return
      }
      setBusy(true)
      try {
        const res = await api.claim(code.replace(/\s/g, ''),
          { fiatAmountMinor, fiatCurrency: SUPPORTED_FIAT_CURRENCY, reference: reference || undefined })
        navigate(`/session/${res.sessionId}`)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
        else if (e instanceof ApiError && e.code === 'NO_RATE') setError(t('No exchange rate available right now. Try again shortly.'))
        else setError(t('Code unavailable. Check and try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    let amountLuna: string
    try {
      amountLuna = nimToLuna(amount).toString()
    } catch {
      setError(t('Enter a valid NIM amount (max 5 decimals).'))
      return
    }
    setBusy(true)
    try {
      const res = await api.claim(code.replace(/\s/g, ''), { amountLuna, reference: reference || undefined })
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
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
