import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import { chainTransaction, charge, paymentSession, receipt, sale, saleItem } from '../src/db/schema'

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
  for (let i = 0; i < n; i++) {
    // One chain_transaction per receipt: real payments never share a
    // transaction row across history entries for the same owner, and the
    // receipt unique index (transaction_id, owner_user_id) now enforces that.
    const [tx] = await db.insert(chainTransaction).values({
      chargeId: c.id, sender: 'a', recipient: 'b', amountAtomic: 100n,
      hash: crypto.randomUUID().replaceAll('-', ''), status: 'CONFIRMED',
    }).returning()
    await db.insert(receipt).values({
      transactionId: tx.id, ownerUserId: ownerId, role: i % 2 ? 'payer' : 'receiver',
      snapshotJson: { amountNim: String(i), reference: i % 5 === 0 ? `soda-${i}` : `other-${i}` },
      createdAt: new Date(Date.UTC(2026, 6, 1) - i * 86_400_000), // one per day back from Jul 1
    })
  }
}

it('paginates by cursor; filters by text, amount, role and date range', async () => {
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

  // seeded one receipt per day going back from Jul 1
  const oneDay = (await app.inject({
    url: '/v1/history?from=2026-06-21&to=2026-06-21', headers: h })).json()
  expect(oneDay.items).toHaveLength(1)
  const range = (await app.inject({
    url: '/v1/history?from=2026-06-25&to=2026-06-30', headers: h })).json()
  expect(range.items).toHaveLength(6) // inclusive on both ends
  expect(range.items.every((i: { sessionId?: string }) => typeof i.sessionId === 'string')).toBe(true)
})

/** A paid cash sale with its lines, at a chosen instant. */
async function cashSale(sellerId: string, at: Date, lines: [string, number, number][],
  status = 'paid') {
  const total = lines.reduce((sum, [, price, qty]) => sum + price * qty, 0)
  const [s] = await db.insert(sale).values({
    sellerUserId: sellerId, status, paymentMethod: 'cash', totalMinor: total,
    createdAt: at, paidAt: status === 'paid' ? at : null,
  }).returning()
  await db.insert(saleItem).values(lines.map(([name, price, qty], i) => ({
    saleId: s.id, nameSnapshot: name, unitPriceMinor: price, quantity: qty,
    lineTotalMinor: price * qty, sortOrder: i,
  })))
  return s
}

type Item = { kind?: string; saleId?: string; receiptId?: string; role: string
  snapshot: { reference?: string; amountFiatMinor?: number; fiatCurrency?: string
    paymentMethod?: string; amountNim?: string | null; fxRate?: string | null } }

it('merges paid cash sales into history: owner only, receiver role, q by item name', async () => {
  const owner = await makeUser(db, `NQ62 ${crypto.randomUUID().slice(0, 8)}`)
  const stranger = await makeUser(db, `NQ63 ${crypto.randomUUID().slice(0, 8)}`)
  const paid = await cashSale(owner.id, new Date(Date.UTC(2026, 7, 2)),
    [['Soda', 500, 2], ['Sandwich', 500, 1]])
  await cashSale(owner.id, new Date(Date.UTC(2026, 7, 3)), [['Beer', 400, 1]], 'awaiting')
  await cashSale(owner.id, new Date(Date.UTC(2026, 7, 4)), [['Wine', 900, 1]], 'cancelled')
  const h = { authorization: `Bearer ${await tokenFor(owner)}` }

  const all: Item[] = (await app.inject({ url: '/v1/history', headers: h })).json().items
  const cash = all.filter(i => i.kind === 'cash')
  expect(cash).toHaveLength(1)
  expect(cash[0].saleId).toBe(paid.id)
  expect(cash[0].role).toBe('receiver')
  expect(cash[0].snapshot).toMatchObject({
    reference: 'Soda × 2, Sandwich', amountFiatMinor: 1500,
    fiatCurrency: 'USD', paymentMethod: 'cash',
  })
  // Seeded without fx columns, like every sale row that predates them: the
  // NIM value is absent rather than re-derived from today's rate (ruling P5).
  expect(cash[0].snapshot.amountNim).toBeNull()
  expect(cash[0].snapshot.fxRate).toBeNull()

  // 'awaiting' and 'cancelled' cash sales are not takings.
  expect(all.some(i => i.snapshot.reference === 'Beer')).toBe(false)
  expect(all.some(i => i.snapshot.reference === 'Wine')).toBe(false)

  // another vendor never sees it
  const other = { authorization: `Bearer ${await tokenFor(stranger)}` }
  const theirs: Item[] = (await app.inject({ url: '/v1/history', headers: other })).json().items
  expect(theirs.some(i => i.kind === 'cash')).toBe(false)

  // cash is money received: role=payer drops it, role=receiver keeps it
  const payer: Item[] = (await app.inject({ url: '/v1/history?role=payer', headers: h })).json().items
  expect(payer.some(i => i.kind === 'cash')).toBe(false)
  const recv: Item[] = (await app.inject({ url: '/v1/history?role=receiver', headers: h })).json().items
  expect(recv.some(i => i.saleId === paid.id)).toBe(true)

  // q matches a sale_item name
  const soda: Item[] = (await app.inject({ url: '/v1/history?q=Soda', headers: h })).json().items
  expect(soda.map(i => i.saleId)).toContain(paid.id)
  const none: Item[] = (await app.inject({ url: '/v1/history?q=zzz', headers: h })).json().items
  expect(none.some(i => i.kind === 'cash')).toBe(false)
})

it('pages a mixed receipt/cash list without gaps or duplicates', async () => {
  const owner = await makeUser(db, `NQ64 ${crypto.randomUUID().slice(0, 8)}`)
  const other = await makeUser(db, `NQ65 ${crypto.randomUUID().slice(0, 8)}`)
  await seed(owner.id, other.id, 3) // Jul 1, Jun 30, Jun 29
  // interleave three cash sales between the receipt days
  for (let i = 0; i < 3; i++)
    await cashSale(owner.id, new Date(Date.UTC(2026, 5, 29, 12) + i * 86_400_000),
      [[`Cash ${i}`, 100 * (i + 1), 1]])
  const h = { authorization: `Bearer ${await tokenFor(owner)}` }

  const seen: Item[] = []
  let cursor: string | null = null
  for (let page = 0; page < 4; page++) {
    const url: string = `/v1/history?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res: { items: Item[]; nextCursor: string | null } =
      (await app.inject({ url, headers: h })).json()
    seen.push(...res.items)
    cursor = res.nextCursor
    if (!cursor) break
  }
  const keys = seen.map(i => i.receiptId ?? i.saleId)
  expect(new Set(keys).size).toBe(6) // no duplicates
  expect(keys).toHaveLength(6) // no gaps
  expect(seen.filter(i => i.kind === 'cash')).toHaveLength(3)
})
