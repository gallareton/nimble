import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { lunaToNim } from '@nimble/shared'
import { chainTransaction, charge, paymentSession, receipt, sale, saleItem } from '../db/schema'

const PAGE_LIMIT = 20

export async function historyRoutes(app: FastifyInstance) {
  app.get('/v1/history', { preHandler: app.authenticate }, async req => {
    const db = app.deps.db
    const query = req.query as {
      cursor?: string; q?: string; role?: string; limit?: string; from?: string; to?: string }
    const limit = Math.min(50, Math.max(1, Number(query.limit) || PAGE_LIMIT))
    const q = (query.q ?? '').trim()
    const roleFilter = query.role === 'payer' || query.role === 'receiver' ? query.role : null

    const conds = [eq(receipt.ownerUserId, req.user.userId)]
    if (roleFilter) conds.push(eq(receipt.role, roleFilter))
    if (q) conds.push(sql`(${receipt.snapshotJson}->>'reference' ILIKE ${'%' + q + '%'}
      OR ${receipt.snapshotJson}->>'amountNim' = ${q})`)
    // Inclusive day range from the UI's date pickers (YYYY-MM-DD, UTC days).
    const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`)
    if (query.from && !Number.isNaN(dayStart(query.from).getTime()))
      conds.push(sql`${receipt.createdAt} >= ${dayStart(query.from).toISOString()}::timestamptz`)
    if (query.to && !Number.isNaN(dayStart(query.to).getTime()))
      conds.push(sql`${receipt.createdAt} < ${new Date(dayStart(query.to).getTime() + 86_400_000).toISOString()}::timestamptz`)
    // Cursor = "<createdAtISO>_<id>": receipts for both sides of a payment
    // share a timestamp, so paginate on the (created_at, id) tuple.
    let cursorTs: Date | null = null
    let cursorId = ''
    if (query.cursor) {
      const sep = query.cursor.lastIndexOf('_')
      const ts = new Date(query.cursor.slice(0, sep))
      const id = query.cursor.slice(sep + 1)
      if (!Number.isNaN(ts.getTime())) {
        cursorTs = ts
        cursorId = id
        conds.push(sql`(${receipt.createdAt}, ${receipt.id}) < (${ts.toISOString()}::timestamptz, ${id}::uuid)`)
      }
    }

    const rows = await db.select({ r: receipt, sessionId: charge.sessionId })
      .from(receipt)
      .leftJoin(chainTransaction, eq(chainTransaction.id, receipt.transactionId))
      .leftJoin(charge, eq(charge.id, chainTransaction.chargeId))
      .where(and(...conds))
      .orderBy(desc(receipt.createdAt), desc(receipt.id)).limit(limit)

    // P3: a cash sale has no receipt (nothing settles on chain), but the
    // vendor still took the money — merge paid cash sales into the same
    // list. The cursor/date/q conditions are rebuilt against `sale`; both
    // tables key on uuids, so the (created_at, id) tuple works per source.
    // Cash is always money received, so role=payer excludes it.
    const cashRows = roleFilter === 'payer' ? [] : await (async () => {
      const cashConds = [eq(sale.sellerUserId, req.user.userId),
        eq(sale.paymentMethod, 'cash'), eq(sale.status, 'paid')]
      if (q) cashConds.push(sql`EXISTS (SELECT 1 FROM ${saleItem} WHERE ${saleItem.saleId} = ${sale.id}
        AND ${saleItem.nameSnapshot} ILIKE ${'%' + q + '%'})`)
      if (query.from && !Number.isNaN(dayStart(query.from).getTime()))
        cashConds.push(sql`${sale.createdAt} >= ${dayStart(query.from).toISOString()}::timestamptz`)
      if (query.to && !Number.isNaN(dayStart(query.to).getTime()))
        cashConds.push(sql`${sale.createdAt} < ${new Date(dayStart(query.to).getTime() + 86_400_000).toISOString()}::timestamptz`)
      if (cursorTs && !Number.isNaN(cursorTs.getTime()))
        cashConds.push(sql`(${sale.createdAt}, ${sale.id}) < (${cursorTs.toISOString()}::timestamptz, ${cursorId}::uuid)`)
      const sales = await db.select().from(sale).where(and(...cashConds))
        .orderBy(desc(sale.createdAt), desc(sale.id)).limit(limit)
      if (sales.length === 0) return []
      const lines = await db.select().from(saleItem)
        .where(inArray(saleItem.saleId, sales.map(s => s.id)))
        .orderBy(saleItem.sortOrder)
      return sales.map(s => {
        const reference = lines.filter(l => l.saleId === s.id)
          .map(l => l.quantity > 1 ? `${l.nameSnapshot} \u00d7 ${l.quantity}` : l.nameSnapshot)
          .join(', ')
        return {
          id: s.id, createdAt: s.createdAt,
          item: {
            kind: 'cash' as const, saleId: s.id, role: 'receiver',
            snapshot: { amountFiatMinor: s.totalMinor, fiatCurrency: s.fiatCurrency,
              reference, paymentMethod: 'cash' },
            createdAt: s.createdAt.toISOString(),
          },
        }
      })
    })()

    // In-flight (paid, not yet finalized) rows lead the FIRST unfiltered
    // page; the receipt replaces them at finality.
    let pendingItems: object[] = []
    if (!query.cursor && !q && !roleFilter && !query.from && !query.to) {
      const inflight = await db.select({ tx: chainTransaction, c: charge, s: paymentSession })
        .from(chainTransaction)
        .innerJoin(charge, eq(charge.id, chainTransaction.chargeId))
        .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
        .where(inArray(chainTransaction.status, ['SUBMITTED', 'CONFIRMING', 'DELAYED']))
        .orderBy(desc(chainTransaction.submittedAt), desc(chainTransaction.id)).limit(10)
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

    // Both sources were fetched `limit` deep, so the newest `limit` of the
    // union is complete; the cursor then continues from the last row kept.
    const merged = [
      ...rows.map(({ r, sessionId }) => ({ id: r.id, createdAt: r.createdAt,
        item: { receiptId: r.id, sessionId: sessionId ?? undefined,
          role: r.role, snapshot: r.snapshotJson, createdAt: r.createdAt.toISOString() } })),
      ...cashRows,
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit)
    const last = merged[merged.length - 1]
    return {
      items: [...pendingItems, ...merged.map(m => m.item)],
      nextCursor: merged.length === limit ? `${last.createdAt.toISOString()}_${last.id}` : null,
    }
  })
}
