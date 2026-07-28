import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { paymentSession } from '../src/db/schema'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

async function createSession(payerToken: string) {
  return (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${payerToken}`, 'idempotency-key': crypto.randomUUID() } })).json()
}
async function claim(token: string, code: string) {
  return app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() } })
}

it('exactly one of two concurrent claimers wins', async () => {
  const payer = await makeUser(db, 'NQ20 P'); const r1 = await makeUser(db, 'NQ21 R1'); const r2 = await makeUser(db, 'NQ22 R2')
  const { code, sessionId } = await createSession(await tokenFor(payer))
  const [a, b] = await Promise.all([claim(await tokenFor(r1), code), claim(await tokenFor(r2), code)])
  const codes = [a.statusCode, b.statusCode].sort()
  expect(codes).toEqual([200, 404])
  const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, sessionId))
  expect(s.status).toBe('CLAIMED')
  expect(s.chargeDeadlineAt).toBeTruthy()
})

it('claimed code can never be claimed again; invalid & self-claim give the SAME generic error', async () => {
  const payer = await makeUser(db, 'NQ23 P'); const r = await makeUser(db, 'NQ24 R')
  const { code } = await createSession(await tokenFor(payer))
  await claim(await tokenFor(r), code)
  const again = await claim(await tokenFor(r), code)
  const invalid = await claim(await tokenFor(r), '000000')
  const self = await (async () => {
    const { code: c2 } = await createSession(await tokenFor(payer))
    return claim(await tokenFor(payer), c2)
  })()
  for (const res of [again, invalid, self]) {
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('CODE_UNAVAILABLE')
  }
})

it('throttles after 10 failed attempts per wallet', async () => {
  const r = await makeUser(db, 'NQ25 GUESSER')
  const t = await tokenFor(r)
  for (let i = 0; i < 10; i++) {
    const res = await claim(t, '999999')
    expect(res.statusCode).toBe(404)
  }
  const throttled = await claim(t, '999999')
  expect(throttled.statusCode).toBe(429)
})

it('malformed body (missing code) returns 404 CODE_UNAVAILABLE and counts toward throttle', async () => {
  const r = await makeUser(db, 'NQ26 MALFORMED')
  const t = await tokenFor(r)
  const res = await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: {},
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })
  expect(res.statusCode).toBe(404)
  expect(res.json().error.code).toBe('CODE_UNAVAILABLE')
})

it('malformed body (wrong code shape) returns 404 CODE_UNAVAILABLE and counts toward throttle', async () => {
  const r = await makeUser(db, 'NQ27 MALFORMED2')
  const t = await tokenFor(r)
  const res = await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code: 'abc' },
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })
  expect(res.statusCode).toBe(404)
  expect(res.json().error.code).toBe('CODE_UNAVAILABLE')
})

it('malformed attempts count toward throttle limit', async () => {
  const r = await makeUser(db, 'NQ28 MALFORMED_THROTTLE')
  const t = await tokenFor(r)
  for (let i = 0; i < 10; i++) {
    await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code: 'bad' },
      headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })
  }
  const throttled = await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code: 'bad' },
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })
  expect(throttled.statusCode).toBe(429)
})
