import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { charge } from '../src/db/schema'
import { nullRates } from '../src/services/rates'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
// Give the default test app a working rate so fiat-priced charges have a quote
// to freeze; the "no rate available" test builds its own app with nullRates.
app.deps.rates = {
  getUsdPerNim: async () => 0.005,
  quoteUsdPerNim: async () => ({ value: 0.005, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

async function pairedSession() {
  const payer = await makeUser(db, `NQ30 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ31 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  return { payer, receiver, pt, rt, sessionId }
}
const postCharge = (sid: string, t: string, amountLuna = '250000') =>
  app.inject({ method: 'POST', url: `/v1/sessions/${sid}/charges`,
    payload: { amountLuna, reference: 'Soda' },
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

async function claimedSessionFor(receiver: Awaited<ReturnType<typeof makeUser>>, rt: string) {
  const payer = await makeUser(db, `NQ42 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  return { payer, pt, sessionId }
}

it('receiver creates charge; session moves to AWAITING_PAYER_APPROVAL; recipient copied', async () => {
  const { rt, pt, sessionId, receiver } = await pairedSession()
  const r = await postCharge(sessionId, rt)
  expect(r.statusCode).toBe(201)
  const view = (await app.inject({ url: `/v1/sessions/${sessionId}`,
    headers: { authorization: `Bearer ${pt}` } })).json()
  expect(view.status).toBe('AWAITING_PAYER_APPROVAL')
  expect(view.charge.amountLuna).toBe('250000')
  expect(view.charge.recipientAddress).toBe(receiver.walletAddress)
  expect(view.counterpart.verificationStatus).toBe('unverified')
})

it('payer cannot create charge; charge is immutable; strangers get 404', async () => {
  const { pt, rt, sessionId } = await pairedSession()
  expect((await postCharge(sessionId, pt)).statusCode).toBe(403)
  await postCharge(sessionId, rt)
  expect((await postCharge(sessionId, rt)).statusCode).toBe(409)
  const stranger = await makeUser(db, 'NQ39 STRANGER')
  const st = await tokenFor(stranger)
  expect((await app.inject({ url: `/v1/sessions/${sessionId}`,
    headers: { authorization: `Bearer ${st}` } })).statusCode).toBe(404)
})

it('receiver view hides payer profile, shows neutral state', async () => {
  const { rt, sessionId } = await pairedSession()
  const view = (await app.inject({ url: `/v1/sessions/${sessionId}`,
    headers: { authorization: `Bearer ${rt}` } })).json()
  expect(view.role).toBe('receiver')
  expect(view.counterpart.displayName).toBe('Payer connected')
})

it('prices a charge from fiat and stamps the open shift', async () => {
  const receiver = await makeUser(db, `NQ44 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const openShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: { authorization: `Bearer ${rt}` } })).json()

  const { sessionId } = await claimedSessionFor(receiver, rt)
  const res = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { fiatAmountMinor: 1234, fiatCurrency: 'USD' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })

  expect(res.statusCode).toBe(201)
  const [row] = await db.select().from(charge).where(eq(charge.id, res.json().chargeId))
  expect(row.shiftId).toBe(openShift.id)
  expect(row.fiatAmountMinor).toBe(1234)
  expect(row.fiatCurrency).toBe('USD')
  expect(row.fxRate).toBeTruthy()
  expect(row.amountAtomic).toBeGreaterThan(0n)
})

it('refuses a fiat price when no rate is available', async () => {
  const receiver = await makeUser(db, `NQ45 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { sessionId } = await claimedSessionFor(receiver, rt)
  const noRateApp = authedApp(db, 'NQ45', { rates: nullRates }).app
  const res = await noRateApp.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { fiatAmountMinor: 1234, fiatCurrency: 'USD' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(res.statusCode).toBe(503)
  expect(res.json().error.code).toBe('NO_RATE')
})
