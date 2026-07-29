import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nimToLuna } from '@nimble/shared'
import { useApp } from '../AppContext'
import { ApiError } from '../api/client'

// BLIK-style: the receiver fills in what they are asking for FIRST; the code
// is the last thing entered, and the payer gets the approval prompt the
// moment it is submitted — no second data-entry step on this side.
export function Charge() {
  const { api } = useApp()
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    let amountLuna: string
    try {
      amountLuna = nimToLuna(amount).toString()
    } catch {
      setError('Enter a valid NIM amount (max 5 decimals).')
      return
    }
    setBusy(true)
    try {
      const res = await api.claim(code.replace(/\s/g, ''), { amountLuna, reference: reference || undefined })
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError('Too many attempts. Wait a moment.')
      else setError('Code unavailable. Check and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header className="top-bar">
        <Link to="/" className="back" aria-label="Back to home">‹ Home</Link>
        <h1>Charge</h1>
      </header>
      <div className="form-card">
      <label>
        Amount (NIM)
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2.5" />
      </label>
      <label>
        Reference
        <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
      </label>
      <label>
        Code from the payer
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
    </main>
  )
}
