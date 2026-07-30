import type { SessionStatus } from '@nimble/shared'
import { t } from '../i18n'

const LABELS: Record<SessionStatus, { label: string; icon: string }> = {
  AVAILABLE: { label: 'Waiting for claim', icon: '⏳' },
  CLAIMED: { label: 'Receiver connected', icon: '🔗' },
  AWAITING_PAYER_APPROVAL: { label: 'Waiting for approval', icon: '👀' },
  AWAITING_WALLET_AUTH: { label: 'Confirm in wallet', icon: '🔐' },
  SUBMITTED: { label: 'Submitted', icon: '📤' },
  CONFIRMING: { label: 'Confirming — do not release goods yet', icon: '⛓️' },
  CONFIRMED: { label: 'Confirmed', icon: '✅' },
  FAILED: { label: 'Payment failed', icon: '❌' },
  DELAYED: { label: 'Taking longer than usual', icon: '🐢' },
  REJECTED: { label: 'Payment cancelled', icon: '🚫' },
  CANCELLED: { label: 'Cancelled', icon: '🚫' },
  EXPIRED: { label: 'Code expired', icon: '⌛' },
}

// Status is always icon + text — never colour alone (spec §5.4).
export function StatusBadge({ status }: { status: SessionStatus }) {
  const { label, icon } = LABELS[status]
  return (
    <span className={`status status--${status.toLowerCase()}`}>
      <span aria-hidden>{icon}</span> {t(label)}
    </span>
  )
}
