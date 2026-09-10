import type { DashboardView } from '@nimble/shared'
import { lunaToNim } from '@nimble/shared'
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { charge, paymentSession, refund, sale, saleItem, shift } from '../db/schema'
import type { Db } from '../db/client'
import { outstandingChargeRequests } from './chargeRequests'
import { saleState } from './sales'
import { openShiftFor } from './shifts'

type ChargeRow = typeof charge.$inferSelect

/** `?day` defaults to today, both read in UTC. The point's own timezone is a
 *  separate concern for later — this deliberately reads a UTC calendar day
 *  and says so, rather than silently pretending it's local time. */
function dayRangeUtc(day: string | undefined): { day: string; start: Date; end: Date } {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10)
  const start = new Date(`${d}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { day: d, start, end }
}

type OperatorAcc = { salesCount: number; grossFiatMinor: number; grossNimLuna: bigint }

export async function dashboardRoutes(app: FastifyInstance) {
  const { db } = app.deps

  app.get('/v1/dashboard', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.userId
    const { day, start, end } = dayRangeUtc((req.query as { day?: string }).day)

    const salesRows = await db.select().from(sale)
      .where(and(eq(sale.sellerUserId, userId), gte(sale.createdAt, start), lt(sale.createdAt, end)))

    // Batched, not per-row: saleState() below already loads charge+session
    // for its own purposes, but it doesn't hand back the charge's amounts —
    // this is a plain data lookup, not a second copy of the state logic.
    const chargeIds = salesRows.filter(s => s.chargeId !== null).map(s => s.chargeId!)
    const chargesById = new Map<string, ChargeRow>()
    if (chargeIds.length > 0) {
      const rows = await db.select().from(charge).where(inArray(charge.id, chargeIds))
      for (const c of rows) chargesById.set(c.id, c)
    }

    const states = await Promise.all(salesRows.map(row => saleState(db, row)))

    let grossFiatMinor = 0
    let grossNimLuna = 0n
    let salesCount = 0
    let cashCount = 0, cashFiatMinor = 0
    let nimCount = 0, nimFiatMinor = 0
    const paidSaleIds: string[] = []
    const awaiting: DashboardView['awaiting'] = []
    // Keyed by shift id (null = no shift) — resolved to operator labels once,
    // after every contributing sale/charge has been walked.
    const operatorAcc = new Map<string | null, OperatorAcc>()
    const bumpOperator = (shiftId: string | null, fiatMinor: number, luna: bigint) => {
      const cur = operatorAcc.get(shiftId) ?? { salesCount: 0, grossFiatMinor: 0, grossNimLuna: 0n }
      cur.salesCount++
      cur.grossFiatMinor += fiatMinor
      cur.grossNimLuna += luna
      operatorAcc.set(shiftId, cur)
    }

    salesRows.forEach((row, i) => {
      const { state } = states[i]
      if (row.paymentMethod === 'cash') {
        if (state !== 'paid') return
        cashCount++; cashFiatMinor += row.totalMinor
        grossFiatMinor += row.totalMinor
        salesCount++
        paidSaleIds.push(row.id)
        bumpOperator(row.shiftId, row.totalMinor, 0n)
        return
      }
      // nim
      if (state === 'paid') {
        const c = row.chargeId ? chargesById.get(row.chargeId) : undefined
        const fiat = c?.fiatAmountMinor ?? 0
        const luna = c?.amountAtomic ?? 0n
        nimCount++; nimFiatMinor += fiat
        grossFiatMinor += fiat
        grossNimLuna += luna
        salesCount++
        paidSaleIds.push(row.id)
        bumpOperator(row.shiftId, fiat, luna)
      } else if (state === 'awaiting') {
        const c = row.chargeId ? chargesById.get(row.chargeId) : undefined
        awaiting.push({
          saleId: row.id, totalMinor: row.totalMinor, createdAt: row.createdAt.toISOString(),
          sessionId: c?.sessionId ?? null,
        })
      }
    })

    // Old-path NIM: a charge that settled with this caller as receiver but
    // carries no `sale` — POS sales from before the catalog existed, and
    // accepted remote bills (see routes/chargeRequests.ts accept). Scoped by
    // the charge's own createdAt, not any sale's, since there isn't one.
    const oldPathRows = await db.select({ c: charge, s: paymentSession })
      .from(charge)
      .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
      .where(and(eq(paymentSession.receiverUserId, userId), isNull(charge.saleId),
        gte(charge.createdAt, start), lt(charge.createdAt, end)))
    for (const { c, s } of oldPathRows) {
      if (s.status !== 'CONFIRMED') continue
      const fiat = c.fiatAmountMinor ?? 0
      nimCount++; nimFiatMinor += fiat
      grossFiatMinor += fiat
      grossNimLuna += c.amountAtomic
      salesCount++
      bumpOperator(c.shiftId, fiat, c.amountAtomic)
    }

    // Refunds: the vendor is a refund's *payer*, never its receiver (see
    // routes/refunds.ts) — a different session/charge pair than the sale it
    // refunds, so this is its own query rather than a branch of the one
    // above. Same "a confirmed refund session is what counts" rule buildReport
    // uses, scoped to a day by the refund's own charge's createdAt.
    const refundRows = await db.select({ c: charge })
      .from(refund)
      .innerJoin(charge, eq(charge.sessionId, refund.sessionId))
      .innerJoin(paymentSession, eq(paymentSession.id, charge.sessionId))
      .where(and(eq(paymentSession.payerUserId, userId), eq(paymentSession.status, 'CONFIRMED'),
        gte(charge.createdAt, start), lt(charge.createdAt, end)))
    let refundedNimLuna = 0n
    for (const r of refundRows) refundedNimLuna += r.c.amountAtomic

    // Top products: item lines from every sale that ended up paid today,
    // cash and NIM alike — the same paidSaleIds idea buildReport uses to
    // join sale_item back to a gross total, just scoped to a day.
    const itemRows = paidSaleIds.length > 0
      ? await db.select().from(saleItem).where(inArray(saleItem.saleId, paidSaleIds))
      : []
    const productMap = new Map<string, { name: string; quantity: number; totalMinor: number }>()
    for (const it of itemRows) {
      const cur = productMap.get(it.nameSnapshot) ?? { name: it.nameSnapshot, quantity: 0, totalMinor: 0 }
      cur.quantity += it.quantity
      cur.totalMinor += it.lineTotalMinor
      productMap.set(it.nameSnapshot, cur)
    }
    const topProducts = [...productMap.values()]
      .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name))
      .slice(0, 10)

    // Resolve shift id -> operator label once, then merge accumulators that
    // land on the same label (two shifts under the same operator name are
    // one row, per spec — "wg operatora zmiany", not "wg zmiany").
    const shiftIds = [...operatorAcc.keys()].filter((id): id is string => id !== null)
    const labelByShiftId = new Map<string, string>()
    if (shiftIds.length > 0) {
      const rows = await db.select({ id: shift.id, operatorLabel: shift.operatorLabel })
        .from(shift).where(inArray(shift.id, shiftIds))
      for (const r of rows) labelByShiftId.set(r.id, r.operatorLabel)
    }
    const byOperatorMap = new Map<string | null, OperatorAcc>()
    for (const [shiftId, acc] of operatorAcc) {
      const label = shiftId ? (labelByShiftId.get(shiftId) ?? null) : null
      const cur = byOperatorMap.get(label) ?? { salesCount: 0, grossFiatMinor: 0, grossNimLuna: 0n }
      cur.salesCount += acc.salesCount
      cur.grossFiatMinor += acc.grossFiatMinor
      cur.grossNimLuna += acc.grossNimLuna
      byOperatorMap.set(label, cur)
    }
    const byOperator = [...byOperatorMap.entries()]
      .map(([operatorLabel, acc]) => ({
        operatorLabel, salesCount: acc.salesCount,
        grossFiatMinor: acc.grossFiatMinor, grossNim: lunaToNim(acc.grossNimLuna),
      }))
      .sort((a, b) => {
        if (b.grossFiatMinor !== a.grossFiatMinor) return b.grossFiatMinor - a.grossFiatMinor
        if (a.operatorLabel === null) return b.operatorLabel === null ? 0 : 1
        if (b.operatorLabel === null) return -1
        return a.operatorLabel.localeCompare(b.operatorLabel)
      })

    awaiting.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const openShift = await openShiftFor(db, userId)
    const outstandingBills = (await outstandingChargeRequests(db, userId)).length

    const view: DashboardView = {
      day,
      grossFiatMinor,
      grossNim: lunaToNim(grossNimLuna),
      salesCount,
      refundsCount: refundRows.length,
      refundedNim: lunaToNim(refundedNimLuna),
      byPaymentMethod: {
        nim: { count: nimCount, fiatMinor: nimFiatMinor },
        cash: { count: cashCount, fiatMinor: cashFiatMinor },
      },
      byOperator,
      topProducts,
      openShift: openShift
        ? { id: openShift.id, operatorLabel: openShift.operatorLabel, openedAt: openShift.openedAt.toISOString() }
        : null,
      awaiting,
      outstandingBills,
    }
    return reply.send(view)
  })
}
