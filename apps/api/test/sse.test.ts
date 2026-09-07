import { afterAll, expect, it } from 'vitest'
import { TicketStore } from '../src/services/ticketStore'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

it('ticket is required, participant-only and single-use', async () => {
  const payer = await makeUser(db, 'NQ50 P')
  const stranger = await makeUser(db, 'NQ51 S')
  const pt = await tokenFor(payer)
  const { sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': 'k' } })).json()

  expect((await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/events-ticket`,
    headers: { authorization: `Bearer ${await tokenFor(stranger)}` } })).statusCode).toBe(404)

  const { ticket } = (await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/events-ticket`,
    headers: { authorization: `Bearer ${pt}` } })).json()
  expect(ticket).toMatch(/^[0-9a-f]{32}$/)

  expect((await app.inject({ url: `/v1/sessions/${sessionId}/events?ticket=nope` })).statusCode).toBe(401)
})

it('an unredeemed ticket does not accumulate: issuing sweeps the expired ones', () => {
  // Tested against the store rather than over HTTP on purpose: reclaiming
  // memory is not observable through the API, and driving the clock with fake
  // timers deadlocks the database calls the route makes.
  const store = new TicketStore(30_000)
  const t0 = 1_000_000

  const stale = store.issue('session-a', t0)
  expect(store.size).toBe(1)

  // Past the TTL: the next issue must evict the abandoned one rather than
  // letting it sit there until the process dies.
  store.issue('session-b', t0 + 31_000)
  expect(store.size).toBe(1)

  // Gone, not merely expired.
  expect(store.redeem(stale, 'session-a', t0 + 31_000)).toBe(false)
})

it('a ticket is single-use and bound to its own session', () => {
  const store = new TicketStore(30_000)
  const ticket = store.issue('session-a')
  expect(store.redeem(ticket, 'session-b')).toBe(false) // wrong session
  expect(store.size).toBe(0)                            // and burned anyway

  const second = store.issue('session-a')
  expect(store.redeem(second, 'session-a')).toBe(true)
  expect(store.redeem(second, 'session-a')).toBe(false) // no second try
})
