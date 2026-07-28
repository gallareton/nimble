import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nimToLuna } from '@nimblink/shared'
import { useApp } from '../AppContext'
import { ApiError } from '../api/client'

export function Charge() {
  const { api } = useApp()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)

  const claim = async () => {
    setError(null)
    try {
      const res = await api.claim(code.replace(/\s/g, ''))
      setSessionId(res.sessionId)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError('Too many attempts. Wait a moment.')
      else setError('Code unavailable. Check and try again.')
    }
  }

  const submit = async () => {
    setError(null)
    let amountLuna: string
    try {
      amountLuna = nimToLuna(amount).toString()
    } catch {
      setError('Enter a valid NIM amount (max 5 decimals).')
      return
    }
    try {
      await api.createCharge(sessionId!, amountLuna, reference || undefined)
      navigate(`/session/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main>
      <h1>Charge</h1>
      {!sessionId ? (
        <>
          <label>
            Code
            <input
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
          <button onClick={claim} disabled={code.replace(/\s/g, '').length !== 6}>Claim</button>
        </>
      ) : (
        <>
          <p>Payer connected. Enter the amount:</p>
          <label>
            Amount (NIM)
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2.5" />
          </label>
          <label>
            Reference
            <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
          </label>
          <button onClick={submit} disabled={!amount}>Request payment</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
