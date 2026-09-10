import { CreateProductRequest, UpdateProductRequest } from '@nimble/shared'
import type { ProductView } from '@nimble/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { product } from '../db/schema'
import { withIdempotency } from '../plugins/idempotency'
import { requireIdemKey } from './sessions'

const view = (row: typeof product.$inferSelect): ProductView => ({
  id: row.id,
  name: row.name,
  priceMinor: row.priceMinor,
  category: row.category,
  pinned: row.pinned,
  active: row.active,
  sortOrder: row.sortOrder,
})

export async function productRoutes(app: FastifyInstance) {
  const { db } = app.deps

  // Own catalog, active and withdrawn alike (the client tells them apart via
  // `active`) — a vendor still needs to see a withdrawn item to reinstate it.
  // Tiebreakers are load-bearing, not cosmetic: pinned items lead, then the
  // manual sortOrder, then name, then id — so two items sharing every other
  // field don't reorder themselves between requests.
  app.get('/v1/products', { preHandler: app.authenticate }, async (req) => {
    const rows = await db.select().from(product)
      .where(eq(product.ownerUserId, req.user.userId))
      .orderBy(desc(product.pinned), asc(product.sortOrder), asc(product.name), asc(product.id))
    return rows.map(view)
  })

  app.post('/v1/products', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const body = CreateProductRequest.parse(req.body)

    type ResponseBody = ProductView
    const { code, body: resBody } = await withIdempotency<ResponseBody>(
      db, `product-create:${req.user.userId}`, key, JSON.stringify(body), async () => {
        const [row] = await db.insert(product).values({
          ownerUserId: req.user.userId,
          name: body.name,
          priceMinor: body.priceMinor,
          category: body.category ?? null,
          pinned: body.pinned ?? false,
          sortOrder: body.sortOrder ?? 0,
        }).returning()
        return { code: 201, body: view(row) }
      },
    )
    return reply.code(code).send(resBody)
  })

  // No DELETE: sale_item.product_id points at this row, so a historical sale
  // must still be able to name what it sold. Withdrawal is active=false.
  app.patch('/v1/products/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const body = UpdateProductRequest.parse(req.body)

    const patch: Partial<typeof product.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.priceMinor !== undefined) patch.priceMinor = body.priceMinor
    if (body.category !== undefined) patch.category = body.category
    if (body.pinned !== undefined) patch.pinned = body.pinned
    if (body.active !== undefined) patch.active = body.active
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder

    const [row] = await db.update(product).set(patch)
      .where(and(eq(product.id, id), eq(product.ownerUserId, req.user.userId)))
      .returning()
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } })
    return view(row)
  })
}
