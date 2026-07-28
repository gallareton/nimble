import { afterAll, expect, it } from 'vitest'
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
