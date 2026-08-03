import { useEffect, useRef } from 'react'
import { toCanvas } from 'qrcode'
import { APP_STORE, DEEPLINK, PLAY_STORE } from '../lib/host'
import { t } from '../i18n'
import { DemoVideo } from './DemoVideo'

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
        <h1 className="brand">NIM<em>ble</em></h1>
        <p>{t('Pay or get paid with a 6-digit code.')}</p>
        <p className="quiet">{t('NIMble is a Mini App — it runs inside the Nimiq Pay wallet.')}</p>
        <a className="btn-link" href={DEEPLINK}>
          <button className="primary">{t('Open in Nimiq Pay')}</button>
        </a>
        <p className="quiet">
          Don't have it yet? Get Nimiq Pay for{' '}
          <a href={PLAY_STORE}>{t('Android')}</a> or <a href={APP_STORE}>iOS</a>,
          then open Mini Apps.
        </p>
        <div className="qr-block" aria-hidden>
          <canvas ref={qrRef} />
          <p className="quiet">{t('On desktop? Scan with your phone.')}</p>
        </div>
      </div>

      <DemoVideo />

      <section className="roadmap" aria-label={t('Roadmap')}>
        <h2>{t('Roadmap')}</h2>
        <ul>
          <li className="rm-done">
            <strong>{t('Live today')}</strong>
            <span>{t('Pay by 6-digit code — instant on mainnet and testnet, receipts, six languages.')}</span>
          </li>
          <li className="rm-next">
            <strong>{t('Request by link')}</strong>
            <span>{t('Share a payment request through any messenger.')}</span>
          </li>
          <li className="rm-next">
            <strong>{t('Bill splitting')}</strong>
            <span>{t('One amount, many friends, settled live.')}</span>
          </li>
          <li className="rm-next">
            <strong>{t('Vendor mode')}</strong>
            <span>{t('A professional POS: daily totals, exports, verified business profile.')}</span>
          </li>
          <li className="rm-later">
            <strong>{t('Cashlink cheques')}</strong>
            <span>{t('Prepaid codes anyone can redeem — even without the app.')}</span>
          </li>
          <li className="rm-later">
            <strong>{t('Phone-number transfers')}</strong>
            <span>{t('Pay a contact by number; SMS invites for newcomers.')}</span>
          </li>
          <li className="rm-later">
            <strong>{t('Merchant API')}</strong>
            <span>{t('Webshops and cash registers create charges via API and webhooks.')}</span>
          </li>
          <li className="rm-later">
            <strong>{t('USDT on Polygon')}</strong>
            <span>{t('Same flow, stable value — the session model is asset-agnostic.')}</span>
          </li>
        </ul>
      </section>
    </main>
  )
}
