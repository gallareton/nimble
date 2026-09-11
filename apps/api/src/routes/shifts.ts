import { OpenShiftRequest } from '@nimble/shared'
import type { ShiftCashEntry, ShiftEntry, ShiftListItem, ShiftProductTotal, ShiftReport, ShiftView } from '@nimble/shared'
import { lunaToNim } from '@nimble/shared'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { chainTransaction, charge, paymentSession, receipt, refund, sale, saleItem, shift } from '../db/schema'
import type { Db } from '../db/client'
import { rejectIfCashierLocked } from '../services/cashierLock'
import { composeSaleReference, saleAmountNim } from './sales'

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
  // Appended again for the POS sale/cash-method columns (task 2) — same
  // append-only discipline, one more time.
  'payment_method', 'sale_id',
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
      // Every entry here comes from a charge, and a charge only ever
      // represents a NIM transfer — cash never produces one.
      'nim',
      e.saleId ?? '',
    ].join(','))
  }
  // Cash rows never had a charge, so they carry no crypto/fx columns at all —
  // rather than pad ShiftEntry with nulls for a payment method that never
  // touches the chain, they're appended here from their own, smaller shape.
  report.cashEntries.forEach((ce, i) => {
    lines.push([
      report.entries.length + i + 1, ce.occurredAt, 'PAID_CASH', ce.amountFiatMinor, report.totals.fiatCurrency,
      '', '', '', '', '', '',
      '',
      csvFreeText(ce.reference),
      csvFreeText(report.shift.operatorLabel),
      report.shift.id,
      '',
      'cash',
      ce.saleId,
    ].join(','))
  })
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
  let nimSaleCount = 0
  let nimSaleFiatMinor = 0
  // Sale ids whose NIM charge is CONFIRMED — feeds byProduct below, joined
  // with the cash side further down. A sale that isn't itself refunded stays
  // 'paid' even though other charges in the same shift may be refunds.
  const paidSaleIds = new Set<string>()

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
        if (x.c.saleId) {
          paidSaleIds.add(x.c.saleId)
          nimSaleCount++
          nimSaleFiatMinor += x.c.fiatAmountMinor ?? 0
        }
      }
    } else if (status === 'FAILED' || status === 'REJECTED' || status === 'EXPIRED') {
      failed++
    }

    const originalId = isRefund ? x.rf!.originalChargeId : null
    const originalLocal = originalId ? localByChargeId.get(originalId) : undefined

    return {
      chargeId: x.c.id,
      saleId: x.c.saleId ?? null,
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

  // Cash sales never produce a `charge` row (no chain, no session — see
  // db/schema.ts on `sale`), so they can't be found by joining from `charge`
  // above. A separate, small query picks them up by shift_id directly.
  const cashSaleRows = await db.select().from(sale)
    .where(and(eq(sale.shiftId, row.id), eq(sale.paymentMethod, 'cash')))
    .orderBy(asc(sale.createdAt), asc(sale.id))
  const paidCashSales = cashSaleRows.filter(s => s.status === 'paid')
  for (const s of paidCashSales) paidSaleIds.add(s.id)

  const cashFiatMinor = paidCashSales.reduce((sum, s) => sum + s.totalMinor, 0)
  if (paidCashSales.length > 0) fiatCurrency ??= paidCashSales[0].fiatCurrency

  const saleItemRows = paidSaleIds.size > 0
    ? await db.select().from(saleItem).where(inArray(saleItem.saleId, [...paidSaleIds]))
    : []
  const itemsBySaleId = new Map<string, (typeof saleItemRows)>()
  for (const it of saleItemRows) {
    const list = itemsBySaleId.get(it.saleId) ?? []
    list.push(it)
    itemsBySaleId.set(it.saleId, list)
  }

  const byProductMap = new Map<string, ShiftProductTotal>()
  for (const it of saleItemRows) {
    const cur = byProductMap.get(it.nameSnapshot) ?? { name: it.nameSnapshot, quantity: 0, totalMinor: 0 }
    cur.quantity += it.quantity
    cur.totalMinor += it.lineTotalMinor
    byProductMap.set(it.nameSnapshot, cur)
  }
  const byProduct = [...byProductMap.values()]
    .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name))

  const cashEntries: ShiftCashEntry[] = paidCashSales.map(s => ({
    saleId: s.id,
    occurredAt: (s.paidAt ?? s.createdAt).toISOString(),
    amountFiatMinor: s.totalMinor,
    // From the rate frozen onto the sale, not today's (ruling P5).
    amountNim: saleAmountNim(s),
    reference: composeSaleReference((itemsBySaleId.get(s.id) ?? []).slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)),
  }))

  const anyFiat = confirmed > 0 || paidCashSales.length > 0

  return {
    shift: view(row),
    totals: {
      count: entries.length,
      confirmed,
      refunded,
      failed,
      cashSales: paidCashSales.length,
      byPaymentMethod: {
        nim: { count: nimSaleCount, fiatMinor: nimSaleFiatMinor },
        cash: { count: paidCashSales.length, fiatMinor: cashFiatMinor },
      },
      grossNim: signedLunaToNim(salesLuna - refundsLuna),
      // Cash sales join the NIM fiat total here; grossNim above stays NIM-only.
      grossFiatMinor: anyFiat ? grossFiatMinor + cashFiatMinor : null,
      fiatCurrency,
      // From sales only: a refund shouldn't skew the typical-transaction size.
      averageTicketNim: confirmed > 0 ? lunaToNim(salesLuna / BigInt(confirmed)) : null,
    },
    entries,
    cashEntries,
    byProduct,
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
      // The fiat side of the same confirmed, non-refund charges. buildReport
      // adds a charge's fiat only when it has one (and flags the report
      // incomplete otherwise); the sum here does the same by treating a
      // missing price as zero rather than as a null total.
      nimFiatMinor: sql<number>`coalesce(sum(case when ${paymentSession.status} = 'CONFIRMED'
        and ${refund.id} is null then ${charge.fiatAmountMinor} else 0 end), 0)::int`,
      nimCurrency: sql<string | null>`max(case when ${paymentSession.status} = 'CONFIRMED'
        and ${refund.id} is null then ${charge.fiatCurrency} end)`,
      // Cash sales never produce a charge row, so they cannot come out of the
      // join above — same reasoning (and same predicate: shift, cash, paid)
      // as buildReport's separate cash query, as a correlated subquery so the
      // list still costs one round trip however many shifts come back.
      cashSales: sql<number>`(select count(*) from ${sale}
        where ${sale.shiftId} = ${shift.id}
          and ${sale.paymentMethod} = 'cash' and ${sale.status} = 'paid')::int`,
      cashFiatMinor: sql<number>`coalesce((select sum(${sale.totalMinor}) from ${sale}
        where ${sale.shiftId} = ${shift.id}
          and ${sale.paymentMethod} = 'cash' and ${sale.status} = 'paid'), 0)::int`,
      cashCurrency: sql<string | null>`(select max(${sale.fiatCurrency}) from ${sale}
        where ${sale.shiftId} = ${shift.id}
          and ${sale.paymentMethod} = 'cash' and ${sale.status} = 'paid')`,
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
      // Null, not 0, for a shift that took nothing either way: "no money"
      // and "0.00 USD" read differently, and buildReport draws the same line.
      grossFiatMinor: Number(r.confirmed) > 0 || Number(r.cashSales) > 0
        ? Number(r.nimFiatMinor) + Number(r.cashFiatMinor)
        : null,
      fiatCurrency: r.nimCurrency ?? r.cashCurrency ?? null,
      cashSales: Number(r.cashSales),
    }))
    return reply.send(items)
  })

  app.get('/v1/shifts/current', { preHandler: app.authenticate }, async (req, reply) => {
    const row = await openShiftFor(db, req.user.userId)
    return row ? view(row) : reply.code(404).send({ error: { code: 'NO_SHIFT', message: 'no open shift' } })
  })

  app.post('/v1/shifts/:id/close', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
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
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
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
