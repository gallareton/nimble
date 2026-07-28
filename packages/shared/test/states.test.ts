import { describe, expect, it } from 'vitest'
import { InvalidTransitionError, TERMINAL_STATES, assertTransition, canTransition } from '../src/states'

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
