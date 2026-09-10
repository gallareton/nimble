import { MerchantCreateChargeRequestRequest } from '@nimble/shared'
import type { MerchantChargeRequestView } from '@nimble/shared'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { chainTransaction, charge, chargeRequest, paymentSession } from '../db/schema'
import type { Db } from '../db/client'
import { env } from '../env'
import { withIdempotency } from '../plugins/idempotency'
import { requireIdemKey } from './sessions'
import { createChargeRequestRow } from './chargeRequests'

/**
 * Merchant API (Task 3): API-key-authenticated charge-request creation and
 * lookup for integrators outside the till UI. Reuses `charge_request` end to
 * end — see routes/chargeRequests.ts for the shared row-creation logic this
 * calls, and POST /v1/charge-requests/:id/accept for how a bill turns into a
 * real payment session (unauthenticated, since the payer may hold no
 * account — unchanged by this file).
 *
 * Deliberately polling, not webhooks: outbound delivery, retries, signing
 * and replay protection for webhooks are a separate subsystem and are out of
 * scope for this slice. An integrator watches a bill by polling
 * GET /v1/merchant/charge-requests/:id.
 */
export async function merchantRoutes(app: FastifyInstance) {
  const { db } = app.deps

  function billUrl(id: string): string {
    // Same TestAlbatross/MainAlbatross naming as env.nimiqNetwork elsewhere;
    // the recipient side of this URL has no wallet to ask, so the network
    // travels in the query string (mirrors apps/web/src/lib/host.ts).
    const net = env.nimiqNetwork === 'MainAlbatross' ? 'main' : 'test'
    return `https://${env.appOrigin}/r/${id}?n=${net}`
  }

  app.post('/v1/merchant/charge-requests', { preHandler: app.authenticateApiKey }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const body = MerchantCreateChargeRequestRequest.parse(req.body)
    const externalRef = body.externalRef ?? null

    // Same fingerprint discipline as POST /v1/charge-requests: hash what the
    // client asked for, including externalRef since it changes the response.
    const fingerprint = body.fiatAmountMinor !== undefined
      ? JSON.stringify({ fiatAmountMinor: body.fiatAmountMinor, fiatCurrency: body.fiatCurrency,
        reference: body.reference ?? null, externalRef })
      : JSON.stringify({ amountLuna: body.amountLuna, reference: body.reference ?? null, externalRef })

    type ResponseBody = { error?: { code: string; message: string } }
      & Partial<{ id: string; url: string; expiresAt: string; state: 'open'; externalRef: string | null }>
    const { code, body: resBody } = await withIdempotency<ResponseBody>(
      // Own scope, distinct from `charge-request:${userId}`: same underlying
      // row creation, but a different response shape (url, externalRef), so
      // a key holder and a JWT session for the same user must never share an
      // idempotency record.
      db, `merchant-charge-request:${req.user.userId}`, key, fingerprint, async () => {
        const outcome = await createChargeRequestRow(db, app.deps.rates, req.user.userId, body, externalRef)
        if (outcome.code !== 201) return outcome
        return { code: 201, body: {
          id: outcome.row.id,
          url: billUrl(outcome.row.id),
          expiresAt: outcome.body.expiresAt,
          state: 'open' as const,
          externalRef: outcome.row.externalRef,
        } }
      },
    )
    return reply.code(code).send(resBody)
  })

  app.get('/v1/merchant/charge-requests/:id', { preHandler: app.authenticateApiKey }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [r] = await db.select().from(chargeRequest)
      .where(and(eq(chargeRequest.id, id), eq(chargeRequest.receiverUserId, req.user.userId)))
    if (!r) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'charge request not found' } })
    return merchantView(db, r)
  })

  app.get('/v1/merchant/charge-requests', { preHandler: app.authenticateApiKey }, async (req, reply) => {
    const externalRef = (req.query as { externalRef?: unknown }).externalRef
    if (typeof externalRef !== 'string' || !externalRef)
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'externalRef is required' } })
    const rows = await db.select().from(chargeRequest)
      .where(and(eq(chargeRequest.receiverUserId, req.user.userId), eq(chargeRequest.externalRef, externalRef)))
      .orderBy(desc(chargeRequest.createdAt), desc(chargeRequest.id))
      .limit(50)
    return Promise.all(rows.map(r => merchantView(db, r)))
  })
}

/** `state` is the bill's own lifecycle (open/expired/paid). `payment`, once
 *  present, carries the actual payment lifecycle — see MerchantChargeRequestView's
 *  doc comment in @nimble/shared: `paid` above means "accepted", not "money
 *  arrived"; only `payment.sessionStatus === 'CONFIRMED'` means that. */
async function merchantView(db: Db, r: typeof chargeRequest.$inferSelect): Promise<MerchantChargeRequestView> {
  const state: 'open' | 'expired' | 'paid' = r.sessionId
    ? 'paid'
    : r.expiresAt.getTime() <= Date.now() ? 'expired' : 'open'

  const view: MerchantChargeRequestView = {
    id: r.id,
    state,
    externalRef: r.externalRef,
    amountLuna: r.amountAtomic.toString(),
    fiatAmountMinor: r.fiatAmountMinor,
    fiatCurrency: r.fiatCurrency,
    reference: r.reference,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }
  if (!r.sessionId) return view

  const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, r.sessionId))
  if (!s) return view

  let txHash: string | null = null
  let confirmedAt: Date | null = null
  const [c] = await db.select().from(charge).where(eq(charge.sessionId, r.sessionId))
  if (c) {
    const [tx] = await db.select().from(chainTransaction).where(eq(chainTransaction.chargeId, c.id))
    if (tx) { txHash = tx.hash; confirmedAt = tx.confirmedAt }
  }
  view.payment = { sessionStatus: s.status, txHash, confirmedAt: confirmedAt ? confirmedAt.toISOString() : null }
  return view
}
