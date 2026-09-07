import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chargeRequest, paymentSession, userProfile } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { freshDb } from './helpers/db'

const { db, close } = await freshDb()
afterAll(close)

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
