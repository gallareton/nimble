import { OpenShiftRequest } from '@nimble/shared'
import type { ShiftEntry, ShiftReport, ShiftView } from '@nimble/shared'
import { lunaToNim } from '@nimble/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { chainTransaction, charge, paymentSession, receipt, shift } from '../db/schema'
import type { Db } from '../db/client'

const view = (row: typeof shift.$inferSelect): ShiftView => ({
  id: row.id,
  operatorLabel: row.operatorLabel,
  openedAt: row.openedAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
})

export async function openShiftFor(db: Db, userId: string) {
  const [open] = await db.select().from(shift)
    .where(and(eq(shift.userId, userId), isNull(shift.closedAt)))
  return open ?? null
}

/**
 * Rebuilds a shift from what is stored, never from what is cached: the rows are
 * the charges stamped with this shift and the amounts come from the columns
 * frozen when each sale was priced. A closed shift therefore reports the same
 * numbers however often it is asked, which is the whole point of a Z report.
 */
export async function buildReport(db: Db, row: typeof shift.$inferSelect): Promise<ShiftReport> {
  const rows = await db.select({ c: charge, s: paymentSession, tx: chainTransaction, r: receipt })
    .from(charge)
    .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
    .leftJoin(chainTransaction, eq(chainTransaction.chargeId, charge.id))
    .leftJoin(receipt, and(eq(receipt.transactionId, chainTransaction.id), eq(receipt.role, 'receiver')))
    .where(eq(charge.shiftId, row.id))
    .orderBy(asc(charge.createdAt))

  let confirmed = 0
  let failed = 0
  let grossLuna = 0n
  let grossFiatMinor = 0
  let fiatCurrency: string | null = null
  let fiatIncomplete = false

  const entries: ShiftEntry[] = rows.map((x, i) => {
    const snap = (x.r?.snapshotJson ?? {}) as Record<string, unknown>
    const status = x.s.status as ShiftEntry['status']
    if (status === 'CONFIRMED') {
      confirmed++
      grossLuna += x.c.amountAtomic
      if (x.c.fiatAmountMinor !== null) {
        grossFiatMinor += x.c.fiatAmountMinor
        fiatCurrency ??= x.c.fiatCurrency
      } else {
        fiatIncomplete = true
      }
    } else if (status === 'FAILED' || status === 'REJECTED' || status === 'EXPIRED') {
      failed++
    }
    return {
      localNumber: i + 1,
      occurredAt: typeof snap.confirmedAt === 'string' ? snap.confirmedAt : x.c.createdAt.toISOString(),
      status,
      amountNim: lunaToNim(x.c.amountAtomic),
      asset: x.c.selectedAsset,
      network: x.tx?.network ?? 'nimiq',
      hash: x.tx?.hash ?? null,
      reference: x.c.reference,
      amountFiatMinor: x.c.fiatAmountMinor,
      fiatCurrency: x.c.fiatCurrency,
      fxRate: x.c.fxRate,
      fxRateAt: x.c.fxRateAt?.toISOString() ?? null,
      fxSource: x.c.fxSource,
    }
  })

  return {
    shift: view(row),
    totals: {
      count: entries.length,
      confirmed,
      failed,
      grossNim: lunaToNim(grossLuna),
      grossFiatMinor: confirmed > 0 ? grossFiatMinor : null,
      fiatCurrency,
      averageTicketNim: confirmed > 0 ? lunaToNim(grossLuna / BigInt(confirmed)) : null,
    },
    entries,
    fiatIncomplete,
  }
}

export async function shiftRoutes(app: FastifyInstance) {
  const { db } = app.deps

  app.post('/v1/shifts', { preHandler: app.authenticate }, async (req, reply) => {
    const body = OpenShiftRequest.parse(req.body)
    if (await openShiftFor(db, req.user.userId))
      return reply.code(409).send({ error: { code: 'SHIFT_OPEN', message: 'a shift is already open' } })
    const [row] = await db.insert(shift)
      .values({ userId: req.user.userId, operatorLabel: body.operatorLabel }).returning()
    return reply.code(201).send(view(row))
  })

  app.get('/v1/shifts/current', { preHandler: app.authenticate }, async (req, reply) => {
    const row = await openShiftFor(db, req.user.userId)
    return row ? view(row) : reply.code(404).send({ error: { code: 'NO_SHIFT', message: 'no open shift' } })
  })

  app.post('/v1/shifts/:id/close', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [row] = await db.update(shift).set({ closedAt: new Date() })
      .where(and(eq(shift.id, id), eq(shift.userId, req.user.userId), isNull(shift.closedAt)))
      .returning()
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no open shift with that id' } })
    return buildReport(db, row)
  })

  app.get('/v1/shifts/:id/report', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [row] = await db.select().from(shift)
      .where(and(eq(shift.id, id), eq(shift.userId, req.user.userId)))
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'shift not found' } })
    return buildReport(db, row)
  })
}
