import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { paymentSession } from '../src/db/schema'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

it('creates a 120s session, code never stored in plaintext', async () => {
  const payer = await makeUser(db, 'NQ10 PAYER')
  const r = await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${await tokenFor(payer)}`, 'idempotency-key': 'ik1' } })
  expect(r.statusCode).toBe(201)
  const body = r.json()
  expect(body.code).toMatch(/^\d{6}$/)
  expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(110_000)
  const [row] = await db.select().from(paymentSession).where(eq(paymentSession.id, body.sessionId))
  expect(row.codeHash).not.toContain(body.code)
})

it('same idempotency key replays same code; new key expires old session', async () => {
  const payer = await makeUser(db, 'NQ11 PAYER')
  const h = async (k: string) => (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${await tokenFor(payer)}`, 'idempotency-key': k } })).json()
  const a = await h('k-a'); const a2 = await h('k-a'); const b = await h('k-b')
  expect(a2.code).toBe(a.code)
  expect(b.code).not.toBe(a.code)
  const [old] = await db.select().from(paymentSession).where(eq(paymentSession.id, a.sessionId))
  expect(old.status).toBe('EXPIRED')
})

it('requires idempotency key', async () => {
  const payer = await makeUser(db, 'NQ12 PAYER')
  const r = await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${await tokenFor(payer)}` } })
  expect(r.statusCode).toBe(400)
})
