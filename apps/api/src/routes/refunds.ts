import { CreateRefundRequest, parseLunaString } from '@nimble/shared'
import { and, eq, sql as dsql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { charge, chainTransaction, paymentSession, refund, userProfile } from '../db/schema'
import type { Db } from '../db/client'
import { withIdempotency } from '../plugins/idempotency'
import { insertCharge } from '../services/charges'
import { rejectIfCashierLocked } from '../services/cashierLock'
import { requireIdemKey } from './sessions'
import { openShiftFor } from './shifts'

export async function refundRoutes(app: FastifyInstance) {
  const { db, events } = app.deps

  // A refund is an ordinary payment session run in reverse — the vendor as
  // payer, the customer as receiver — not a reversal of the original
  // payment. See db/schema.ts on `refund` and the spec for why: the chain is
  // append-only, so this route materializes a second, independent charge and
  // records only the link back to what it refunds.
  app.post('/v1/charges/:id/refunds', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
    const key = requireIdemKey(req, reply); if (!key) return
    const chargeId = (req.params as { id: string }).id
    const body = CreateRefundRequest.parse(req.body)

    // Fingerprint what the client asked for, same discipline as every other
    // idempotency-guarded route here.
    const fingerprint = JSON.stringify({ amountLuna: body.amountLuna ?? null, reason: body.reason ?? null })

    type ResponseBody = { error?: { code: string; message: string }
      refundId?: string; sessionId?: string; chargeId?: string }
    const { code, body: resBody } = await withIdempotency<ResponseBody>(
      db, `refund:${chargeId}`, key, fingerprint, async () => {
        const FORBIDDEN = Symbol('forbidden')
        const NOT_FOUND = Symbol('not_found')
        type Outcome =
          | { kind: 'not_found' } | { kind: 'forbidden' } | { kind: 'conflict'; message: string }
          | { kind: 'ok'; refundId: string; sessionId: string; chargeId: string }
        let outcome: Outcome
        try {
          outcome = await db.transaction(async tx => {
            // Lock the original charge for the lifetime of this transaction:
            // without it, two concurrent partial refunds could each read the
            // same "amount refunded so far" and both pass the sum check,
            // together over-refunding the original charge. This is the only
            // place in this route where the missing lock would actually cost
            // money.
            const [origCharge] = await tx.select().from(charge)
              .where(eq(charge.id, chargeId)).for('update')
            if (!origCharge) throw NOT_FOUND

            const [origSession] = await tx.select().from(paymentSession)
              .where(eq(paymentSession.id, origCharge.sessionId))
            if (!origSession) throw NOT_FOUND

            // Only the receiver of the original payment may refund it —
            // never the payer, and never anyone else.
            if (origSession.receiverUserId !== req.user.userId) throw FORBIDDEN

            // Refunding from anything but a CONFIRMED payment would be
            // paying out money that may never actually arrive.
            if (origSession.status !== 'CONFIRMED')
              throw { conflict: 'original payment is not confirmed' }

            const [origTx] = await tx.select().from(chainTransaction)
              .where(eq(chainTransaction.chargeId, origCharge.id))
            if (!origTx) throw { conflict: 'original payment has no recorded transaction' }

            const [{ refunded }] = await tx.select({
              refunded: dsql<string>`coalesce(sum(${refund.amountAtomic}), 0)`,
            }).from(refund).where(eq(refund.originalChargeId, origCharge.id))
            const alreadyRefunded = BigInt(refunded)

            const amountAtomic = body.amountLuna !== undefined
              ? parseLunaString(body.amountLuna)
              : origCharge.amountAtomic - alreadyRefunded

            if (amountAtomic <= 0n) throw { conflict: 'refund amount must be positive' }
            if (alreadyRefunded + amountAtomic > origCharge.amountAtomic)
              throw { conflict: 'refund would exceed the original charge amount' }

            const expiresAt = new Date(Date.now() + 15 * 60_000) // matches sweeper's APPROVAL_TTL_MS

            const [session] = await tx.insert(paymentSession).values({
              payerUserId: req.user.userId, // the vendor is the payer of a refund
              receiverUserId: origSession.payerUserId, // the original payer is the refund's receiver
              status: 'AWAITING_PAYER_APPROVAL',
              expiresAt,
              // Deliberately unguessable and preimage-less, same pattern as
              // charge-request accept: no six-digit code's HMAC can ever
              // collide with a 32-byte random hex value, so code-claim can
              // never land a session onto this refund.
              codeHash: randomBytes(32).toString('hex'),
            }).returning()

            // Stamp the shift open on the vendor — the payer of this
            // session — not the customer, who is the receiver here. Copying
            // the sale pattern (openShiftFor on the receiver) would file
            // this refund into the customer's own shift report if the
            // customer happened to be a vendor with an open shift of their
            // own. This is the one place in the system where the shift
            // stamp comes from the payer, not the receiver.
            const vendorShift = await openShiftFor(tx as unknown as Db, req.user.userId)

            // The refund's receiver is the original payer (the customer) —
            // loaded here only for their (usually unset) business-profile
            // snapshot; see db/schema.ts on charge.receiverBusinessName.
            const [refundReceiver] = await tx.select().from(userProfile)
              .where(eq(userProfile.id, origSession.payerUserId))

            const c = await insertCharge(tx as unknown as Db, {
              sessionId: session.id,
              amountAtomic,
              shiftId: vendorShift?.id ?? null,
              // No fiat pricing: the customer gets back the NIM they paid,
              // not today's fiat-equivalent of it.
              recipientAddress: origTx.sender, // the only address we know the customer holds
              reference: body.reason ?? null,
              receiverBusinessName: refundReceiver?.businessName ?? null,
              receiverTaxId: refundReceiver?.taxId ?? null,
            })

            const [r] = await tx.insert(refund).values({
              originalChargeId: origCharge.id,
              sessionId: session.id,
              amountAtomic,
              reason: body.reason ?? null,
            }).returning()

            return { kind: 'ok', refundId: r.id, sessionId: session.id, chargeId: c.id }
          }) as Outcome
        } catch (e) {
          if (e === NOT_FOUND) outcome = { kind: 'not_found' }
          else if (e === FORBIDDEN) outcome = { kind: 'forbidden' }
          else if (e && typeof e === 'object' && 'conflict' in e) outcome = { kind: 'conflict', message: (e as any).conflict }
          else throw e
        }

        if (outcome.kind === 'not_found')
          return { code: 404, body: { error: { code: 'NOT_FOUND', message: 'charge not found' } } }
        if (outcome.kind === 'forbidden')
          return { code: 403, body: { error: { code: 'FORBIDDEN', message: 'only the receiver of the original payment can refund it' } } }
        if (outcome.kind === 'conflict')
          return { code: 409, body: { error: { code: 'INVALID_STATE', message: outcome.message } } }

        await events.publish(db, { sessionId: outcome.sessionId, eventType: 'REFUND_STARTED', actorType: 'receiver',
          stateTo: 'AWAITING_PAYER_APPROVAL' })
        return { code: 201, body: { refundId: outcome.refundId, sessionId: outcome.sessionId, chargeId: outcome.chargeId } }
      }
    )
    return reply.code(code).send(resBody)
  })
}
