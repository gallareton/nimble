import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

it('zod validation errors are 400 with stable shape, no stack leak', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce: 123 } })
  expect(r.statusCode).toBe(400)
  expect(r.json().error.code).toBe('VALIDATION')
  expect(JSON.stringify(r.json())).not.toContain('    at ') // no stack frames
})

it('malformed uuid in a path param is 400, not 500', async () => {
  const u = await makeUser(db, 'NQ81 U')
  const r = await app.inject({ method: 'POST', url: '/v1/sessions/does-not-exist/charges',
    payload: { amountLuna: '100' },
    headers: { authorization: `Bearer ${await tokenFor(u)}`, 'idempotency-key': 'k2' } })
  expect(r.statusCode).toBe(400)
  expect(r.json().error.code).toBe('VALIDATION')
})

it('unknown routes are 404 JSON with the error envelope', async () => {
  const r = await app.inject({ url: '/v1/nope' })
  expect(r.statusCode).toBe(404)
  expect(r.json().error.code).toBe('NOT_FOUND')
})

it('unexpected errors are 500 without internals', async () => {
  const { app: fresh } = authedApp(db) // shared app is already listening — no new routes allowed
  fresh.get('/boom', async () => { throw new Error('secret database password xyz') })
  const r = await fresh.inject({ url: '/boom' })
  expect(r.statusCode).toBe(500)
  expect(r.json().error.code).toBe('INTERNAL')
  expect(JSON.stringify(r.json())).not.toContain('xyz')
})
