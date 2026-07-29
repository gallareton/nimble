import { CreateChargeRequest, RegisterTxRequest } from '@nimble/shared'
import { parseLunaString } from '@nimble/shared'
import { and, eq, gt, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { charge, paymentSession, userProfile, chainTransaction } from '../db/schema'
import type { Db } from '../db/client'
import { withIdempotency } from '../plugins/idempotency'
import { requireIdemKey } from './sessions'

async function loadChargeWithSession(db: Db, chargeId: string) {
  const [c] = await db.select().from(charge).where(eq(charge.id, chargeId))
  if (!c) return null
  const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, c.sessionId))
  return { c, s }
}

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

    type ChargeResponseBody = { error?: { code: string; message: string }; chargeId?: string; version?: number }
    const { code, body: resBody } = await withIdempotency<ChargeResponseBody>(
      db, `charge:${sessionId}`, key, body.amountLuna, async () => {
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
      }
    )
    return reply.code(code).send(resBody)
  })

  app.post('/v1/charges/:id/reject', { preHandler: app.authenticate }, async (req, reply) => {
    const found = await loadChargeWithSession(db, (req.params as any).id)
    if (!found || (found.s.payerUserId !== req.user.userId && found.s.receiverUserId !== req.user.userId))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
    if (found.s.payerUserId !== req.user.userId)
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'only payer rejects' } })
    const [updated] = await db.update(paymentSession).set({ status: 'REJECTED' })
      .where(and(eq(paymentSession.id, found.s.id),
        inArray(paymentSession.status, ['AWAITING_PAYER_APPROVAL', 'AWAITING_WALLET_AUTH']))).returning()
    if (!updated) return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'cannot reject now' } })
    await events.publish(db, { sessionId: found.s.id, eventType: 'REJECTED', actorType: 'payer',
      stateFrom: found.s.status, stateTo: 'REJECTED' })
    return { status: 'REJECTED' }
  })

  app.post('/v1/charges/:id/intent', { preHandler: app.authenticate }, async (req, reply) => {
    const found = await loadChargeWithSession(db, (req.params as any).id)
    if (!found || found.s.payerUserId !== req.user.userId)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
    const token = randomBytes(16).toString('hex')
    const result = await db.transaction(async tx => {
      const [locked] = await tx.update(paymentSession).set({ status: 'AWAITING_WALLET_AUTH' })
        .where(and(eq(paymentSession.id, found.s.id), eq(paymentSession.status, 'AWAITING_PAYER_APPROVAL'))).returning()
      if (!locked) return null
      await tx.update(charge).set({ reconciliationToken: token }).where(eq(charge.id, found.c.id))
      return token
    })
    if (!result) return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'cannot approve now' } })
    await events.publish(db, { sessionId: found.s.id, eventType: 'INTENT', actorType: 'payer',
      stateFrom: 'AWAITING_PAYER_APPROVAL', stateTo: 'AWAITING_WALLET_AUTH' })
    return { reconciliationToken: result, recipientAddress: found.c.recipientAddress,
      amountLuna: found.c.amountAtomic.toString(), validUntil: new Date(Date.now() + 600_000).toISOString() }
  })

  app.post('/v1/charges/:id/transactions', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const { hash } = RegisterTxRequest.parse(req.body)
    const found = await loadChargeWithSession(db, (req.params as any).id)
    if (!found || found.s.payerUserId !== req.user.userId)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })

    type TxResponseBody = { error?: { code: string; message: string }; transactionId?: string }
    const { code, body } = await withIdempotency<TxResponseBody>(db, `tx:${found.c.id}`, key, hash, async () => {
      // transition + insert in one DB transaction: a unique-hash violation rolls
      // back the SUBMITTED transition automatically (no manual state surgery)
      try {
        const txRow = await db.transaction(async tx => {
          const [locked] = await tx.update(paymentSession).set({ status: 'SUBMITTED' })
            .where(and(eq(paymentSession.id, found.s.id), eq(paymentSession.status, 'AWAITING_WALLET_AUTH'))).returning()
          if (!locked) return null
          const [row] = await tx.insert(chainTransaction).values({
            chargeId: found.c.id, sender: req.user.address, recipient: found.c.recipientAddress,
            amountAtomic: found.c.amountAtomic, hash, status: 'SUBMITTED',
          }).returning()
          return row
        })
        if (!txRow) return { code: 409, body: { error: { code: 'INVALID_STATE', message: 'no approved intent' } } }
        await events.publish(db, { sessionId: found.s.id, eventType: 'TX_REGISTERED', actorType: 'payer',
          stateFrom: 'AWAITING_WALLET_AUTH', stateTo: 'SUBMITTED', safeMetadata: { hash } })
        return { code: 201, body: { transactionId: txRow.id } }
      } catch (e: any) {
        if (e?.code === '23505' && e?.constraint_name === 'tx_network_hash')
          return { code: 409, body: { error: { code: 'TX_EXISTS', message: 'hash already registered' } } }
        throw e
      }
    })
    return reply.code(code).send(body)
  })
}
