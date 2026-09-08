import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import type { HistoryItem } from '../api/client'
import { Intro, introSeen, markIntroSeen } from '../components/Intro'
import { Landing } from '../components/Landing'
import { inNimiqPay } from '../lib/host'
import { t } from '../i18n'
import { usePoll } from '../lib/usePoll'
import { describeError } from '../lib/errors'
import { FiatBadge } from '../lib/fiat'

const RECENT_POLL_MS = 5000

export function Home() {
  const { api, token, login } = useApp()
  const [recent, setRecent] = useState<HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [wrongNetwork, setWrongNetwork] = useState<null | 'test' | 'main' | 'lagging'>(null)
  const [intro, setIntro] = useState(!introSeen())

  const loadRecent = useCallback(() => {
    if (!token) return
    api.history().then(h => setRecent(h.items.slice(0, 3))).catch(() => {})
  }, [api, token])
  useEffect(loadRecent, [loadRecent])

  // A payment lands here as "finalizing" and used to stay that way until the
  // screen was rebuilt: this list was fetched once and never again, and the
  // home screen is exactly where a payer ends up right after paying.
  usePoll(loadRecent, RECENT_POLL_MS, Boolean(token) && recent.some(r => r.pending))

  // Wallet on mainnet + server on testnet (or vice versa) would broadcast
  // payments our monitor can never confirm — detect it via chain height.
  const { wallet } = useApp()
  useEffect(() => {
    if (!token || !wallet.getBlockNumber) return
    void (async () => {
      // A syncing wallet could report a stale height — only compare once
      // its consensus is established (tip from the competition community).
      if (wallet.isConsensusEstablished && !(await wallet.isConsensusEstablished())) return
      const [walletHeight, srv] = await Promise.all([wallet.getBlockNumber!(), api.getNetwork()])
      if (srv.height === null || Math.abs(walletHeight - srv.height) <= 100_000) return
      // A server merely behind the wallet is our node lagging, not the user on
      // the wrong network — blaming them for our outage sends them to change a
      // setting that was right all along. Different networks are orders of
      // magnitude apart; a lagging node is close and always behind.
      const behind = srv.height < walletHeight && srv.height > walletHeight * 0.5
      setWrongNetwork(behind ? 'lagging' : srv.network.startsWith('Test') ? 'test' : 'main')
    })().catch(() => {})
  }, [api, token, wallet])

  if (!token) {
    if (!inNimiqPay()) return <Landing />
    return (
      <main>
        <div className="hero">
          <h1 className="brand">NIM<em>ble</em></h1>
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
      <h1 className="brand">NIM<em>ble</em></h1>
      {wrongNetwork && (
        <p role="alert" className="banner">
          {wrongNetwork === 'lagging'
            ? t('NIMble is catching up with the chain and cannot confirm payments right now. Nothing is wrong with your wallet — please try again shortly.')
            : wrongNetwork === 'test'
            ? t('Your Nimiq Pay is on a different network than this NIMble server (testnet). Long-press settings in Nimiq Pay to switch to Testnet before paying.')
            : t('Your Nimiq Pay is on a different network than this NIMble server (mainnet). Long-press settings in Nimiq Pay to switch to Mainnet before paying.')}
        </p>
      )}
      {intro && <Intro onDismiss={() => { markIntroSeen(); setIntro(false) }} />}
      <nav className="home-actions" aria-disabled={wrongNetwork !== null}>
        <Link to="/pay" style={wrongNetwork ? { pointerEvents: 'none' } : undefined}>
          <button className="primary" aria-label="Pay" disabled={wrongNetwork !== null}>
            {t('Pay')}<span className="sub" aria-hidden>{t('show your code')}</span></button></Link>
        <Link to="/charge" style={wrongNetwork ? { pointerEvents: 'none' } : undefined}>
          <button aria-label="Charge" disabled={wrongNetwork !== null}>
          {t('Charge')}<span className="sub" aria-hidden>{t('type their code')}</span></button></Link>
      </nav>
      {recent.length === 0 && !intro && (
        <section className="empty-recent">
          <h2>{t('Recent')}</h2>
          <p className="quiet">{t('Nothing yet — your last payments will appear here.')}</p>
        </section>
      )}
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
                    <FiatBadge snapshot={r.snapshot} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="footer-nav">
        <Link to="/history">{t('History')}</Link> · <Link to="/shift">{t('Shift')}</Link>
        {' · '}<Link to="/charge/remote">{t('Bill someone who isn\'t here')}</Link>
        {' · '}<Link to="/settings">{t('Settings')}</Link>
      </p>
      {!intro && (
        <section className="howto" aria-label={t('How it works')}>
          <h2>{t('How it works')}</h2>
          <ol>
            <li>{t('Paying? Tap Pay and tell the receiver your 6-digit code.')}</li>
            <li>{t('Charging? Tap Charge, enter the amount and their code.')}</li>
            <li>{t('The payer approves in the wallet — both screens turn green in seconds.')}</li>
          </ol>
        </section>
      )}
    </main>
  )
}
