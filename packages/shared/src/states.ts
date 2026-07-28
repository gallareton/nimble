export type SessionStatus =
  | 'AVAILABLE' | 'CLAIMED' | 'AWAITING_PAYER_APPROVAL' | 'AWAITING_WALLET_AUTH'
  | 'SUBMITTED' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED' | 'DELAYED'
  | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  AVAILABLE: ['CLAIMED', 'EXPIRED'],
  CLAIMED: ['AWAITING_PAYER_APPROVAL', 'CANCELLED'],
  AWAITING_PAYER_APPROVAL: ['AWAITING_WALLET_AUTH', 'REJECTED', 'CANCELLED'],
  AWAITING_WALLET_AUTH: ['SUBMITTED', 'REJECTED'],
  SUBMITTED: ['CONFIRMING', 'FAILED'],
  CONFIRMING: ['CONFIRMED', 'FAILED', 'DELAYED'],
  DELAYED: ['CONFIRMED', 'FAILED'],
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
