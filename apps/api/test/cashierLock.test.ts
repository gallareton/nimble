import { afterAll, expect, it } from 'vitest'
import { chainTransaction, paymentSession, userProfile } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import { eq } from 'drizzle-orm'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = () => ({ 'idempotency-key': crypto.randomUUID() })

async function vendor() {
  const u = await makeUser(db, `NQ70 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}

const setPin = (t: string, pin: string, currentPin?: string) =>
  app.inject({ method: 'PUT', url: '/v1/me/cashier-pin', payload: { pin, ...(currentPin ? { currentPin } : {}) }, headers: auth(t) })
const lockOn = (t: string) => app.inject({ method: 'POST', url: '/v1/me/cashier-lock', headers: auth(t) })
const lockOff = (t: string, pin: string) =>
  app.inject({ method: 'DELETE', url: '/v1/me/cashier-lock', payload: { pin }, headers: auth(t) })

/** A CONFIRMED sale materialized directly in the DB (no monitor run needed),
 *  same approach as refund.test.ts — just enough for the refund route to act on. */
async function confirmedSaleFor(receiver: { id: string; walletAddress: string }) {
  const payer = await makeUser(db, `NQ73 ${crypto.randomUUID().slice(0, 8)}`)
  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: crypto.randomUUID(),
    status: 'CONFIRMED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  const amountAtomic = 500_000n
  const c = await insertCharge(db, {
    sessionId: session.id, amountAtomic, recipientAddress: receiver.walletAddress, reference: 'sale',
  })
  await db.insert(chainTransaction).values({
    chargeId: c.id, sender: payer.walletAddress, recipient: c.recipientAddress,
    amountAtomic, hash: crypto.randomUUID(), status: 'CONFIRMED',
  })
  return c
}

it('setting a PIN never stores it in the clear', async () => {
  const { u, t } = await vendor()
  const r = await setPin(t, '1234')
  expect(r.statusCode).toBe(200)
  const [row] = await db.select().from(userProfile).where(eq(userProfile.id, u.id))
  expect(row.cashierPinHash).toBeTruthy()
  expect(row.cashierPinHash).not.toBe('1234')
  expect(row.cashierPinHash).not.toContain('1234')
})

it('changing a PIN without currentPin is rejected; the correct currentPin succeeds', async () => {
  const { t } = await vendor()
  await setPin(t, '1234')
  const noCurrent = await setPin(t, '5678')
  expect(noCurrent.statusCode).toBe(401)
  const wrongCurrent = await setPin(t, '5678', '0000')
  expect(wrongCurrent.statusCode).toBe(401)
  const ok = await setPin(t, '5678', '1234')
  expect(ok.statusCode).toBe(200)
})

it('enabling the lock without a PIN set is rejected with 409', async () => {
  const { t } = await vendor()
  const r = await lockOn(t)
  expect(r.statusCode).toBe(409)
})

it('unlocking with the correct PIN works; the wrong PIN is 401', async () => {
  const { u, t } = await vendor()
  await setPin(t, '1111')
  const lockRes = await lockOn(t)
  expect(lockRes.statusCode).toBe(200)
  let [row] = await db.select().from(userProfile).where(eq(userProfile.id, u.id))
  expect(row.cashierLocked).toBe(true)

  const wrong = await lockOff(t, '0000')
  expect(wrong.statusCode).toBe(401)

  const right = await lockOff(t, '1111')
  expect(right.statusCode).toBe(200)
  ;[row] = await db.select().from(userProfile).where(eq(userProfile.id, u.id))
  expect(row.cashierLocked).toBe(false)
})

it('PIN rate limiting kicks in after repeated failures, and does not throttle code claim', async () => {
  const { t } = await vendor()
  await setPin(t, '2222')
  await lockOn(t)

  let last
  for (let i = 0; i < 10; i++) last = await lockOff(t, '9999')
  expect(last!.statusCode).toBe(401)
  const limited = await lockOff(t, '2222')
  expect(limited.statusCode).toBe(429)

  // Same profile's own code-claim limiter (subject_type 'wallet'/'ip') must
  // be untouched by the PIN-guessing counter above.
  const payer = await makeUser(db, `NQ71 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: { ...auth(pt), ...idem() } })).json()
  const claim = await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { ...auth(t), ...idem() } })
  expect(claim.statusCode).toBe(200)
})

it('refunds, export, shift close and PATCH /v1/me all return 423 CASHIER_LOCKED while locked', async () => {
  const { u, t } = await vendor()
  await setPin(t, '3333')
  const shift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()
  const saleCharge = await confirmedSaleFor(u)

  const lockRes = await lockOn(t)
  expect(lockRes.statusCode).toBe(200)

  const refundRes = await app.inject({ method: 'POST', url: `/v1/charges/${saleCharge.id}/refunds`,
    payload: {}, headers: { ...auth(t), ...idem() } })
  expect(refundRes.statusCode).toBe(423)
  expect(refundRes.json().error.code).toBe('CASHIER_LOCKED')

  const exportRes = await app.inject({ method: 'GET', url: `/v1/shifts/${shift.id}/export`, headers: auth(t) })
  expect(exportRes.statusCode).toBe(423)
  expect(exportRes.json().error.code).toBe('CASHIER_LOCKED')

  const closeRes = await app.inject({ method: 'POST', url: `/v1/shifts/${shift.id}/close`, headers: auth(t) })
  expect(closeRes.statusCode).toBe(423)
  expect(closeRes.json().error.code).toBe('CASHIER_LOCKED')

  const patchRes = await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'X' }, headers: auth(t) })
  expect(patchRes.statusCode).toBe(423)
  expect(patchRes.json().error.code).toBe('CASHIER_LOCKED')
})

it('accepting a payment and GET .../report both keep working while locked', async () => {
  const { t } = await vendor()
  await setPin(t, '4444')
  const shift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Bo' }, headers: auth(t) })).json()
  await lockOn(t)

  const payer = await makeUser(db, `NQ74 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { ...auth(pt), ...idem() } })).json()
  const claim = await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { ...auth(t), ...idem() } })
  expect(claim.statusCode).toBe(200)

  const chargeRes = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna: '100000' }, headers: { ...auth(t), ...idem() } })
  expect(chargeRes.statusCode).toBe(201)

  const reportRes = await app.inject({ method: 'GET', url: `/v1/shifts/${shift.id}/report`, headers: auth(t) })
  expect(reportRes.statusCode).toBe(200)
})
