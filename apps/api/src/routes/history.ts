import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { lunaToNim } from '@nimble/shared'
import { chainTransaction, charge, paymentSession, receipt } from '../db/schema'

const PAGE_LIMIT = 20

// "2026-07-30" or "30.07.2026" → UTC day range, else null.
function parseDayQuery(q: string): { from: Date; to: Date } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q)
  let y: number, mo: number, d: number
  if (m) { [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] }
  else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(q)
    if (!m) return null
    ;[d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const from = new Date(Date.UTC(y, mo - 1, d))
  if (Number.isNaN(from.getTime())) return null
  return { from, to: new Date(from.getTime() + 24 * 3600_000) }
}

export async function historyRoutes(app: FastifyInstance) {
  app.get('/v1/history', { preHandler: app.authenticate }, async req => {
    const db = app.deps.db
    const query = req.query as { cursor?: string; q?: string; role?: string; limit?: string }
    const limit = Math.min(50, Math.max(1, Number(query.limit) || PAGE_LIMIT))
    const q = (query.q ?? '').trim()
    const roleFilter = query.role === 'payer' || query.role === 'receiver' ? query.role : null

    const conds = [eq(receipt.ownerUserId, req.user.userId)]
    if (roleFilter) conds.push(eq(receipt.role, roleFilter))
    if (q) {
      const day = parseDayQuery(q)
      if (day) {
        conds.push(sql`${receipt.createdAt} >= ${day.from.toISOString()}::timestamptz AND ${receipt.createdAt} < ${day.to.toISOString()}::timestamptz`)
      } else {
        conds.push(sql`(${receipt.snapshotJson}->>'reference' ILIKE ${'%' + q + '%'}
          OR ${receipt.snapshotJson}->>'amountNim' = ${q})`)
      }
    }
    // Cursor = "<createdAtISO>_<id>": receipts for both sides of a payment
    // share a timestamp, so paginate on the (created_at, id) tuple.
    if (query.cursor) {
      const sep = query.cursor.lastIndexOf('_')
      const ts = new Date(query.cursor.slice(0, sep))
      const id = query.cursor.slice(sep + 1)
      if (!Number.isNaN(ts.getTime()))
        conds.push(sql`(${receipt.createdAt}, ${receipt.id}) < (${ts.toISOString()}::timestamptz, ${id}::uuid)`)
    }

    const rows = await db.select().from(receipt).where(and(...conds))
      .orderBy(desc(receipt.createdAt), desc(receipt.id)).limit(limit)

    // In-flight (paid, not yet finalized) rows lead the FIRST unfiltered
    // page; the receipt replaces them at finality.
    let pendingItems: object[] = []
    if (!query.cursor && !q && !roleFilter) {
      const inflight = await db.select({ tx: chainTransaction, c: charge, s: paymentSession })
        .from(chainTransaction)
        .innerJoin(charge, eq(charge.id, chainTransaction.chargeId))
        .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
        .where(inArray(chainTransaction.status, ['SUBMITTED', 'CONFIRMING', 'DELAYED']))
        .orderBy(desc(chainTransaction.submittedAt)).limit(10)
      pendingItems = inflight
        .filter(({ s }) => s.payerUserId === req.user.userId || s.receiverUserId === req.user.userId)
        .map(({ tx, c, s }) => ({
          pending: true as const,
          sessionId: s.id,
          status: tx.status,
          role: s.payerUserId === req.user.userId ? 'payer' : 'receiver',
          snapshot: {
            amountLuna: tx.amountAtomic.toString(), amountNim: lunaToNim(tx.amountAtomic),
            asset: 'NIM', network: 'nimiq', hash: tx.hash, reference: c.reference,
          },
          createdAt: tx.submittedAt.toISOString(),
        }))
    }

    const last = rows[rows.length - 1]
    return {
      items: [
        ...pendingItems,
        ...rows.map(r => ({ receiptId: r.id, role: r.role, snapshot: r.snapshotJson,
          createdAt: r.createdAt.toISOString() })),
      ],
      nextCursor: rows.length === limit ? `${last.createdAt.toISOString()}_${last.id}` : null,
    }
  })
}
