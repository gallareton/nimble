import { useEffect } from 'react'
import { lunaToNim } from '@nimble/shared'
import { t } from '../i18n'

// Fires a short beep + a vibration, best-effort. The webview this runs in
// (Nimiq Pay) has no navigator.share, may have no navigator.vibrate, and
// will refuse to play audio unless the AudioContext was created/resumed
// during a real user gesture. None of that may ever block the panel: every
// call here is wrapped so a missing or throwing/refused API is silently
// swallowed.
function playAlert() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext
    if (Ctx) {
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.35)
      osc.onended = () => { ctx.close?.().catch(() => {}) }
    }
  } catch { /* no audio available — the panel itself is the signal */ }

  try {
    navigator.vibrate?.([80, 40, 80])
  } catch { /* no haptics available — the panel itself is the signal */ }
}

/**
 * Full-screen release signal for the receiver (spec BR-P05 / T5): a faked
 * "paid" screen on the customer's own phone must never be mistaken for
 * this. Shown at CONFIRMING (code) — the spec's "confirmed", the point at
 * which the vendor may already hand over the goods — and stays up through
 * CONFIRMED (code) — the spec's "settled" / final. BR-P04 requires the two
 * to stay visibly distinct, so the panel keeps saying which one it is.
 */
export function PaidBanner(props: {
  status: 'CONFIRMING' | 'CONFIRMED'
  amountLuna: string
  reference?: string | null
  onDismiss: () => void
}) {
  const { status, amountLuna, reference, onDismiss } = props
  const finalised = status === 'CONFIRMED'

  useEffect(() => {
    playAlert()
    // Only on mount — do not re-alert when CONFIRMING flips to CONFIRMED.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="paid-banner" role="alertdialog" aria-label={t('Release the goods')}>
      <p className="paid-banner__word">{t('Paid')}</p>
      <p className="amount paid-banner__amount">{lunaToNim(BigInt(amountLuna))} NIM
        {reference ? <small>{reference}</small> : null}</p>
      <p className={`paid-banner__finality ${finalised ? 'paid-banner__finality--final' : ''}`}>
        {finalised
          ? t('Finalised — payment is complete.')
          : t('Included on the blockchain — not yet final. Safe to release.')}
      </p>
      <p className="paid-banner__instruction">
        {t('Release the goods now — only from this screen, never from the customer’s own phone.')}
      </p>
      <button className="primary" onClick={onDismiss}>{t('Dismiss')}</button>
    </div>
  )
}
