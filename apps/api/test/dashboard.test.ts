import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { charge, paymentSession, sale } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
app.deps.rates = {
  getUsdPerNim: async () => 0.004,
  quoteUsdPerNim: async () => ({ value: 0.004, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

async function vendor() {
  const u = await makeUser(db, `NQ70 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = (t: string) => ({ authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() })

const createSale = (t: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/sales', payload, headers: idem(t) })
const openShift = (t: string, operatorLabel: string) =>
  app.inject({ method: 'POST', url: '/v1/shifts', payload: { operatorLabel }, headers: auth(t) })
const dashboard = (t: string, day?: string) =>
  app.inject({ url: `/v1/dashboard${day ? `?day=${day}` : ''}`, headers: auth(t) })

/** Drives a payment session's status directly, same pattern as sales.test.ts
 *  and shifts.test.ts — these tests care about how the dashboard reacts to a
 *  session outcome, not the signing flow that produces it. */
async function confirmSession(sessionId: string) {
  await db.update(paymentSession).set({ status: 'CONFIRMED' }).where(eq(paymentSession.id, sessionId))
}

/** Claims a NIM sale with a payer of its own and returns the ids needed to
 *  confirm or inspect it. */
async function claimNimSale(vendorToken: string, saleId: string) {
  const { t: payerToken } = await vendor()
  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerToken) })).json()
  const res = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, saleId }, headers: idem(vendorToken) })
  return res.json() as { sessionId: string; chargeId: string }
}

it('sums a cash sale and a confirmed NIM sale into the day\'s gross', async () => {
  const { t } = await vendor()
  await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 500, quantity: 1 }], paymentMethod: 'cash' })
  const nimSale = (await createSale(t, { items: [{ name: 'Tea', unitPriceMinor: 250, quantity: 1 }], paymentMethod: 'nim' })).json()
  const { sessionId } = await claimNimSale(t, nimSale.id)
  await confirmSession(sessionId)

  const view = (await dashboard(t)).json()
  expect(view.grossFiatMinor).toBe(750)
  expect(view.byPaymentMethod.cash.count).toBe(1)
  expect(view.byPaymentMethod.cash.fiatMinor).toBe(500)
  expect(view.byPaymentMethod.nim.count).toBe(1)
  expect(view.byPaymentMethod.nim.fiatMinor).toBe(250)
  expect(view.salesCount).toBe(2)
})

it('a sale from yesterday does not count today', async () => {
  const { t } = await vendor()
  const s = (await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 500, quantity: 1 }], paymentMethod: 'cash' })).json()
  await db.update(sale).set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(sale.id, s.id))

  const view = (await dashboard(t)).json()
  expect(view.grossFiatMinor).toBe(0)
  expect(view.salesCount).toBe(0)
  expect(view.byPaymentMethod.cash.count).toBe(0)
})

it('groups by shift.operator_label, one entry per operator', async () => {
  const { t } = await vendor()
  const shiftAna = (await openShift(t, 'Ana')).json()
  await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 300, quantity: 1 }], paymentMethod: 'cash' })
  await app.inject({ method: 'POST', url: `/v1/shifts/${shiftAna.id}/close`, headers: auth(t) })

  const shiftBob = (await openShift(t, 'Bob')).json()
  await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 700, quantity: 1 }], paymentMethod: 'cash' })
  void shiftBob

  const view = (await dashboard(t)).json()
  expect(view.byOperator).toHaveLength(2)
  const labels = view.byOperator.map((o: { operatorLabel: string }) => o.operatorLabel).sort()
  expect(labels).toEqual(['Ana', 'Bob'])
  // sorted grossFiatMinor desc: Bob (700) before Ana (300)
  expect(view.byOperator[0].operatorLabel).toBe('Bob')
  expect(view.byOperator[0].grossFiatMinor).toBe(700)
  expect(view.byOperator[1].operatorLabel).toBe('Ana')
  expect(view.byOperator[1].grossFiatMinor).toBe(300)
})

it('sums quantities of the same product across two sales', async () => {
  const { t } = await vendor()
  await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 300, quantity: 2 }], paymentMethod: 'cash' })
  await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 300, quantity: 3 }], paymentMethod: 'cash' })

  const view = (await dashboard(t)).json()
  expect(view.topProducts).toEqual([{ name: 'Coffee', quantity: 5, totalMinor: 1500 }])
})

it('a NIM sale appears in awaiting before confirmation, and not after', async () => {
  const { t } = await vendor()
  const nimSale = (await createSale(t, { items: [{ name: 'Tea', unitPriceMinor: 250, quantity: 1 }], paymentMethod: 'nim' })).json()
  const { sessionId } = await claimNimSale(t, nimSale.id)

  const before = (await dashboard(t)).json()
  expect(before.awaiting).toHaveLength(1)
  expect(before.awaiting[0].saleId).toBe(nimSale.id)
  expect(before.awaiting[0].totalMinor).toBe(250)

  await confirmSession(sessionId)

  const after = (await dashboard(t)).json()
  expect(after.awaiting).toHaveLength(0)
})

it('an old-path NIM charge (no sale) is counted once, not skipped and not doubled', async () => {
  const { u, t } = await vendor()
  const { u: payer } = await vendor()
  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: u.id, codeHash: crypto.randomUUID(),
    status: 'CONFIRMED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  await insertCharge(db, {
    sessionId: session.id, amountAtomic: 1_000_000n, recipientAddress: u.walletAddress,
    fiatAmountMinor: 400, fiatCurrency: 'USD',
  })

  const view = (await dashboard(t)).json()
  expect(view.byPaymentMethod.nim.count).toBe(1)
  expect(view.byPaymentMethod.nim.fiatMinor).toBe(400)
  expect(view.grossFiatMinor).toBe(400)
  expect(view.salesCount).toBe(1)
  const [c] = await db.select().from(charge).where(eq(charge.sessionId, session.id))
  expect(c.saleId).toBeNull()
})

it('one vendor cannot see another\'s data, and a missing day param defaults to today', async () => {
  const { t: vendorA } = await vendor()
  const { t: vendorB } = await vendor()
  await createSale(vendorA, { items: [{ name: 'Coffee', unitPriceMinor: 500, quantity: 1 }], paymentMethod: 'cash' })

  const viewB = (await dashboard(vendorB)).json()
  expect(viewB.salesCount).toBe(0)
  expect(viewB.grossFiatMinor).toBe(0)

  const today = new Date().toISOString().slice(0, 10)
  const viewA = (await dashboard(vendorA)).json()
  expect(viewA.day).toBe(today)
  expect(viewA.salesCount).toBe(1)
})
