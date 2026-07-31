import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { Landing } from '../components/Landing'
import { inNimiqPay } from '../lib/host'
import { t } from '../i18n'
import { describeError } from '../lib/errors'
import { formatUsdValue } from '../lib/fiat'

export function Home() {
  const { api, token, login } = useApp()
  const [recent, setRecent] = useState<HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [wrongNetwork, setWrongNetwork] = useState(false)

  useEffect(() => {
    if (!token) return
    api.history().then(h => setRecent(h.items.slice(0, 3))).catch(() => {})
  }, [api, token])

  // Wallet on mainnet + server on testnet (or vice versa) would broadcast
  // payments our monitor can never confirm — detect it via chain height.
  const { wallet } = useApp()
  useEffect(() => {
    if (!token || !wallet.getBlockNumber) return
    void Promise.all([wallet.getBlockNumber(), api.getNetwork()])
      .then(([walletHeight, srv]) => {
        if (srv.height !== null && Math.abs(walletHeight - srv.height) > 100_000)
          setWrongNetwork(true)
      })
      .catch(() => {})
  }, [api, token, wallet])

  if (!token) {
    if (!inNimiqPay()) return <Landing />
    return (
      <main>
        <div className="hero">
          <h1 className="brand">Nim<em>ble</em></h1>
          <p>{t('Pay or get paid with a 6-digit code.')}</p>
          <button className="primary" onClick={() => { setError(null); login().catch(e => setError(describeError(e))) }}>
            Connect wallet
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 className="brand">Nim<em>ble</em></h1>
      {wrongNetwork && (
        <p role="alert" className="banner">
          {t('Your Nimiq Pay is on a different network than this Nimble server (testnet). Long-press settings in Nimiq Pay to switch to Testnet before paying.')}
        </p>
      )}
      <nav className="home-actions">
        <Link to="/pay"><button className="primary" aria-label="Pay">
          {t('Pay')}<span className="sub" aria-hidden>{t('show a code')}</span></button></Link>
        <Link to="/charge"><button aria-label="Charge">
          {t('Charge')}<span className="sub" aria-hidden>{t('enter a code')}</span></button></Link>
      </nav>
      {recent.length > 0 && (
        <section>
          <h2>{t('Recent')}</h2>
          <ul className="list">
            {recent.map(r => (
              <li key={r.receiptId ?? r.sessionId} className={r.pending ? 'pending' : undefined}>
                <Link to={r.pending ? `/session/${r.sessionId}` : `/receipt/${r.receiptId}`}>
                  <span className="dir">{r.role === 'payer' ? t('Sent') : t('Received')}
                    {r.snapshot.reference ? ` · ${String(r.snapshot.reference)}` : ''}
                    {r.pending ? <><br />{t('Paid — finalizing…')}</> : null}</span>
                  <span className="amt">{String(r.snapshot.amountNim)} NIM
                    {typeof r.snapshot.amountUsd === 'number' &&
                      <small className="fiat">{formatUsdValue(r.snapshot.amountUsd)}</small>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="footer-nav"><Link to="/history">{t('History')}</Link> · <Link to="/settings">{t('Settings')}</Link></p>
      <section className="howto" aria-label={t('How it works')}>
        <h2>{t('How it works')}</h2>
        <ol>
          <li>{t('Paying? Tap Pay and tell the receiver your 6-digit code.')}</li>
          <li>{t('Charging? Tap Charge, enter the amount and their code.')}</li>
          <li>{t('The payer approves in the wallet — both screens turn green in seconds.')}</li>
        </ol>
      </section>
    </main>
  )
}
