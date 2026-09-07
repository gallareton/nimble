import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { charge, chargeRequest, paymentSession, userProfile } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { sweepOnce } from '../src/services/sweeper'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
app.deps.rates = {
  getUsdPerNim: async () => 0.005,
  quoteUsdPerNim: async () => ({ value: 0.005, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

async function issueChargeRequest(rt: string, payload: object) {
  return app.inject({ method: 'POST', url: '/v1/charge-requests', payload,
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
}
const previewChargeRequest = (id: string) => app.inject({ url: `/v1/charge-requests/${id}` })
const acceptChargeRequest = (id: string, t: string) =>
  app.inject({ method: 'POST', url: `/v1/charge-requests/${id}/accept`,
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

async function makeReceiver() {
  const [u] = await db.insert(userProfile).values({ walletAddress: `NQ80 ${crypto.randomUUID().slice(0, 8)}` }).returning()
  return u
}

async function pairedSession(receiverId: string) {
  const [payer] = await db.insert(userProfile).values({ walletAddress: `NQ81 ${crypto.randomUUID().slice(0, 8)}` }).returning()
  const [s] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiverId, codeHash: crypto.randomUUID(),
    status: 'CLAIMED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  return s
}

it('shared insertCharge freezes a fiat quote onto the row', async () => {
  const receiver = await makeReceiver()
  const s = await pairedSession(receiver.id)
  const fxRateAt = new Date()
  const c = await insertCharge(db, {
    sessionId: s.id, amountAtomic: 250_000n,
    fiatAmountMinor: 1234, fiatCurrency: 'USD', fxRate: '0.005', fxRateAt, fxSource: 'test-fixture',
    reference: 'Soda', recipientAddress: receiver.walletAddress, shiftId: null,
  })
  expect(c.sessionId).toBe(s.id)
  expect(c.amountAtomic).toBe(250_000n)
  expect(c.fiatAmountMinor).toBe(1234)
  expect(c.fiatCurrency).toBe('USD')
  expect(c.fxRate).toBe('0.005')
  expect(c.fxRateAt?.getTime()).toBe(fxRateAt.getTime())
  expect(c.fxSource).toBe('test-fixture')
  expect(c.reference).toBe('Soda')
  expect(c.recipientAddress).toBe(receiver.walletAddress)
})

it('shared insertCharge accepts a luna-only price with empty fiat fields', async () => {
  const receiver = await makeReceiver()
  const s = await pairedSession(receiver.id)
  const c = await insertCharge(db, {
    sessionId: s.id, amountAtomic: 100_000n,
    recipientAddress: receiver.walletAddress,
  })
  expect(c.amountAtomic).toBe(100_000n)
  expect(c.fiatAmountMinor).toBeNull()
  expect(c.fiatCurrency).toBeNull()
  expect(c.fxRate).toBeNull()
  expect(c.fxRateAt).toBeNull()
  expect(c.fxSource).toBeNull()
  expect(c.reference).toBeNull()
})

it('one_session_per_request rejects a second request on the same session but allows many null sessions', async () => {
  const receiver = await makeReceiver()
  const s = await pairedSession(receiver.id)
  const expiresAt = new Date(Date.now() + 3_600_000)

  await db.insert(chargeRequest).values({
    receiverUserId: receiver.id, amountAtomic: 100_000n, expiresAt, sessionId: s.id,
  })
  await expect(
    db.insert(chargeRequest).values({
      receiverUserId: receiver.id, amountAtomic: 200_000n, expiresAt, sessionId: s.id,
    }),
  ).rejects.toThrow(/one_session_per_request/)

  // Unmaterialized requests (sessionId still null) never collide with each
  // other — NULL <> NULL in Postgres, so the partial index only guards rows
  // that actually point at a session.
  await db.insert(chargeRequest).values({ receiverUserId: receiver.id, amountAtomic: 100_000n, expiresAt })
  await db.insert(chargeRequest).values({ receiverUserId: receiver.id, amountAtomic: 150_000n, expiresAt })
  const rows = await db.select().from(chargeRequest).where(eq(chargeRequest.receiverUserId, receiver.id))
  expect(rows.filter(r => r.sessionId === null).length).toBe(2)
})

it('POST /v1/charge-requests prices from fiat and freezes the quote on the row', async () => {
  const receiver = await makeUser(db, `NQ82 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const res = await issueChargeRequest(rt, { fiatAmountMinor: 1234, fiatCurrency: 'USD', reference: 'Invoice #1' })
  expect(res.statusCode).toBe(201)
  const { id, expiresAt } = res.json()
  expect(id).toBeTruthy()
  expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())

  const [row] = await db.select().from(chargeRequest).where(eq(chargeRequest.id, id))
  expect(row.fiatAmountMinor).toBe(1234)
  expect(row.fiatCurrency).toBe('USD')
  expect(row.fxRate).toBeTruthy()
  expect(row.fxRateAt).toBeTruthy()
  expect(row.fxSource).toBe('test-fixture')
  expect(row.amountAtomic).toBeGreaterThan(0n)
  expect(row.reference).toBe('Invoice #1')
})

it('GET preview returns the amount and receiver name, never the id, receiverUserId, or full address', async () => {
  const receiver = await makeUser(db, `NQ83 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { id } = (await issueChargeRequest(rt, { amountLuna: '250000', reference: 'Coffee' })).json()

  const res = await previewChargeRequest(id)
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.amountLuna).toBe('250000')
  expect(body.reference).toBe('Coffee')
  expect(body.receiverDisplayName).toContain(receiver.walletAddress.slice(-4))
  expect(body.receiverAddressTail).toBe(receiver.walletAddress.slice(-4))
  expect(body.state).toBe('open')

  // Never the internal id, the receiver's user id, or their full address.
  expect(body.id).toBeUndefined()
  expect(body.receiverUserId).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain(receiver.walletAddress)
})

it('preview of an unknown id is 404; expired and accepted requests give different, recognizable states', async () => {
  const notFound = await previewChargeRequest(crypto.randomUUID())
  expect(notFound.statusCode).toBe(404)

  const receiver = await makeUser(db, `NQ84 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)

  const { id: expiredId } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()
  await db.update(chargeRequest).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(chargeRequest.id, expiredId))
  const expiredPreview = await previewChargeRequest(expiredId)
  expect(expiredPreview.statusCode).toBe(200)
  expect(expiredPreview.json().state).toBe('expired')

  const { id: acceptedId } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()
  const payer = await makeUser(db, `NQ85 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const acceptRes = await acceptChargeRequest(acceptedId, pt)
  expect(acceptRes.statusCode).toBe(201)
  const paidPreview = await previewChargeRequest(acceptedId)
  expect(paidPreview.statusCode).toBe(200)
  expect(paidPreview.json().state).toBe('paid')

  expect(expiredPreview.json().state).not.toBe(paidPreview.json().state)
})

it('accept creates a session and a charge stamped with the shift open at acceptance, not at issuance', async () => {
  const receiver = await makeUser(db, `NQ86 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { id } = (await issueChargeRequest(rt, { amountLuna: '300000', reference: 'Lunch' })).json()

  // Shift opens only after the request was issued — proves the charge takes
  // the shift open at accept time, not a shift that existed at issuance
  // (there was none).
  const openShift = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: { authorization: `Bearer ${rt}` } })).json()

  const payer = await makeUser(db, `NQ87 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const res = await acceptChargeRequest(id, pt)
  expect(res.statusCode).toBe(201)
  const { sessionId, chargeId } = res.json()
  expect(sessionId).toBeTruthy()
  expect(chargeId).toBeTruthy()

  const [session] = await db.select().from(paymentSession).where(eq(paymentSession.id, sessionId))
  expect(session.status).toBe('AWAITING_PAYER_APPROVAL')
  expect(session.payerUserId).toBe(payer.id)
  expect(session.receiverUserId).toBe(receiver.id)

  const [c] = await db.select().from(charge).where(eq(charge.id, chargeId))
  expect(c.sessionId).toBe(sessionId)
  expect(c.amountAtomic).toBe(300_000n)
  expect(c.shiftId).toBe(openShift.id)
  expect(c.reference).toBe('Lunch')

  const [row] = await db.select().from(chargeRequest).where(eq(chargeRequest.id, id))
  expect(row.sessionId).toBe(sessionId)
})

it('a second accept of the same request gets 409', async () => {
  const receiver = await makeUser(db, `NQ88 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { id } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()

  const payer1 = await makeUser(db, `NQ89 ${crypto.randomUUID().slice(0, 8)}`)
  const payer2 = await makeUser(db, `NQ90 ${crypto.randomUUID().slice(0, 8)}`)
  const first = await acceptChargeRequest(id, await tokenFor(payer1))
  expect(first.statusCode).toBe(201)
  const second = await acceptChargeRequest(id, await tokenFor(payer2))
  expect(second.statusCode).toBe(409)
})

it('the issuer cannot accept their own charge request', async () => {
  const receiver = await makeUser(db, `NQ91 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { id } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()
  const res = await acceptChargeRequest(id, rt)
  expect(res.statusCode).toBe(400)
})

it('sweeper deletes expired unmaterialized requests but leaves materialized (accepted) ones', async () => {
  const receiver = await makeUser(db, `NQ92 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  const { id: expiredId } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()
  await db.update(chargeRequest).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(chargeRequest.id, expiredId))

  const { id: acceptedId } = (await issueChargeRequest(rt, { amountLuna: '100000' })).json()
  const payer = await makeUser(db, `NQ93 ${crypto.randomUUID().slice(0, 8)}`)
  await acceptChargeRequest(acceptedId, await tokenFor(payer))
  // Even the accepted (materialized) request's own expiresAt has passed —
  // the sweeper must still leave it alone because session_id is set.
  await db.update(chargeRequest).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(chargeRequest.id, acceptedId))

  const res = await sweepOnce(db, app.deps.events)
  expect(res.chargeRequestsPurged).toBeGreaterThanOrEqual(1)

  const [gone] = await db.select().from(chargeRequest).where(eq(chargeRequest.id, expiredId))
  expect(gone).toBeUndefined()
  const [kept] = await db.select().from(chargeRequest).where(eq(chargeRequest.id, acceptedId))
  expect(kept).toBeTruthy()
})
