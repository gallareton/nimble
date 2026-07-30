import { expect, it } from 'vitest'
import { describeError } from '../src/lib/errors'

it('never yields [object Object]', () => {
  expect(describeError(new Error('boom'))).toBe('boom')
  expect(describeError('plain')).toBe('plain')
  expect(describeError({ message: 'insufficient funds', code: 'INVALID_TX' }))
    .toBe('INVALID_TX: insufficient funds')
  expect(describeError({ error: { message: 'denied', type: 'PermissionDeniedError' } }))
    .toBe('PermissionDeniedError: denied')
  expect(describeError({ weird: true })).toBe('{"weird":true}')
})
