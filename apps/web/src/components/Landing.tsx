import { useEffect, useRef } from 'react'
import { toCanvas } from 'qrcode'
import { APP_STORE, DEEPLINK, PLAY_STORE, remoteChargeDeeplink } from '../lib/host'
import { t } from '../i18n'
import { DemoVideo } from './DemoVideo'

// Shown when the page is opened in a plain browser instead of Nimiq Pay.
// When `chargeId` is given (a remote-charge link opened outside Nimiq Pay),
// the deep link and QR code go straight to that bill instead of the app's
// home screen, so the payer doesn't land somewhere they have to re-find it.
export function Landing({ chargeId }: { chargeId?: string } = {}) {
  const qrRef = useRef<HTMLCanvasElement>(null)
  const deeplink = chargeId ? remoteChargeDeeplink(chargeId) : DEEPLINK

  useEffect(() => {
    // jsdom has no canvas 2d context - QR is progressive enhancement only
    if (qrRef.current) toCanvas(qrRef.current, deeplink, { width: 180, margin: 1 }).catch(() => {})
  }, [deeplink])

  return (
    <main>
      <div className="hero">
        <h1 className="brand">NIM<em>ble</em></h1>
        <p>{t('Pay or get paid with a 6-digit code.')}</p>
        <p className="quiet">{t('NIMble is a Mini App — it runs inside the Nimiq Pay wallet.')}</p>
        <a className="btn-link" href={deeplink}>
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
            <strong>{t('Vendor mode')}</strong>
            <span>{t('Shifts, daily totals, CSV export and remote bills are live; refunds, tips and a verified business profile are next.')}</span>
          </li>
          <li className="rm-next">
            <strong>{t('Bill splitting')}</strong>
            <span>{t('One amount, many friends, settled live.')}</span>
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
