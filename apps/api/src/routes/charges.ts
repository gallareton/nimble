import { CreateChargeRequest } from '@nimblink/shared'
import { parseLunaString } from '@nimblink/shared'
import { and, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { charge, paymentSession, userProfile } from '../db/schema'
import { withIdempotency } from '../plugins/idempotency'
import { requireIdemKey } from './sessions'

export async function chargeRoutes(app: FastifyInstance) {
  const { db, events } = app.deps

  app.post('/v1/sessions/:id/charges', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const sessionId = (req.params as { id: string }).id
    const body = CreateChargeRequest.parse(req.body)

    const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, sessionId))
    if (!s || (s.receiverUserId !== req.user.userId && s.payerUserId !== req.user.userId))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'session not found' } })
    if (s.receiverUserId !== req.user.userId)
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'only receiver creates charges' } })

    const { code, body: resBody } = await withIdempotency(db, `charge:${sessionId}`, key, body.amountLuna, async () => {
      // state transition + charge insert are atomic: a crash between them must
      // not leave the session in AWAITING_PAYER_APPROVAL without a charge
      const result = await db.transaction(async tx => {
        const [locked] = await tx.update(paymentSession).set({ status: 'AWAITING_PAYER_APPROVAL' })
          .where(and(eq(paymentSession.id, sessionId), eq(paymentSession.status, 'CLAIMED'),
            gt(paymentSession.chargeDeadlineAt, new Date()))).returning()
        if (!locked) return null
        const [receiver] = await tx.select().from(userProfile).where(eq(userProfile.id, req.user.userId))
        const [c] = await tx.insert(charge).values({
          sessionId, amountAtomic: parseLunaString(body.amountLuna),
          recipientAddress: receiver.walletAddress, reference: body.reference ?? null,
        }).returning()
        return c
      })
      if (!result) return { code: 409, body: { error: { code: 'CHARGE_EXISTS', message: 'charge window closed or already charged' } } }
      await events.publish(db, { sessionId, eventType: 'CHARGE_SUBMITTED', actorType: 'receiver',
        stateFrom: 'CLAIMED', stateTo: 'AWAITING_PAYER_APPROVAL' })
      return { code: 201, body: { chargeId: result.id, version: result.version } }
    })
    return reply.code(code).send(resBody)
  })
}
