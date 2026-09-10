import { CreateSaleRequest } from '@nimble/shared'
import type { SaleView } from '@nimble/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { chainTransaction, charge, paymentSession, product, sale, saleItem } from '../db/schema'
import type { Db } from '../db/client'
import { withIdempotency } from '../plugins/idempotency'
import { requireIdemKey } from './sessions'
import { openShiftFor } from './shifts'

type SaleRow = typeof sale.$inferSelect
type SaleItemRow = typeof saleItem.$inferSelect

/** "Coffee" for one line, "Coffee +2" for three — used as the charge's
 *  default reference when a POS sale is claimed and the caller didn't send
 *  one, so a receipt built from a cart never shows up blank. */
export function composeSaleReference(items: { nameSnapshot: string }[]): string {
  if (items.length === 0) return ''
  const extra = items.length - 1
  return extra > 0 ? `${items[0].nameSnapshot} +${extra}` : items[0].nameSnapshot
}

/**
 * Pure state computation from already-loaded rows — no I/O. Kept separate
 * from `saleState` (which does the loading) so `buildReport` in shifts.ts
 * can reuse this exact logic against rows it has already joined, instead of
 * running a second, possibly-diverging copy of the same rules.
 */
export function resolveSaleState(
  row: Pick<SaleRow, 'status' | 'paymentMethod' | 'paidAt'>,
  session: { status: string } | null,
  confirmedAt: Date | null,
): { state: 'awaiting' | 'paid' | 'cancelled' | 'failed'; paidAt: Date | null } {
  if (row.paymentMethod === 'cash') {
    if (row.status === 'cancelled') return { state: 'cancelled', paidAt: null }
    if (row.status === 'paid') return { state: 'paid', paidAt: row.paidAt }
    return { state: 'awaiting', paidAt: null }
  }
  // nim: the `status` column stays 'awaiting' forever except 'cancelled' —
  // the real state is derived from the linked charge's session below.
  if (row.status === 'cancelled') return { state: 'cancelled', paidAt: null }
  if (!session) return { state: 'awaiting', paidAt: null }
  if (session.status === 'CONFIRMED') return { state: 'paid', paidAt: confirmedAt }
  if (session.status === 'FAILED' || session.status === 'REJECTED'
    || session.status === 'CANCELLED' || session.status === 'EXPIRED')
    return { state: 'failed', paidAt: null }
  return { state: 'awaiting', paidAt: null }
}

/** Loads whatever `resolveSaleState` needs for one sale and applies it. The
 *  single function used by both GET /v1/sales/:id and the shift report. */
export async function saleState(db: Db, row: SaleRow) {
  if (row.paymentMethod === 'cash' || !row.chargeId) return resolveSaleState(row, null, null)
  const [c] = await db.select().from(charge).where(eq(charge.id, row.chargeId))
  if (!c) return resolveSaleState(row, null, null)
  const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, c.sessionId))
  if (!s) return resolveSaleState(row, null, null)
  let confirmedAt: Date | null = null
  if (s.status === 'CONFIRMED') {
    const [tx] = await db.select().from(chainTransaction).where(eq(chainTransaction.chargeId, c.id))
    confirmedAt = tx?.confirmedAt ?? null
  }
  return resolveSaleState(row, s, confirmedAt)
}

export async function saleItemsFor(db: Db, saleId: string): Promise<SaleItemRow[]> {
  return db.select().from(saleItem).where(eq(saleItem.saleId, saleId)).orderBy(asc(saleItem.sortOrder))
}

export async function saleView(db: Db, row: SaleRow): Promise<SaleView> {
  const [items, { state, paidAt }] = await Promise.all([saleItemsFor(db, row.id), saleState(db, row)])
  return {
    id: row.id,
    status: row.status as SaleView['status'],
    state,
    paymentMethod: row.paymentMethod as SaleView['paymentMethod'],
    totalMinor: row.totalMinor,
    fiatCurrency: row.fiatCurrency,
    shiftId: row.shiftId,
    chargeId: row.chargeId,
    items: items.map(it => ({
      productId: it.productId, name: it.nameSnapshot, unitPriceMinor: it.unitPriceMinor,
      quantity: it.quantity, lineTotalMinor: it.lineTotalMinor,
    })),
    createdAt: row.createdAt.toISOString(),
    paidAt: paidAt ? paidAt.toISOString() : null,
  }
}

export async function saleRoutes(app: FastifyInstance) {
  const { db } = app.deps

  app.post('/v1/sales', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const body = CreateSaleRequest.parse(req.body)

    for (const it of body.items) {
      if (!it.productId && (it.name === undefined || it.unitPriceMinor === undefined))
        return reply.code(400).send({ error: { code: 'VALIDATION', message: 'a non-catalog item needs name and unitPriceMinor' } })
    }

    type ResponseBody = SaleView | { error: { code: string; message: string } }
    const { code, body: resBody } = await withIdempotency<ResponseBody>(
      db, `sales:${req.user.userId}`, key, JSON.stringify(body), async () => {
        let outcome: { code: number; body: ResponseBody } | null = null

        const created = await db.transaction(async tx => {
          const resolved: { productId: string | null; nameSnapshot: string
            unitPriceMinor: number; quantity: number; lineTotalMinor: number }[] = []
          for (const it of body.items) {
            if (it.productId) {
              // Price and name come from the catalog, never from the body —
              // a client cannot undercut what it billed by sending a lower
              // unitPriceMinor for a catalog item.
              const [p] = await tx.select().from(product).where(and(
                eq(product.id, it.productId), eq(product.ownerUserId, req.user.userId), eq(product.active, true),
              ))
              if (!p) {
                outcome = { code: 400, body: { error: { code: 'INVALID_PRODUCT', message: 'product not found or inactive' } } }
                return null
              }
              resolved.push({ productId: p.id, nameSnapshot: p.name, unitPriceMinor: p.priceMinor,
                quantity: it.quantity, lineTotalMinor: p.priceMinor * it.quantity })
            } else {
              resolved.push({ productId: null, nameSnapshot: it.name!, unitPriceMinor: it.unitPriceMinor!,
                quantity: it.quantity, lineTotalMinor: it.unitPriceMinor! * it.quantity })
            }
          }
          const totalMinor = resolved.reduce((sum, x) => sum + x.lineTotalMinor, 0)
          if (totalMinor <= 0) {
            outcome = { code: 400, body: { error: { code: 'VALIDATION', message: 'sale total must be positive' } } }
            return null
          }

          const openShift = await openShiftFor(tx as unknown as Db, req.user.userId)
          const now = new Date()
          const [row] = await tx.insert(sale).values({
            sellerUserId: req.user.userId,
            shiftId: openShift?.id ?? null,
            status: body.paymentMethod === 'cash' ? 'paid' : 'awaiting',
            paymentMethod: body.paymentMethod,
            totalMinor,
            paidAt: body.paymentMethod === 'cash' ? now : null,
          }).returning()
          await tx.insert(saleItem).values(resolved.map((it, i) => ({
            saleId: row.id, productId: it.productId, nameSnapshot: it.nameSnapshot,
            unitPriceMinor: it.unitPriceMinor, quantity: it.quantity, lineTotalMinor: it.lineTotalMinor,
            sortOrder: i,
          })))
          return row
        })

        if (outcome) return outcome
        if (!created) return { code: 500, body: { error: { code: 'INTERNAL', message: 'sale not created' } } }
        return { code: 201, body: await saleView(db, created) }
      },
    )
    return reply.code(code).send(resBody)
  })

  app.get('/v1/sales/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [row] = await db.select().from(sale).where(eq(sale.id, id))
    if (!row || row.sellerUserId !== req.user.userId)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'sale not found' } })
    return saleView(db, row)
  })

  // Idempotent: cancelling an already-cancelled sale replays the same view
  // rather than erroring. Once a charge is attached, the payment session
  // owns the outcome — cancel refuses instead of racing it (409).
  app.post('/v1/sales/:id/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [row] = await db.select().from(sale).where(eq(sale.id, id))
    if (!row || row.sellerUserId !== req.user.userId)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'sale not found' } })
    if (row.status === 'cancelled') return saleView(db, row)
    if (row.status !== 'awaiting' || row.chargeId !== null)
      return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'cannot cancel now' } })

    const [updated] = await db.update(sale).set({ status: 'cancelled' })
      .where(and(eq(sale.id, id), eq(sale.status, 'awaiting'), isNull(sale.chargeId)))
      .returning()
    if (!updated) return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'cannot cancel now' } })
    return saleView(db, updated)
  })
}
