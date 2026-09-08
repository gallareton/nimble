import { OpenShiftRequest } from '@nimble/shared'
import type { ShiftEntry, ShiftListItem, ShiftReport, ShiftView } from '@nimble/shared'
import { lunaToNim } from '@nimble/shared'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { chainTransaction, charge, paymentSession, receipt, refund, shift } from '../db/schema'
import type { Db } from '../db/client'

/** lunaToNim() rejects negatives (it never has to format one on the sale path); refunds and a shift that refunds more than it sold both need a signed rendering. */
function signedLunaToNim(v: bigint): string {
  return v < 0n ? `-${lunaToNim(-v)}` : lunaToNim(v)
}

/** RFC 4180: quotes doubled, field wrapped whenever it could confuse a parser. */
function csvField(value: string | number | null): string {
  if (value === null) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Prefix free-text fields with apostrophe if they begin with formula injection characters. */
function csvFreeText(value: string | null): string {
  if (value === null) return ''
  const s = String(value)
  // Prefix with ' if the value begins with =, +, -, or @ to neutralize spreadsheet formula injection.
  // The apostrophe is preserved in quoted fields per RFC 4180 and removed when unquoted.
  const prefixed = /^[=+\-@]/.test(s) ? `'${s}` : s
  return csvField(prefixed)
}

const CSV_COLUMNS = [
  'local_number', 'occurred_at_utc', 'status', 'amount_fiat_minor', 'fiat_currency',
  'amount_crypto', 'asset', 'network', 'tx_hash', 'fx_rate', 'fx_rate_at',
  'fx_source', 'reference', 'operator', 'shift_id',
  // Appended, not inserted: column order here is asserted by a test, and
  // someone may have a spreadsheet built on today's layout.
  'refund_of',
] as const

function toCsv(report: ShiftReport): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const e of report.entries) {
    lines.push([
      e.localNumber, e.occurredAt, e.status, e.amountFiatMinor, e.fiatCurrency,
      e.amountNim, e.asset, e.network, e.hash, e.fxRate, e.fxRateAt,
      e.fxSource,
      csvFreeText(e.reference), // Protect against formula injection
      csvFreeText(report.shift.operatorLabel), // Protect against formula injection
      report.shift.id,
      // Never wrapped with csvFreeText: when this is the original sale's
      // local_number it must stay numeric so a spreadsheet can still sum it.
      e.refundOfLocalNumber ?? e.refundOfOccurredAt,
    ].join(','))
  }
  // Excel reads UTF-8 as the local codepage without this, mangling every accent.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

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
  const rows = await db.select({ c: charge, s: paymentSession, tx: chainTransaction, r: receipt, rf: refund })
    .from(charge)
    .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
    .leftJoin(chainTransaction, eq(chainTransaction.chargeId, charge.id))
    .leftJoin(receipt, and(eq(receipt.transactionId, chainTransaction.id), eq(receipt.role, 'receiver')))
    // A refund's charge already carries this shift's shift_id (see
    // routes/refunds.ts), so it's already in `rows` above — this join only
    // tells a refund row apart from a sale row: a refund's session has a
    // matching refund row, a sale's doesn't.
    .leftJoin(refund, eq(refund.sessionId, charge.sessionId))
    .where(eq(charge.shiftId, row.id))
    // Tiebreaker is load-bearing, not cosmetic: this order assigns
    // localNumber and drives the CSV export, and a closed shift has to
    // report the same rows in the same order forever. Two charges sharing
    // a created_at would otherwise renumber between two exports.
    .orderBy(asc(charge.createdAt), asc(charge.id))

  // localNumber and occurredAt for every charge in *this* report, keyed by
  // charge id — lets a refund whose sale is in this same report point back
  // at it without a second pass over the database.
  const localByChargeId = new Map<string, { localNumber: number; occurredAt: string }>()
  rows.forEach((x, i) => {
    const snap = (x.r?.snapshotJson ?? {}) as Record<string, unknown>
    localByChargeId.set(x.c.id, {
      localNumber: i + 1,
      occurredAt: typeof snap.confirmedAt === 'string' ? snap.confirmedAt : x.c.createdAt.toISOString(),
    })
  })

  // A refund's original sale can be in a different, long-closed shift (see
  // spec §5 — refunds are never attributed back to the sale's own shift).
  // For those, fetch just enough to know when the sale happened.
  const foreignOriginalIds = [...new Set(
    rows.filter(x => x.rf !== null && !localByChargeId.has(x.rf!.originalChargeId))
      .map(x => x.rf!.originalChargeId),
  )]
  const foreignOccurredById = new Map<string, string>()
  if (foreignOriginalIds.length > 0) {
    const foreign = await db.select({ c: charge, r: receipt })
      .from(charge)
      .leftJoin(chainTransaction, eq(chainTransaction.chargeId, charge.id))
      .leftJoin(receipt, and(eq(receipt.transactionId, chainTransaction.id), eq(receipt.role, 'receiver')))
      .where(inArray(charge.id, foreignOriginalIds))
    for (const f of foreign) {
      const snap = (f.r?.snapshotJson ?? {}) as Record<string, unknown>
      foreignOccurredById.set(f.c.id, typeof snap.confirmedAt === 'string' ? snap.confirmedAt : f.c.createdAt.toISOString())
    }
  }

  let confirmed = 0
  let refunded = 0
  let failed = 0
  let salesLuna = 0n
  let refundsLuna = 0n
  let grossFiatMinor = 0
  let fiatCurrency: string | null = null
  let fiatIncomplete = false

  const entries: ShiftEntry[] = rows.map((x, i) => {
    const local = localByChargeId.get(x.c.id)!
    const status = x.s.status as ShiftEntry['status']
    const isRefund = x.rf !== null

    if (status === 'CONFIRMED') {
      if (isRefund) {
        refunded++
        refundsLuna += x.c.amountAtomic
      } else {
        confirmed++
        salesLuna += x.c.amountAtomic
        if (x.c.fiatAmountMinor !== null) {
          grossFiatMinor += x.c.fiatAmountMinor
          fiatCurrency ??= x.c.fiatCurrency
        } else {
          fiatIncomplete = true
        }
      }
    } else if (status === 'FAILED' || status === 'REJECTED' || status === 'EXPIRED') {
      failed++
    }

    const originalId = isRefund ? x.rf!.originalChargeId : null
    const originalLocal = originalId ? localByChargeId.get(originalId) : undefined

    return {
      localNumber: i + 1,
      occurredAt: local.occurredAt,
      status,
      amountNim: isRefund ? `-${lunaToNim(x.c.amountAtomic)}` : lunaToNim(x.c.amountAtomic),
      asset: x.c.selectedAsset,
      network: x.tx?.network ?? 'nimiq',
      hash: x.tx?.hash ?? null,
      reference: x.c.reference,
      amountFiatMinor: x.c.fiatAmountMinor,
      fiatCurrency: x.c.fiatCurrency,
      fxRate: x.c.fxRate,
      fxRateAt: x.c.fxRateAt?.toISOString() ?? null,
      fxSource: x.c.fxSource,
      refundOfLocalNumber: isRefund ? (originalLocal?.localNumber ?? null) : null,
      refundOfOccurredAt: isRefund
        ? (originalLocal?.occurredAt ?? foreignOccurredById.get(originalId!) ?? null)
        : null,
    }
  })

  return {
    shift: view(row),
    totals: {
      count: entries.length,
      confirmed,
      refunded,
      failed,
      grossNim: signedLunaToNim(salesLuna - refundsLuna),
      grossFiatMinor: confirmed > 0 ? grossFiatMinor : null,
      fiatCurrency,
      // From sales only: a refund shouldn't skew the typical-transaction size.
      averageTicketNim: confirmed > 0 ? lunaToNim(salesLuna / BigInt(confirmed)) : null,
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

  // One aggregate query rather than a buildReport() per row: a full report
  // joins receipts too and is a heavy query per shift, but the list only
  // needs a gross total and a confirmed count, both computable with a single
  // GROUP BY over charge/payment_session regardless of how many shifts (up
  // to the 100 cap) are returned.
  //
  // Closed shifts only: the open shift is already served by /v1/shifts/current,
  // and this endpoint's only consumer is a "past shifts" list — filtering
  // server-side means a client refactor can't accidentally surface the live
  // shift here twice.
  app.get('/v1/shifts', { preHandler: app.authenticate }, async (req, reply) => {
    const raw = (req.query as { limit?: string }).limit
    let limit = raw !== undefined ? Number(raw) : 30
    if (!Number.isFinite(limit) || limit < 1) limit = 30
    limit = Math.min(Math.trunc(limit), 100)

    const rows = await db.select({
      id: shift.id,
      operatorLabel: shift.operatorLabel,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      // Refunds are charges too, stamped with the vendor's shift, so they
      // land in this aggregate as well — and would count as income and as a
      // sale unless subtracted here. buildReport already does that; a list
      // disagreeing with the report it summarises is the same bug as the
      // 2.50-shown-as-2.51 one, only in a place nobody reads twice.
      grossLuna: sql<string>`coalesce(sum(case when ${paymentSession.status} = 'CONFIRMED'
        then (case when ${refund.id} is null then ${charge.amountAtomic}
                   else -${charge.amountAtomic} end)
        else 0 end), 0)`,
      confirmed: sql<number>`count(case when ${paymentSession.status} = 'CONFIRMED'
        and ${refund.id} is null then 1 end)::int`,
    })
      .from(shift)
      .leftJoin(charge, eq(charge.shiftId, shift.id))
      .leftJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
      .leftJoin(refund, eq(refund.sessionId, charge.sessionId))
      .where(and(eq(shift.userId, req.user.userId), isNotNull(shift.closedAt)))
      .groupBy(shift.id)
      .orderBy(desc(shift.openedAt), desc(shift.id))
      .limit(limit)

    const items: ShiftListItem[] = rows.map(r => ({
      id: r.id,
      operatorLabel: r.operatorLabel,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      grossNim: lunaToNim(BigInt(r.grossLuna)),
      confirmed: Number(r.confirmed),
    }))
    return reply.send(items)
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

  app.get('/v1/shifts/:id/export', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const format = (req.query as { format?: string }).format ?? 'csv'
    const [row] = await db.select().from(shift)
      .where(and(eq(shift.id, id), eq(shift.userId, req.user.userId)))
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'shift not found' } })
    const report = await buildReport(db, row)
    const stamp = row.openedAt.toISOString().slice(0, 10)
    const openSuffix = row.closedAt === null ? '-open' : ''
    if (format === 'json') {
      return reply
        .header('content-disposition', `attachment; filename="nimble-shift-${stamp}${openSuffix}.json"`)
        .send(report)
    }
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="nimble-shift-${stamp}${openSuffix}.csv"`)
      .send(toCsv(report))
  })
}
