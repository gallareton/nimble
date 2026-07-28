import { and, eq } from 'drizzle-orm'
import { idempotencyRecord } from '../db/schema'
import type { Db } from '../db/client'

const TTL_MS = 24 * 60 * 60 * 1000

export async function withIdempotency<T>(
  db: Db, scope: string, key: string, requestHash: string,
  handler: () => Promise<{ code: number; body: T }>,
): Promise<{ code: number; body: T; replayed: boolean }> {
  const inserted = await db.insert(idempotencyRecord)
    .values({ scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) })
    .onConflictDoNothing().returning()

  if (inserted.length === 0) {
    for (let i = 0; i < 3; i++) {
      const [row] = await db.select().from(idempotencyRecord)
        .where(and(eq(idempotencyRecord.scope, scope), eq(idempotencyRecord.key, key)))
      if (row && row.requestHash !== requestHash)
        return { code: 409, body: { error: { code: 'IDEMPOTENCY_MISMATCH', message: 'key reused with different payload' } } as T, replayed: true }
      if (row?.responseCode != null)
        return { code: row.responseCode, body: row.responseBody as T, replayed: true }
      await new Promise(r => setTimeout(r, 100 * (i + 1)))
    }
    return { code: 409, body: { error: { code: 'IDEMPOTENCY_PENDING', message: 'retry shortly' } } as T, replayed: true }
  }

  const result = await handler()
  await db.update(idempotencyRecord)
    .set({ responseCode: result.code, responseBody: result.body as object })
    .where(and(eq(idempotencyRecord.scope, scope), eq(idempotencyRecord.key, key)))
  return { ...result, replayed: false }
}
