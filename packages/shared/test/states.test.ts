import { describe, expect, it } from 'vitest'
import { InvalidTransitionError, TERMINAL_STATES, assertTransition, canTransition } from '../src/states'
import type { SessionStatus } from '../src/states'

describe('state machine (spec §9.1)', () => {
  it.each([
    ['AVAILABLE', 'CLAIMED'], ['AVAILABLE', 'EXPIRED'],
    ['CLAIMED', 'AWAITING_PAYER_APPROVAL'], ['CLAIMED', 'CANCELLED'],
    ['AWAITING_PAYER_APPROVAL', 'AWAITING_WALLET_AUTH'],
    ['AWAITING_PAYER_APPROVAL', 'REJECTED'], ['AWAITING_PAYER_APPROVAL', 'CANCELLED'],
    ['AWAITING_WALLET_AUTH', 'SUBMITTED'], ['AWAITING_WALLET_AUTH', 'REJECTED'],
    ['SUBMITTED', 'CONFIRMING'], ['SUBMITTED', 'FAILED'],
    ['CONFIRMING', 'CONFIRMED'], ['CONFIRMING', 'FAILED'], ['CONFIRMING', 'DELAYED'],
    ['DELAYED', 'CONFIRMED'], ['DELAYED', 'FAILED'],
  ] as const)('allows %s → %s', (a, b) => expect(canTransition(a, b)).toBe(true))

  it.each([
    ['AVAILABLE', 'CONFIRMED'], ['CLAIMED', 'AVAILABLE'], ['CONFIRMED', 'FAILED'],
    ['REJECTED', 'SUBMITTED'], ['EXPIRED', 'CLAIMED'], ['SUBMITTED', 'REJECTED'],
  ] as const)('forbids %s → %s', (a, b) => expect(canTransition(a, b)).toBe(false))

  it('assertTransition throws typed error', () =>
    expect(() => assertTransition('CONFIRMED', 'FAILED')).toThrow(InvalidTransitionError))
  it('terminal set', () =>
    expect([...TERMINAL_STATES].sort()).toEqual(['CANCELLED','CONFIRMED','EXPIRED','FAILED','REJECTED']))
})

// The audit that produced this test found three transitions monitor.ts
// performs every day listed as illegal, because nothing in production ever
// consulted the table. Keep this list in step with monitor.ts: it is the only
// thing stopping the table and the code from drifting apart again.
it('every transition the monitor actually performs is legal', () => {
  const performed: [SessionStatus, SessionStatus][] = [
    // monitorTick: reconciliation pass
    ['AWAITING_WALLET_AUTH', 'SUBMITTED'],
    // monitorTick: expired on chain, from any pending status
    ['SUBMITTED', 'FAILED'], ['CONFIRMING', 'FAILED'], ['DELAYED', 'FAILED'],
    // monitorTick: not included after delayedAfterMs
    ['SUBMITTED', 'DELAYED'],
    // monitorTick: included, macro block has sealed it
    ['SUBMITTED', 'CONFIRMED'], ['CONFIRMING', 'CONFIRMED'], ['DELAYED', 'CONFIRMED'],
    // monitorTick: included, not yet final
    ['SUBMITTED', 'CONFIRMING'], ['DELAYED', 'CONFIRMING'],
  ]
  for (const [from, to] of performed)
    expect(canTransition(from, to), `${from} -> ${to}`).toBe(true)
})
