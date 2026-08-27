import { t } from '../i18n'

const KEY = 'nimble.intro.seen'

export function introSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function markIntroSeen() {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}

export function resetIntro() {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

/**
 * Shown once, before the first payment. Reviewers expected the payer to type
 * a code the seller shows — the opposite of how this works — so the guide
 * leads with who does what, and says why the direction is that way round.
 */
export function Intro({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="intro" aria-label={t('How it works')}>
      <h2>{t('Two people, one code')}</h2>

      <ol className="intro-steps">
        <li>
          <strong>{t('The person paying shows a code.')}</strong>
          <span>{t('Tap Pay. Your wallet makes a 6-digit code, good for two minutes.')}</span>
        </li>
        <li>
          <strong>{t('The person getting paid types it in.')}</strong>
          <span>{t('Tap Charge, enter the amount, then the code you were shown.')}</span>
        </li>
        <li>
          <strong>{t('The payer approves in the wallet.')}</strong>
          <span>{t('Both screens turn green the moment it lands on the chain.')}</span>
        </li>
      </ol>

      <p className="quiet">
        {t('Why this way round? The one paying only shows a code and taps approve — no amount to type, nothing to scan. The one charging already knows the price, so they do the typing.')}
      </p>

      <button className="primary" onClick={onDismiss}>{t('Got it')}</button>
    </section>
  )
}
