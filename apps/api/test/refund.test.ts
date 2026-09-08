import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chainTransaction, charge, paymentSession, refund } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

/**
 * Materializes a CONFIRMED original sale directly (no monitor run needed —
 * these tests only care about what the refund route does once a payment is
 * already CONFIRMED, not how it got there; that path is covered elsewhere).
 */
async function confirmedSale(opts: { amountLuna?: bigint; shiftId?: string | null } = {}) {
  const payer = await makeUser(db, `NQ60 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ61 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const rt = await tokenFor(receiver)
  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: crypto.randomUUID(),
    status: 'CONFIRMED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  const amountAtomic = opts.amountLuna ?? 500_000n
  const c = await insertCharge(db, {
    sessionId: session.id, amountAtomic, recipientAddress: receiver.walletAddress,
    reference: 'Original sale', shiftId: opts.shiftId ?? null,
  })
  await db.insert(chainTransaction).values({
    chargeId: c.id, sender: payer.walletAddress, recipient: c.recipientAddress,
    amountAtomic, hash: crypto.randomUUID(), status: 'CONFIRMED',
  })
  return { payer, receiver, pt, rt, session, charge: c }
}

const postRefund = (chargeId: string, t: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/v1/charges/${chargeId}/refunds`, payload,
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

it('a full refund creates a session and a charge whose recipient is the original sender', async () => {
  const { rt, charge: origCharge, payer, receiver } = await confirmedSale({ amountLuna: 500_000n })
  const res = await postRefund(origCharge.id, rt)
  expect(res.statusCode).toBe(201)
  const { refundId, sessionId, chargeId } = res.json()
  expect(refundId).toBeTruthy()

  const [session] = await db.select().from(paymentSession).where(eq(paymentSession.id, sessionId))
  expect(session.status).toBe('AWAITING_PAYER_APPROVAL')
  // The vendor (original receiver) is the payer of the refund; the original
  // payer is now the receiver.
  expect(session.payerUserId).toBe(receiver.id)
  expect(session.receiverUserId).toBe(payer.id)

  const [refundCharge] = await db.select().from(charge).where(eq(charge.id, chargeId))
  expect(refundCharge.amountAtomic).toBe(500_000n)
  expect(refundCharge.recipientAddress).toBe(payer.walletAddress)

  const [r] = await db.select().from(refund).where(eq(refund.id, refundId))
  expect(r.originalChargeId).toBe(origCharge.id)
  expect(r.sessionId).toBe(sessionId)
  expect(r.amountAtomic).toBe(500_000n)
})

it('two partial refunds that together fit inside the original amount both succeed', async () => {
  const { rt, charge: origCharge } = await confirmedSale({ amountLuna: 1_000_000n })
  const first = await postRefund(origCharge.id, rt, { amountLuna: '400000' })
  expect(first.statusCode).toBe(201)
  const second = await postRefund(origCharge.id, rt, { amountLuna: '600000' })
  expect(second.statusCode).toBe(201)

  const rows = await db.select().from(refund).where(eq(refund.originalChargeId, origCharge.id))
  expect(rows.length).toBe(2)
})

it('partial refunds summing past the original amount are rejected with 409', async () => {
  const { rt, charge: origCharge } = await confirmedSale({ amountLuna: 1_000_000n })
  const first = await postRefund(origCharge.id, rt, { amountLuna: '700000' })
  expect(first.statusCode).toBe(201)
  const second = await postRefund(origCharge.id, rt, { amountLuna: '400000' })
  expect(second.statusCode).toBe(409)

  const rows = await db.select().from(refund).where(eq(refund.originalChargeId, origCharge.id))
  expect(rows.length).toBe(1)
})

it('refunding a payment that is not CONFIRMED is rejected with 409', async () => {
  const payer = await makeUser(db, `NQ62 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ63 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: crypto.randomUUID(),
    status: 'AWAITING_PAYER_APPROVAL', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  const c = await insertCharge(db, {
    sessionId: session.id, amountAtomic: 300_000n, recipientAddress: receiver.walletAddress,
  })
  const res = await postRefund(c.id, rt)
  expect(res.statusCode).toBe(409)
})

it('a refund initiated by the original payer is rejected with 403', async () => {
  const { pt, charge: origCharge } = await confirmedSale()
  const res = await postRefund(origCharge.id, pt)
  expect(res.statusCode).toBe(403)
})

it('the refund charge is stamped with the vendor (payer of the refund) shift, not the customer\'s', async () => {
  const { rt, pt, charge: origCharge } = await confirmedSale()

  // Vendor (original receiver, refund payer) has an open shift.
  const vendorShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(rt) })).json()

  // Customer (original payer, refund receiver) also happens to be a vendor
  // with an open shift of their own — the refund must NOT land there.
  const customerShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Bo' }, headers: auth(pt) })).json()

  const res = await postRefund(origCharge.id, rt)
  expect(res.statusCode).toBe(201)
  const { chargeId } = res.json()
  const [refundCharge] = await db.select().from(charge).where(eq(charge.id, chargeId))
  expect(refundCharge.shiftId).toBe(vendorShift.id)
  expect(refundCharge.shiftId).not.toBe(customerShift.id)
})

it('one_refund_per_session rejects a second refund row on the same session', async () => {
  const { session, charge: origCharge } = await confirmedSale()
  await db.insert(refund).values({ originalChargeId: origCharge.id, sessionId: session.id, amountAtomic: 100_000n })
  await expect(
    db.insert(refund).values({ originalChargeId: origCharge.id, sessionId: session.id, amountAtomic: 200_000n }),
  ).rejects.toThrow(/one_refund_per_session/)
})
