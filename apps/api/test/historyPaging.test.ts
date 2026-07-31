import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import { chainTransaction, charge, paymentSession, receipt } from '../src/db/schema'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

async function seed(ownerId: string, otherId: string, n: number) {
  const [s] = await db.insert(paymentSession).values({
    payerUserId: ownerId, receiverUserId: otherId, codeHash: 'x',
    status: 'CONFIRMED', expiresAt: new Date(),
  }).returning()
  const [c] = await db.insert(charge).values({
    sessionId: s.id, amountAtomic: 100n, recipientAddress: 'NQ00',
  }).returning()
  const [tx] = await db.insert(chainTransaction).values({
    chargeId: c.id, sender: 'a', recipient: 'b', amountAtomic: 100n,
    hash: crypto.randomUUID().replaceAll('-', ''), status: 'CONFIRMED',
  }).returning()
  for (let i = 0; i < n; i++) {
    await db.insert(receipt).values({
      transactionId: tx.id, ownerUserId: ownerId, role: i % 2 ? 'payer' : 'receiver',
      snapshotJson: { amountNim: String(i), reference: i % 5 === 0 ? `soda-${i}` : `other-${i}` },
      createdAt: new Date(Date.UTC(2026, 6, 1) - i * 86_400_000), // one per day back from Jul 1
    })
  }
}

it('paginates by cursor; filters by text, amount, role and date', async () => {
  const owner = await makeUser(db, `NQ60 ${crypto.randomUUID().slice(0, 8)}`)
  const other = await makeUser(db, `NQ61 ${crypto.randomUUID().slice(0, 8)}`)
  await seed(owner.id, other.id, 25)
  const t = await tokenFor(owner)
  const h = { authorization: `Bearer ${t}` }

  const p1 = (await app.inject({ url: '/v1/history', headers: h })).json()
  expect(p1.items).toHaveLength(20)
  expect(p1.nextCursor).toBeTruthy()

  const p2 = (await app.inject({ url: `/v1/history?cursor=${encodeURIComponent(p1.nextCursor)}`,
    headers: h })).json()
  expect(p2.items).toHaveLength(5)
  expect(p2.nextCursor).toBeNull()
  const ids = new Set([...p1.items, ...p2.items].map((i: { receiptId: string }) => i.receiptId))
  expect(ids.size).toBe(25)

  const soda = (await app.inject({ url: '/v1/history?q=soda', headers: h })).json()
  expect(soda.items).toHaveLength(5)

  const amount = (await app.inject({ url: '/v1/history?q=7', headers: h })).json()
  expect(amount.items.some((i: { snapshot: { amountNim: string } }) => i.snapshot.amountNim === '7')).toBe(true)

  const sent = (await app.inject({ url: '/v1/history?role=payer', headers: h })).json()
  expect(sent.items.every((i: { role: string }) => i.role === 'payer')).toBe(true)

  // seeded one receipt per day: 2026-06-21 is 10 days before Jul 1
  const day = (await app.inject({ url: '/v1/history?q=2026-06-21', headers: h })).json()
  expect(day.items).toHaveLength(1)
  const dayPl = (await app.inject({ url: '/v1/history?q=21.06.2026', headers: h })).json()
  expect(dayPl.items).toHaveLength(1)
})
