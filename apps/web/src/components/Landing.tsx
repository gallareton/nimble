import { useEffect, useRef } from 'react'
import { toCanvas } from 'qrcode'
import { APP_STORE, DEEPLINK, PLAY_STORE } from '../lib/host'

// Shown when the page is opened in a plain browser instead of Nimiq Pay.
export function Landing() {
  const qrRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // jsdom has no canvas 2d context - QR is progressive enhancement only
    if (qrRef.current) toCanvas(qrRef.current, DEEPLINK, { width: 180, margin: 1 }).catch(() => {})
  }, [])

  return (
    <main>
      <div className="hero">
        <h1 className="brand">Nim<em>ble</em></h1>
        <p>Pay or get paid with a 6-digit code.</p>
        <p className="quiet">Nimble is a Mini App — it runs inside the Nimiq Pay wallet.</p>
        <a className="btn-link" href={DEEPLINK}>
          <button className="primary">Open in Nimiq Pay</button>
        </a>
        <p className="quiet">
          Don't have it yet? Get Nimiq Pay for{' '}
          <a href={PLAY_STORE}>Android</a> or <a href={APP_STORE}>iOS</a>,
          then open Mini Apps.
        </p>
        <div className="qr-block" aria-hidden>
          <canvas ref={qrRef} />
          <p className="quiet">On desktop? Scan with your phone.</p>
        </div>
      </div>
    </main>
  )
}
