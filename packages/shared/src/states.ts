export type SessionStatus =
  | 'AVAILABLE' | 'CLAIMED' | 'AWAITING_PAYER_APPROVAL' | 'AWAITING_WALLET_AUTH'
  | 'SUBMITTED' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED' | 'DELAYED'
  | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

// This table describes what the system ACTUALLY does, and an audit once found
// it did not: three transitions monitor.ts performs every day were listed as
// illegal, because nothing in production ever consulted the table. The test
// suite now walks the monitor's real transitions against it, so the two cannot
// drift apart again silently. Add a reason with every entry.
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  AVAILABLE: ['CLAIMED', 'EXPIRED'],
  CLAIMED: ['AWAITING_PAYER_APPROVAL', 'CANCELLED'],
  AWAITING_PAYER_APPROVAL: ['AWAITING_WALLET_AUTH', 'REJECTED', 'CANCELLED'],
  AWAITING_WALLET_AUTH: ['SUBMITTED', 'REJECTED'],
  // CONFIRMED without passing through CONFIRMING is normal, not a shortcut:
  // a macro block can seal the including block before any tick observed the
  // inclusion, so the monitor sees "included and already final" in one step.
  SUBMITTED: ['CONFIRMING', 'CONFIRMED', 'FAILED', 'DELAYED'],
  CONFIRMING: ['CONFIRMED', 'FAILED', 'DELAYED'],
  // DELAYED is not terminal and not a dead end: a transaction the network
  // was slow to include still gets included, and the monitor then reports
  // CONFIRMING for it exactly as it would for any other pending transfer.
  DELAYED: ['CONFIRMING', 'CONFIRMED', 'FAILED'],
  CONFIRMED: [], FAILED: [], REJECTED: [], CANCELLED: [], EXPIRED: [],
}

export const TERMINAL_STATES: ReadonlySet<SessionStatus> =
  new Set(['CONFIRMED', 'FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED'])

export class InvalidTransitionError extends Error {
  constructor(from: SessionStatus, to: SessionStatus) {
    super(`invalid transition ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to)
}
export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}
