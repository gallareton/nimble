import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { resetIntro } from '../components/Intro'
import { t } from '../i18n'

export function Settings({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const address = ctx?.address ?? null
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const [replay, setReplay] = useState(false)

  // Cashier lock (spec §6). pinSet/locked come from GET /v1/me — the server
  // is the source of truth, never something inferred or cached locally.
  const [pinSet, setPinSet] = useState(false)
  const [locked, setLocked] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  const [pinMsgKind, setPinMsgKind] = useState<'ok' | 'error'>('ok')
  const [lockBusy, setLockBusy] = useState(false)
  const [lockMsg, setLockMsg] = useState<string | null>(null)
  const [unlockPin, setUnlockPin] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.getMe().then((me) => {
      if (cancelled) return
      if (me.displayName) setName(me.displayName)
      setPinSet(me.cashierPinSet)
      setLocked(me.cashierLocked)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    await api.updateMe({ displayName: name })
    setSaved(true)
  }

  const savePin = async () => {
    setPinBusy(true)
    setPinMsg(null)
    try {
      await api.setCashierPin({ pin: newPin, ...(pinSet ? { currentPin } : {}) })
      setPinSet(true)
      setNewPin('')
      setCurrentPin('')
      setPinMsgKind('ok')
      setPinMsg(t('PIN saved.'))
    } catch (e) {
      setPinMsgKind('error')
      if (e instanceof ApiError && e.status === 429)
        setPinMsg(t('Too many attempts. Wait a moment and try again.'))
      else if (e instanceof ApiError && e.status === 401)
        setPinMsg(t('Current PIN is incorrect.'))
      else
        setPinMsg(t('Could not save the PIN. Check your connection and try again.'))
    } finally {
      setPinBusy(false)
    }
  }

  const enableLock = async () => {
    setLockBusy(true)
    setLockMsg(null)
    try {
      await api.enableCashierLock()
      setLocked(true)
    } catch {
      setLockMsg(t('Could not enable the lock. Check your connection and try again.'))
    } finally {
      setLockBusy(false)
    }
  }

  // The two failure modes must read differently: a wrong PIN means try
  // again, a 429 means stop trying for a bit. An owner who keeps entering
  // the same correct PIN into a rate-limited form and sees "incorrect" would
  // never learn to just wait.
  const disableLock = async () => {
    setUnlockBusy(true)
    setUnlockMsg(null)
    try {
      await api.disableCashierLock(unlockPin)
      setLocked(false)
      setUnlockPin('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 429)
        setUnlockMsg(t('Too many attempts. Wait a moment and try again.'))
      else if (e instanceof ApiError && e.status === 401)
        setUnlockMsg(t('Incorrect PIN.'))
      else
        setUnlockMsg(t('Could not unlock. Check your connection and try again.'))
    } finally {
      setUnlockBusy(false)
    }
  }

  return (
    <main>
      <h1>{t('Settings')}</h1>
      {locked && (
        <p role="status" className="cashier-lock-badge">
          🔒 {t('Cashier lock is on — the till isn\'t broken.')}
        </p>
      )}
      {/* Renaming is one of the four operations the server rejects while
          locked (spec §5, PATCH /v1/me → 423 CASHIER_LOCKED). Hiding the
          field here is convenience for the cashier, not the guard — the
          server still refuses the request even if this stayed visible, so
          never let removing this replace the server check. */}
      {!locked && (
        <div className="form-card">
          <label>
            {t('Display name')}
            <input value={name} maxLength={50} onChange={e => { setName(e.target.value); setSaved(false) }} />
          </label>
          <button onClick={save} disabled={!name}>{t('Save')}</button>
          {saved && <p role="status">{t('Saved.')}</p>}
        </div>
      )}
      <p className="quiet">
        {t('Receiving address (your wallet):')} <code>{address ?? '—'}</code>
      </p>

      <section className="form-card cashier-lock-section">
        <h2>{t('Cashier lock')}</h2>
        {/* This sentence matters more than anything else on this screen. */}
        <p className="cashier-lock-disclaimer">
          {t('This PIN does not protect your NIM. Whoever is holding this phone also has Nimiq Pay on it and can send funds straight from the wallet — nothing in this app can stop that. An owner who believes this PIN protects their NIM is worse off than one who knows it does not.')}
        </p>
        <p className="quiet">
          {t('What it does stop: a refund to a chosen person in one tap, taking the day\'s export off the phone, closing the shift to hide a gap, and changing the name a payer sees before they confirm.')}
        </p>

        {!locked && (<>
          <label>
            {pinSet ? t('Change cashier PIN (4–8 digits)') : t('Set a cashier PIN (4–8 digits)')}
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8}
              value={newPin} onChange={e => setNewPin(e.target.value)} />
          </label>
          {pinSet && (
            <label>
              {t('Current PIN')}
              <input type="password" inputMode="numeric" autoComplete="off" maxLength={8}
                value={currentPin} onChange={e => setCurrentPin(e.target.value)} />
            </label>
          )}
          <button onClick={() => void savePin()} disabled={!newPin || pinBusy}>{t('Save PIN')}</button>
          {pinMsg && <p role={pinMsgKind === 'error' ? 'alert' : 'status'}>{pinMsg}</p>}
        </>)}

        {pinSet && !locked && (
          <button onClick={() => void enableLock()} disabled={lockBusy}>{t('Lock the till')}</button>
        )}
        {lockMsg && <p role="alert">{lockMsg}</p>}

        {locked && (<>
          <label>
            {t('PIN to unlock')}
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8}
              value={unlockPin} onChange={e => setUnlockPin(e.target.value)} />
          </label>
          <button onClick={() => void disableLock()} disabled={!unlockPin || unlockBusy}>{t('Unlock the till')}</button>
          {unlockMsg && <p role="alert">{unlockMsg}</p>}
        </>)}
      </section>

      <p><Link to="/products">{t('Manage products')}</Link></p>
      <button onClick={() => { resetIntro(); setReplay(true) }}>{t('Show the guide again')}</button>
      {replay && <p role="status">{t('The guide will show next time you open the home screen.')}</p>}
      {ctx && <button onClick={ctx.logout}>{t('Disconnect')}</button>}
      <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
    </main>
  )
}
