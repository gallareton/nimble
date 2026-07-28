import { afterAll, expect, it } from 'vitest'
import { paymentSession, userProfile } from '../src/db/schema'
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
