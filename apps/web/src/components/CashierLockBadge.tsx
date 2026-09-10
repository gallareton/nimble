import { t } from '../i18n'

// Shared by Shift.tsx, Settings.tsx and AppShell's header — one markup, one
// message, wherever a "the till isn't broken" reassurance is needed instead
// of three copies drifting apart.
export function CashierLockBadge({ locked }: { locked: boolean }) {
  if (!locked) return null
  return (
    <p role="status" className="cashier-lock-badge">
      🔒 {t('Cashier lock is on — the till isn\'t broken.')}
    </p>
  )
}
