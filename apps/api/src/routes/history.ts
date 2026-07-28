import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { receipt } from '../db/schema'

export async function historyRoutes(app: FastifyInstance) {
  app.get('/v1/history', { preHandler: app.authenticate }, async req => {
    const rows = await app.deps.db.select().from(receipt)
      .where(eq(receipt.ownerUserId, req.user.userId))
      .orderBy(desc(receipt.createdAt)).limit(50)
    return {
      items: rows.map(r => ({ receiptId: r.id, role: r.role, snapshot: r.snapshotJson,
        createdAt: r.createdAt.toISOString() })),
      nextCursor: null,
    }
  })
}
