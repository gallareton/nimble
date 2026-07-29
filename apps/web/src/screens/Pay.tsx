import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import { CodeDisplay } from '../components/CodeDisplay'
import { Countdown } from '../components/Countdown'
import type { Api } from '../api/client'

export const ACTIVE_PAY_KEY = 'nimblink:activePay'

type ActivePay = { sessionId: string; code: string; expiresAt: string }

function readStored(): ActivePay | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_PAY_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ActivePay
    if (!s.sessionId || !s.code || new Date(s.expiresAt).getTime() <= Date.now()) return null
    return s
  } catch { return null }
}

export function Pay({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const navigate = useNavigate()
  const [session, setSession] = useState<ActivePay | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  const clearStored = () => sessionStorage.removeItem(ACTIVE_PAY_KEY)

  const watch = async (s: ActivePay) => {
    closeRef.current?.()
    closeRef.current = await api.openEvents(s.sessionId, ({ status }) => {
      // Any post-pairing state (claimed, charged, cancelled, …) moves the
      // payer to the session screen — the code phase is over either way.
      if (status === 'EXPIRED') { clearStored(); setExpired(true) }
      else if (status && status !== 'AVAILABLE') { clearStored(); navigate(`/session/${s.sessionId}`) }
    })
  }

  // Restore an active code after a reload: trust the server, not the cache.
  useEffect(() => {
    const stored = readStored()
    if (!stored) return
    let cancelled = false
    void api.getSession(stored.sessionId).then(async (view) => {
      if (cancelled) return
      if (view.status === 'AVAILABLE') { setSession(stored); await watch(stored) }
      else if (view.status === 'EXPIRED' || view.status === 'CANCELLED') clearStored()
      else { clearStored(); navigate(`/session/${stored.sessionId}`) }
    }).catch(clearStored)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => closeRef.current?.(), [])

  const generate = async () => {
    setError(null)
    setExpired(false)
    try {
      const s = await api.createSession()
      sessionStorage.setItem(ACTIVE_PAY_KEY, JSON.stringify(s))
      setSession(s)
      await watch(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main>
      <h1>Pay</h1>
      {!session || expired ? (
        <>
          {expired && <p role="alert">Code expired. Generate a new one.</p>}
          <button className="primary" onClick={generate}>Generate code</button>
        </>
      ) : (
        <>
          <div className="code-ring" ref={ringRef}>
            <div className="code-ring__inner">
              <span className="brand-chip">NIMblink</span>
              <CodeDisplay code={session.code} />
              <Countdown
                until={session.expiresAt}
                onExpired={() => { clearStored(); setExpired(true) }}
                onTick={secs => ringRef.current?.style.setProperty('--frac', String(secs / 120))}
              />
            </div>
          </div>
          <p className="center quiet">Tell this code to the receiver. Waiting for them to claim…</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
