import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import { CodeDisplay } from '../components/CodeDisplay'
import { Countdown } from '../components/Countdown'
import type { Api } from '../api/client'
import { copyText } from '../lib/copy'

export const ACTIVE_PAY_KEY = 'nimble:activePay'

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
  const [copied, setCopied] = useState(false)
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

  // On entry: restore an active code after a reload (trust the server, not
  // the cache) — or go straight to a fresh code. No extra tap to generate.
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    const stored = readStored()
    if (!stored) { void generate(); return }
    let cancelled = false
    void api.getSession(stored.sessionId).then(async (view) => {
      if (cancelled) return
      if (view.status === 'AVAILABLE') { setSession(stored); await watch(stored) }
      else if (view.status === 'EXPIRED' || view.status === 'CANCELLED') { clearStored(); await generate() }
      else { clearStored(); navigate(`/session/${stored.sessionId}`) }
    }).catch(() => { clearStored(); void generate() })
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
      <header className="top-bar">
        <Link to="/" className="back" aria-label="Back to home">‹ Home</Link>
        <h1>Pay</h1>
      </header>
      {!session || expired ? (
        <>
          {expired && <p role="alert">Code expired. Generate a new one.</p>}
          <button className="primary" onClick={generate}>Generate code</button>
        </>
      ) : (
        <>
          <div
            className="code-ring"
            ref={ringRef}
            style={{ ['--frac' as string]: String(
              Math.max(0, Math.min(1, (new Date(session.expiresAt).getTime() - Date.now()) / 120_000))) }}
          >
            <div className="code-ring__inner">
              <span className="brand-chip">Nimble</span>
              <CodeDisplay code={session.code} />
              <Countdown
                until={session.expiresAt}
                onExpired={() => { clearStored(); setExpired(true) }}
                onTick={secs => ringRef.current?.style.setProperty('--frac', String(secs / 120))}
              />
            </div>
          </div>
          <p className="center">
            <button className="chip" onClick={() => {
              void copyText(session.code).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) } })
            }}>{copied ? 'Copied' : 'Copy code'}</button>
          </p>
          <p className="center quiet">Tell this code to the receiver. Waiting for them to claim…</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Link to="/" className="back-bottom"><button>‹ Back to home</button></Link>
    </main>
  )
}
