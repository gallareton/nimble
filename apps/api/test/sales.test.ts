import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chainTransaction, charge, paymentSession, sale } from '../src/db/schema'
import { monitorTick } from '../src/services/monitor'
import { SessionEvents } from '../src/services/events'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import { nullRates } from '../src/services/rates'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
app.deps.rates = {
  getUsdPerNim: async () => 0.004,
  quoteUsdPerNim: async () => ({ value: 0.004, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

async function vendor() {
  const u = await makeUser(db, `NQ90 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = (t: string) => ({ authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() })

const createProduct = (t: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/products', payload, headers: idem(t) })
const createSale = (t: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/sales', payload, headers: idem(t) })
const getSale = (t: string, id: string) =>
  app.inject({ url: `/v1/sales/${id}`, headers: auth(t) })
const cancelSale = (t: string, id: string) =>
  app.inject({ method: 'POST', url: `/v1/sales/${id}/cancel`, headers: auth(t) })
const openShift = (t: string) =>
  app.inject({ method: 'POST', url: '/v1/shifts', payload: { operatorLabel: 'Ana' }, headers: auth(t) })

/** Drives a payment session's status directly, mirroring shifts.test.ts /
 *  refund.test.ts — these tests care about how a sale's state reacts to a
 *  session outcome, not about the signing flow that produces it. */
async function confirmSession(sessionId: string) {
  await db.update(paymentSession).set({ status: 'CONFIRMED' }).where(eq(paymentSession.id, sessionId))
}

it('a cash sale is paid immediately, stamped with the open shift', async () => {
  const { t } = await vendor()
  const { id: shiftId } = (await openShift(t)).json()

  const res = await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 350, quantity: 2 }], paymentMethod: 'cash' })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.status).toBe('paid')
  expect(body.state).toBe('paid')
  expect(body.paidAt).not.toBeNull()
  expect(body.shiftId).toBe(shiftId)
  expect(body.totalMinor).toBe(700)
  expect(body.items).toEqual([{ productId: null, name: 'Coffee', unitPriceMinor: 350, quantity: 2, lineTotalMinor: 700 }])
})

it('a client cannot undercut a catalog item\'s price', async () => {
  const { t } = await vendor()
  const product = (await createProduct(t, { name: 'Coffee', priceMinor: 500 })).json()

  const res = await createSale(t, {
    items: [{ productId: product.id, unitPriceMinor: 1, quantity: 1 }], paymentMethod: 'cash',
  })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.totalMinor).toBe(500)
  expect(body.items[0].unitPriceMinor).toBe(500)
  expect(body.items[0].name).toBe('Coffee')
})

it('a non-catalog item without a price is rejected', async () => {
  const { t } = await vendor()
  const res = await createSale(t, { items: [{ name: 'Mystery', quantity: 1 }], paymentMethod: 'cash' })
  expect(res.statusCode).toBe(400)
})

it('a NIM sale is claimed with saleId: the charge carries saleId and the sale\'s frozen total', async () => {
  const { t: vendorToken } = await vendor()
  const { u: payer, t: payerToken } = await vendor()

  const saleRes = await createSale(vendorToken, {
    items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 3 }], paymentMethod: 'nim',
  })
  expect(saleRes.statusCode).toBe(201)
  const s = saleRes.json()
  expect(s.status).toBe('awaiting')
  expect(s.state).toBe('awaiting')
  expect(s.totalMinor).toBe(1200)

  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerToken) })).json()
  const claimRes = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, saleId: s.id }, headers: idem(vendorToken) })
  expect(claimRes.statusCode).toBe(200)
  const { chargeId } = claimRes.json()
  expect(chargeId).toBeTruthy()

  const [c] = await db.select().from(charge).where(eq(charge.id, chargeId))
  expect(c.saleId).toBe(s.id)
  expect(c.fiatAmountMinor).toBe(1200)
  expect(c.fiatCurrency).toBe('USD')

  const [updatedSale] = await db.select().from(sale).where(eq(sale.id, s.id))
  expect(updatedSale.chargeId).toBe(chargeId)

  const view = (await getSale(vendorToken, s.id)).json()
  expect(view.chargeId).toBe(chargeId)
  expect(view.state).toBe('awaiting')
  void payer
})

it('claiming with both saleId and amountLuna is rejected', async () => {
  const { t: vendorToken } = await vendor()
  const { t: payerToken } = await vendor()
  const saleRes = await createSale(vendorToken, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })
  const s = saleRes.json()

  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerToken) })).json()
  const claimRes = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code, saleId: s.id, amountLuna: '1000000' }, headers: idem(vendorToken) })
  // Every malformed claim body on this route — this one included — folds
  // into the same generic "code unavailable" 404 as a wrong code, by
  // deliberate design (anti-enumeration, see routes/sessions.ts claim
  // handler's safeParse branch). It never reaches the sale at all.
  expect(claimRes.statusCode).toBe(404)
  expect(claimRes.json().error.code).toBe('CODE_UNAVAILABLE')
})

it('state resolves to paid when the session confirms, failed when it is rejected', async () => {
  const { t: vendorToken } = await vendor()
  const { t: payerAToken } = await vendor()
  const { t: payerBToken } = await vendor()

  // paid path
  const saleA = (await createSale(vendorToken, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })).json()
  const claimA = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerAToken) })).json()
  const claimResA = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code: claimA.code, saleId: saleA.id }, headers: idem(vendorToken) })
  const { sessionId: sessionIdA, chargeId: chargeIdA } = claimResA.json()

  const events = new SessionEvents()
  const [txA] = await db.insert(chainTransaction).values({
    chargeId: chargeIdA, sender: 'NQpayerA', recipient: 'NQvendor', amountAtomic: 1n, hash: crypto.randomUUID(),
  }).returning()
  let macro = 90
  const chain = {
    findIncomingByData: async () => null,
    getTransaction: async () => ({ includedAtHeight: 100, expired: false }),
    getLastMacroHeight: async () => macro,
  }
  await monitorTick(db, events, chain)
  macro = 120
  await monitorTick(db, events, chain)
  void txA

  const viewA = (await getSale(vendorToken, saleA.id)).json()
  expect(viewA.status).toBe('awaiting') // stored column never flips for NIM
  expect(viewA.state).toBe('paid')
  expect(viewA.paidAt).not.toBeNull()

  // failed path (session rejected instead of confirmed)
  const saleB = (await createSale(vendorToken, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })).json()
  const claimB = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerBToken) })).json()
  const claimResB = await app.inject({ method: 'POST', url: '/v1/sessions/claim',
    payload: { code: claimB.code, saleId: saleB.id }, headers: idem(vendorToken) })
  const { sessionId: sessionIdB } = claimResB.json()
  await db.update(paymentSession).set({ status: 'REJECTED' }).where(eq(paymentSession.id, sessionIdB))

  const viewB = (await getSale(vendorToken, saleB.id)).json()
  expect(viewB.state).toBe('failed')
  void sessionIdA
})

it('cancelling a sale once a charge is attached is refused', async () => {
  const { t: vendorToken } = await vendor()
  const { t: payerToken } = await vendor()
  const s = (await createSale(vendorToken, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })).json()

  const { code } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(payerToken) })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code, saleId: s.id }, headers: idem(vendorToken) })

  const cancelRes = await cancelSale(vendorToken, s.id)
  expect(cancelRes.statusCode).toBe(409)
})

it('cancelling an untouched awaiting sale succeeds', async () => {
  const { t } = await vendor()
  const s = (await createSale(t, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })).json()
  const res = await cancelSale(t, s.id)
  expect(res.statusCode).toBe(200)
  expect(res.json().state).toBe('cancelled')

  // idempotent: cancelling again still succeeds
  const again = await cancelSale(t, s.id)
  expect(again.statusCode).toBe(200)
  expect(again.json().state).toBe('cancelled')
})

it('a vendor cannot read or cancel another vendor\'s sale', async () => {
  const { t: a } = await vendor()
  const { t: b } = await vendor()
  const s = (await createSale(a, { items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'cash' })).json()
  expect((await getSale(b, s.id)).statusCode).toBe(404)
  expect((await cancelSale(b, s.id)).statusCode).toBe(404)
})

// ── ruling P5: the NIM value of a sale comes from the rate at its moment ──

it('freezes the rate onto a cash sale and carries amountNim into history', async () => {
  const { t } = await vendor()
  const created = (await createSale(t, {
    items: [{ name: 'Soda', unitPriceMinor: 700, quantity: 1 }], paymentMethod: 'cash' })).json()

  const [row] = await db.select().from(sale).where(eq(sale.id, created.id))
  expect(row.fxRate).toBe('0.004')
  expect(row.fxSource).toBe('test-fixture')
  expect(row.fxRateAt).toBeInstanceOf(Date)

  // 7.00 USD at 0.004 USD/NIM = 1750 NIM, from the frozen rate, not a live one.
  const items = (await app.inject({ url: '/v1/history', headers: auth(t) })).json().items
  const cash = items.find((i: { saleId?: string }) => i.saleId === created.id)
  expect(cash.snapshot).toMatchObject({ amountFiatMinor: 700, amountNim: '1750', fxRate: '0.004' })
  expect(typeof cash.snapshot.fxRateAt).toBe('string')
})

it('a nim-priced sale freezes the rate too', async () => {
  const { t } = await vendor()
  const created = (await createSale(t, {
    items: [{ name: 'Tea', unitPriceMinor: 400, quantity: 1 }], paymentMethod: 'nim' })).json()
  const [row] = await db.select().from(sale).where(eq(sale.id, created.id))
  expect(row.fxRate).toBe('0.004')
})

it('still creates a cash sale when no quote is available, with amountNim null', async () => {
  const noRate = authedApp(db, `NQ91 ${crypto.randomUUID().slice(0, 8)}`, { rates: nullRates })
  const u = await makeUser(db, `NQ92 ${crypto.randomUUID().slice(0, 8)}`)
  const tok = await noRate.tokenFor(u)
  const res = await noRate.app.inject({ method: 'POST', url: '/v1/sales',
    payload: { items: [{ name: 'Soda', unitPriceMinor: 700, quantity: 1 }], paymentMethod: 'cash' },
    headers: { authorization: `Bearer ${tok}`, 'idempotency-key': crypto.randomUUID() } })
  expect(res.statusCode).toBe(201)

  const [row] = await db.select().from(sale).where(eq(sale.id, res.json().id))
  expect(row.fxRate).toBeNull()
  expect(row.fxRateAt).toBeNull()
  expect(row.fxSource).toBeNull()

  const items = (await noRate.app.inject({ url: '/v1/history',
    headers: { authorization: `Bearer ${tok}` } })).json().items
  const cash = items.find((i: { saleId?: string }) => i.saleId === row.id)
  expect(cash.snapshot.amountNim).toBeNull()
  expect(cash.snapshot.fxRate).toBeNull()
})
