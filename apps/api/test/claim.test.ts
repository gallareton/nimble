import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { charge, paymentSession } from '../src/db/schema'
import { nullRates } from '../src/services/rates'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
// Give the default test app a working rate so fiat-priced claims have a quote
// to freeze; the "no rate available" test builds its own app with nullRates.
app.deps.rates = {
  getUsdPerNim: async () => 0.005,
  quoteUsdPerNim: async () => ({ value: 0.005, at: new Date().toISOString(), source: 'test-fixture' }),
}
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

it('claim with amount creates the charge atomically — payer sees approval immediately', async () => {
  const payer = await makeUser(db, `NQ32 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ33 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()

  const r = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, amountLuna: '250000', reference: 'Soda' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(r.statusCode).toBe(200)
  const body = r.json()
  expect(body.chargeId).toBeTruthy()

  const view = (await app.inject({ url: `/v1/sessions/${body.sessionId}`,
    headers: { authorization: `Bearer ${pt}` } })).json()
  expect(view.status).toBe('AWAITING_PAYER_APPROVAL')
  expect(view.charge.amountLuna).toBe('250000')
  expect(view.charge.reference).toBe('Soda')
})

it('claim priced in fiat stores the converted amount, the frozen quote, and the open shift', async () => {
  const payer = await makeUser(db, `NQ50 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ51 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const openShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: { authorization: `Bearer ${rt}` } })).json()
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()

  const r = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, fiatAmountMinor: 1234, fiatCurrency: 'USD' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(r.statusCode).toBe(200)
  const body = r.json()
  expect(body.chargeId).toBeTruthy()

  const [row] = await db.select().from(charge).where(eq(charge.id, body.chargeId))
  expect(row.shiftId).toBe(openShift.id)
  expect(row.fiatAmountMinor).toBe(1234)
  expect(row.fiatCurrency).toBe('USD')
  expect(row.fxRate).toBeTruthy()
  expect(row.amountAtomic).toBeGreaterThan(0n)
})

it('claim priced in luna is also stamped with the open shift', async () => {
  const payer = await makeUser(db, `NQ52 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ53 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const openShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ben' }, headers: { authorization: `Bearer ${rt}` } })).json()
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()

  const r = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, amountLuna: '250000' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(r.statusCode).toBe(200)
  const body = r.json()

  const [row] = await db.select().from(charge).where(eq(charge.id, body.chargeId))
  expect(row.shiftId).toBe(openShift.id)
})

it('refuses a fiat-priced claim when no rate is available', async () => {
  const payer = await makeUser(db, `NQ54 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ55 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  const noRateApp = authedApp(db, receiver.walletAddress, { rates: nullRates }).app
  const rt = await tokenFor(receiver)

  const res = await noRateApp.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, fiatAmountMinor: 1234, fiatCurrency: 'USD' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(res.statusCode).toBe(503)
  expect(res.json().error.code).toBe('NO_RATE')
})

it('a claim retry across a rate move replays the original charge, never a second one', async () => {
  const payer = await makeUser(db, `NQ56 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ57 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  const idemKey = crypto.randomUUID()
  const payload = { code, fiatAmountMinor: 1234, fiatCurrency: 'USD' }

  const first = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload, headers: { authorization: `Bearer ${rt}`, 'idempotency-key': idemKey } })
  expect(first.statusCode).toBe(200)

  // Retry with a different receiver token would fail on the AVAILABLE guard,
  // so retry as the same user but through an app whose quote has moved —
  // idempotency must replay the first answer, not re-price.
  const movedRateApp = authedApp(db, receiver.walletAddress, { rates: {
    getUsdPerNim: async () => 0.009,
    quoteUsdPerNim: async () => ({ value: 0.009, at: new Date().toISOString(), source: 'test-fixture-moved' }),
  } }).app
  const retry = await movedRateApp.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload, headers: { authorization: `Bearer ${rt}`, 'idempotency-key': idemKey } })

  expect(retry.statusCode).toBe(200)
  expect(retry.json()).toEqual(first.json())
  const rows = await db.select().from(charge).where(eq(charge.sessionId, first.json().sessionId))
  expect(rows.length).toBe(1)
})

it('a claim retry replays the stored answer even when the rate provider is now unreachable', async () => {
  const payer = await makeUser(db, `NQ58 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ59 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  const idemKey = crypto.randomUUID()
  const payload = { code, fiatAmountMinor: 1234, fiatCurrency: 'USD' }

  const first = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload, headers: { authorization: `Bearer ${rt}`, 'idempotency-key': idemKey } })
  expect(first.statusCode).toBe(200)

  // The rate provider is completely down on the retry — a naive implementation
  // that fetches the quote before checking idempotency would 503 here instead
  // of replaying the stored 200. This is precisely when a vendor retries.
  const noRateApp = authedApp(db, receiver.walletAddress, { rates: nullRates }).app
  const retry = await noRateApp.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload, headers: { authorization: `Bearer ${rt}`, 'idempotency-key': idemKey } })

  expect(retry.statusCode).toBe(200)
  expect(retry.json()).toEqual(first.json())
  const rows = await db.select().from(charge).where(eq(charge.sessionId, first.json().sessionId))
  expect(rows.length).toBe(1)
})

it('a claim priced in an unsupported currency is rejected and creates nothing', async () => {
  const payer = await makeUser(db, `NQ60 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ61 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()

  const res = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, fiatAmountMinor: 1234, fiatCurrency: 'EUR' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })

  // The claim route folds every malformed body — including an unsupported
  // currency, which never reaches quoteUsdPerNim — into the same generic
  // rejection it already uses for a bad code shape, so a code-guesser can't
  // distinguish the two. The schema is what rejects it (SUPPORTED_FIAT_CURRENCY
  // is a z.literal('USD')); the route does no hand-checking of the currency.
  expect(res.statusCode).toBe(404)
  expect(res.json().error.code).toBe('CODE_UNAVAILABLE')
  const rows = await db.select().from(charge).where(eq(charge.sessionId, sessionId))
  expect(rows.length).toBe(0)
  const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, sessionId))
  expect(s.status).toBe('AVAILABLE')
})

