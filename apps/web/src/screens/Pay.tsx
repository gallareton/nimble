import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { CodeDisplay } from '../components/CodeDisplay'
import { Countdown } from '../components/Countdown'

export function Pay() {
  const { api } = useApp()
  const navigate = useNavigate()
  const [session, setSession] = useState<{ sessionId: string; code: string; expiresAt: string } | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => () => closeRef.current?.(), [])

  const generate = async () => {
    setError(null)
    setExpired(false)
    try {
      const s = await api.createSession()
      setSession(s)
      closeRef.current?.()
      closeRef.current = await api.openEvents(s.sessionId, ({ status }) => {
        // Any post-pairing state (claimed, charged, cancelled, …) moves the
        // payer to the session screen — the code phase is over either way.
        if (status === 'EXPIRED') setExpired(true)
        else if (status && status !== 'AVAILABLE') navigate(`/session/${s.sessionId}`)
      })
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
          <button onClick={generate}>Generate code</button>
        </>
      ) : (
        <>
          <p>Tell this code to the receiver:</p>
          <CodeDisplay code={session.code} />
          <p>Expires in <Countdown until={session.expiresAt} onExpired={() => setExpired(true)} /></p>
          <p>Waiting for the receiver to claim…</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
