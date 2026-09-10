import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { paymentSession, sale, saleItem, shift, userProfile } from '../src/db/schema'
import { freshDb } from './helpers/db'

const { db, close } = await freshDb()
afterAll(close)

it('enforces one AVAILABLE code per payer', async () => {
  const [u] = await db.insert(userProfile).values({ walletAddress: 'NQ01 TEST' }).returning()
  const expiresAt = new Date(Date.now() + 120_000)
  await db.insert(paymentSession).values({ payerUserId: u.id, codeHash: 'h1', expiresAt })
  await expect(
    db.insert(paymentSession).values({ payerUserId: u.id, codeHash: 'h2', expiresAt }),
  ).rejects.toThrow(/one_available_code_per_payer/)
})

it('allows only one open shift per user', async () => {
  const [u] = await db.insert(userProfile).values({ walletAddress: `NQ90 ${crypto.randomUUID().slice(0, 8)}` }).returning()
  await db.insert(shift).values({ userId: u.id, operatorLabel: 'Ana' })
  await expect(
    db.insert(shift).values({ userId: u.id, operatorLabel: 'Bo' }),
  ).rejects.toThrow()
  // closing the first one frees the slot
  await db.update(shift).set({ closedAt: new Date() }).where(eq(shift.userId, u.id))
  await expect(db.insert(shift).values({ userId: u.id, operatorLabel: 'Bo' })).resolves.toBeDefined()
})

it('allows a sale_item with no productId (a line rung up outside the catalog)', async () => {
  const [u] = await db.insert(userProfile).values({ walletAddress: `NQ91 ${crypto.randomUUID().slice(0, 8)}` }).returning()
  const [s] = await db.insert(sale).values({
    sellerUserId: u.id, paymentMethod: 'cash', totalMinor: 500,
  }).returning()
  await expect(db.insert(saleItem).values({
    saleId: s.id, productId: null, nameSnapshot: 'Custom item',
    unitPriceMinor: 500, quantity: 1, lineTotalMinor: 500,
  })).resolves.toBeDefined()
})
