import { desc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { lunaToNim } from '@nimble/shared'
import { chainTransaction, charge, paymentSession, receipt } from '../db/schema'

export async function historyRoutes(app: FastifyInstance) {
  app.get('/v1/history', { preHandler: app.authenticate }, async req => {
    const db = app.deps.db

    // Payments that are already paid (or at least broadcast) but not yet
    // finalized: they must show up in history immediately, marked pending —
    // the receipt replaces them once the macro block seals the batch.
    const inflight = await db.select({ tx: chainTransaction, c: charge, s: paymentSession })
      .from(chainTransaction)
      .innerJoin(charge, eq(charge.id, chainTransaction.chargeId))
      .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
      .where(inArray(chainTransaction.status, ['SUBMITTED', 'CONFIRMING', 'DELAYED']))
      .orderBy(desc(chainTransaction.submittedAt)).limit(10)
    const mine = inflight.filter(({ s }) =>
      s.payerUserId === req.user.userId || s.receiverUserId === req.user.userId)

    const rows = await db.select().from(receipt)
      .where(eq(receipt.ownerUserId, req.user.userId))
      .orderBy(desc(receipt.createdAt)).limit(50)

    return {
      items: [
        ...mine.map(({ tx, c, s }) => ({
          pending: true as const,
          sessionId: s.id,
          status: tx.status,
          role: s.payerUserId === req.user.userId ? 'payer' : 'receiver',
          snapshot: {
            amountLuna: tx.amountAtomic.toString(), amountNim: lunaToNim(tx.amountAtomic),
            asset: 'NIM', network: 'nimiq', hash: tx.hash, reference: c.reference,
          },
          createdAt: tx.submittedAt.toISOString(),
        })),
        ...rows.map(r => ({ receiptId: r.id, role: r.role, snapshot: r.snapshotJson,
          createdAt: r.createdAt.toISOString() })),
      ],
      nextCursor: null,
    }
  })
}
