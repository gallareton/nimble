import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import { CodeDisplay } from '../components/CodeDisplay'
import { Spinner } from '../components/Spinner'
import { Countdown } from '../components/Countdown'
import type { Api } from '../api/client'
import { copyText } from '../lib/copy'
import { APP_URL } from '../lib/host'
import { t } from '../i18n'
import { describeError } from '../lib/errors'

import { networkChoice } from '../lib/network'

export const ACTIVE_PAY_KEY = 'nimble:activePay'
const payKey = () => `${ACTIVE_PAY_KEY}${networkChoice().suffix}`

type ActivePay = { sessionId: string; code: string; expiresAt: string }

function readStored(): ActivePay | null {
  try {
    const raw = sessionStorage.getItem(payKey())
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
  const [invited, setInvited] = useState(false)
  const closeRef = useRef<(() => void) | null>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  const clearStored = () => sessionStorage.removeItem(payKey())

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

  // A code is useless alone: data shows solo visitors generate one and
  // leave. Hand them a way to pull in the other person.
  const invite = async () => {
    const text = t('Pay or get paid with a 6-digit code in Nimiq Pay.')
    if (navigator.share) {
      // cancelling the sheet is not a failure — never fall through to copy
      await navigator.share({ title: 'NIMble', text, url: APP_URL }).catch(() => {})
      return
    }
    if (await copyText(`${text} ${APP_URL}`)) {
      setInvited(true)
      setTimeout(() => setInvited(false), 2000)
    }
  }

  const generate = async () => {
    setError(null)
    setExpired(false)
    try {
      const s = await api.createSession()
      // The server stamps expiresAt with ITS clock; a device clock a couple
      // of seconds behind would show 2:02. Clamp to our own now + TTL.
      s.expiresAt = new Date(
        Math.min(new Date(s.expiresAt).getTime(), Date.now() + 120_000)).toISOString()
      sessionStorage.setItem(payKey(), JSON.stringify(s))
      setSession(s)
      await watch(s)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <main>
      <header className="top-bar">
        <Link to="/" className="back" aria-label={t('Back to home')}>‹ {t('Home')}</Link>
        <h1>{t('Pay')}</h1>
      </header>
      <div
        className="code-ring"
        ref={ringRef}
        style={{ ['--frac' as string]: session && !expired
          ? String(Math.max(0, Math.min(1, (new Date(session.expiresAt).getTime() - Date.now()) / 120_000)))
          : '0' }}
      >
        <div className="code-ring__inner">
          <span className="brand-chip">NIMble</span>
          {expired ? (
            <>
              <p className="quiet">{t('Code expired')}</p>
              <button className="primary" onClick={generate}>{t('New code')}</button>
            </>
          ) : session ? (
            <>
              <CodeDisplay code={session.code} />
              <Countdown
                until={session.expiresAt}
                onExpired={() => { clearStored(); setExpired(true) }}
                onTick={secs => ringRef.current?.style.setProperty('--frac', String(secs / 120))}
              />
            </>
          ) : (
            <Spinner size={36} />
          )}
        </div>
      </div>
      {!expired && session && (
        <>
          <p className="center">
            <button className="chip" onClick={() => {
              void copyText(session.code).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) } })
            }}>{copied ? t('Copied') : t('Copy code')}</button>
          </p>
          <p className="center quiet">{t('Tell this code to the receiver. Waiting for them to claim…')}</p>
          <p className="center quiet">{t('Nobody to pay yet? NIMble takes two — the other person enters your code.')}</p>
          <p className="center">
            <button className="chip" onClick={invite}>
              {invited ? t('Link copied') : t('Invite someone')}
            </button>
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Link to="/" className="back-bottom"><button>‹ {t('Back to home')}</button></Link>
    </main>
  )
}
