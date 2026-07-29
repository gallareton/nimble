import { and, eq, gt, isNull, inArray, sql as dsql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { paymentSession, claimAttempt, charge, userProfile, chainTransaction } from '../db/schema'
import { env } from '../env'
import { withIdempotency } from '../plugins/idempotency'
import { generateCode, hashCode } from '../services/codeService'
import { ClaimRequest } from '@nimblink/shared'
import { createHmac } from 'node:crypto'

export const CODE_TTL_MS = 120_000
export const CLAIM_WINDOW_MS = 60_000
const MAX_FAILED = 10

export function requireIdemKey(req: any, reply: any): string | undefined {
  const key = req.headers['idempotency-key']
  if (!key) { reply.code(400).send({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header required' } }); return }
  return String(key)
}

export async function sessionRoutes(app: FastifyInstance) {
  const { db, events } = app.deps

  app.post('/v1/sessions', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const { code: status, body } = await withIdempotency(db, `sessions:${req.user.userId}`, key, 'create', async () => {
      // one active code per payer: expire any previous AVAILABLE session.
      // Two racing creates with different idem keys can still collide on the
      // partial unique index — retry the expire+insert pair once on 23505.
      const create = async () => {
        await db.update(paymentSession).set({ status: 'EXPIRED' })
          .where(and(eq(paymentSession.payerUserId, req.user.userId), eq(paymentSession.status, 'AVAILABLE')))
        const code = generateCode()
        const expiresAt = new Date(Date.now() + CODE_TTL_MS)
        const [s] = await db.insert(paymentSession).values({
          payerUserId: req.user.userId, codeHash: hashCode(code, env.codePepper), expiresAt,
        }).returning()
        return { s, code, expiresAt }
      }
      let created
      try { created = await create() }
      catch (e: any) {
        if (!String(e?.message).includes('one_available_code_per_payer')) throw e
        created = await create()
      }
      const { s, code, expiresAt } = created
      await events.publish(db, { sessionId: s.id, eventType: 'CODE_CREATED', actorType: 'payer', stateTo: 'AVAILABLE' })
      return { code: 201, body: { sessionId: s.id, code, expiresAt: expiresAt.toISOString() } }
    })
    return reply.code(status).send(body)
  })

  const CODE_UNAVAILABLE = { error: { code: 'CODE_UNAVAILABLE', message: 'Code unavailable. Check and try again.' } }

  app.post('/v1/sessions/claim', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const walletHash = createHmac('sha256', env.codePepper).update(req.user.address).digest('hex')
    const ipHash = createHmac('sha256', env.codePepper).update(req.ip).digest('hex')

    // spec 15.2: throttle per wallet AND per IP (IP threshold higher — shared networks)
    const failedSince = new Date(Date.now() - CLAIM_WINDOW_MS)
    const countFor = async (type: string, hash: string) => {
      const [{ count }] = await db.select({ count: dsql<number>`count(*)::int` }).from(claimAttempt)
        .where(and(eq(claimAttempt.subjectType, type), eq(claimAttempt.subjectHash, hash),
          gt(claimAttempt.occurredAt, failedSince)))
      return count
    }
    if (await countFor('wallet', walletHash) >= MAX_FAILED || await countFor('ip', ipHash) >= MAX_FAILED * 3)
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a moment.' } })

    // Validate request body; malformed requests count as failed attempts
    const parsed = ClaimRequest.safeParse(req.body)
    if (!parsed.success) {
      await db.insert(claimAttempt).values([
        { subjectType: 'wallet', subjectHash: walletHash },
        { subjectType: 'ip', subjectHash: ipHash },
      ])
      return reply.code(404).send(CODE_UNAVAILABLE)
    }
    const { code, amountLuna, reference } = parsed.data

    const idemPayload = amountLuna ? `${code}:${amountLuna}` : code
    const { code: status, body } = await withIdempotency<any>(db, `claim:${req.user.userId}`, key, idemPayload, async () => {
      // BLIK-style: when the receiver supplies the amount up front, claiming
      // and charging happen in one atomic transaction — the payer's next SSE
      // event is already AWAITING_PAYER_APPROVAL with the charge attached.
      const result = await db.transaction(async tx => {
        const [won] = await tx.update(paymentSession).set({
          receiverUserId: req.user.userId,
          status: amountLuna ? 'AWAITING_PAYER_APPROVAL' : 'CLAIMED',
          claimedAt: new Date(),
          chargeDeadlineAt: new Date(Date.now() + CLAIM_WINDOW_MS),
        }).where(and(
          eq(paymentSession.codeHash, hashCode(code, env.codePepper)),
          eq(paymentSession.status, 'AVAILABLE'),
          gt(paymentSession.expiresAt, new Date()),
          isNull(paymentSession.receiverUserId),
          dsql`${paymentSession.payerUserId} <> ${req.user.userId}`,
        )).returning()
        if (!won) return null
        if (!amountLuna) return { won, c: null }
        const [receiver] = await tx.select().from(userProfile).where(eq(userProfile.id, req.user.userId))
        const [c] = await tx.insert(charge).values({
          sessionId: won.id, amountAtomic: BigInt(amountLuna),
          recipientAddress: receiver.walletAddress, reference: reference ?? null,
        }).returning()
        return { won, c }
      })

      if (!result) {
        await db.insert(claimAttempt).values([
          { subjectType: 'wallet', subjectHash: walletHash },
          { subjectType: 'ip', subjectHash: ipHash },
        ])
        return { code: 404, body: CODE_UNAVAILABLE }
      }
      const { won, c } = result
      await events.publish(db, { sessionId: won.id, eventType: 'CLAIMED', actorType: 'receiver',
        stateFrom: 'AVAILABLE', stateTo: 'CLAIMED' })
      if (c) await events.publish(db, { sessionId: won.id, eventType: 'CHARGE_SUBMITTED', actorType: 'receiver',
        stateFrom: 'CLAIMED', stateTo: 'AWAITING_PAYER_APPROVAL' })
      return { code: 200, body: { sessionId: won.id, ...(c ? { chargeId: c.id } : {}) } }
    })
    return reply.code(status).send(body)
  })

  app.get('/v1/sessions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, id))
    if (!s || (s.payerUserId !== req.user.userId && s.receiverUserId !== req.user.userId))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'session not found' } })

    const role = s.payerUserId === req.user.userId ? 'payer' : 'receiver'
    const [c] = await db.select().from(charge).where(eq(charge.sessionId, id))
    const [tx] = c ? await db.select().from(chainTransaction).where(eq(chainTransaction.chargeId, c.id)) : []

    let counterpart
    if (role === 'payer' && s.receiverUserId) {
      const [r] = await db.select().from(userProfile).where(eq(userProfile.id, s.receiverUserId))
      counterpart = { displayName: r.displayName ?? `…${r.walletAddress.slice(-4)}`,
        verificationStatus: 'unverified' as const, addressTail: r.walletAddress.slice(-4) }
    } else if (role === 'receiver') {
      const [p] = await db.select().from(userProfile).where(eq(userProfile.id, s.payerUserId))
      counterpart = { displayName: 'Payer connected', verificationStatus: 'unverified' as const,
        addressTail: p.walletAddress.slice(-4) }
    }
    return {
      sessionId: s.id, status: s.status, role, expiresAt: s.expiresAt.toISOString(),
      chargeDeadlineAt: s.chargeDeadlineAt?.toISOString(), counterpart,
      charge: c ? { chargeId: c.id, version: c.version, amountLuna: c.amountAtomic.toString(),
        asset: 'NIM', network: 'nimiq', reference: c.reference, recipientAddress: c.recipientAddress } : undefined,
      transaction: tx ? { hash: tx.hash, status: tx.status, confirmations: tx.confirmations } : undefined,
    }
  })

  app.post('/v1/sessions/:id/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as any).id
    const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, id))
    if (!s || (s.payerUserId !== req.user.userId && s.receiverUserId !== req.user.userId))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
    if (s.receiverUserId !== req.user.userId)
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'only receiver cancels' } })
    const [c] = await db.select().from(charge).where(eq(charge.sessionId, id))
    if (c?.reconciliationToken)
      return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'payer already approved' } })
    const [updated] = await db.update(paymentSession).set({ status: 'CANCELLED' })
      .where(and(eq(paymentSession.id, id),
        inArray(paymentSession.status, ['CLAIMED', 'AWAITING_PAYER_APPROVAL']))).returning()
    if (!updated) return reply.code(409).send({ error: { code: 'INVALID_STATE', message: 'cannot cancel now' } })
    await events.publish(db, { sessionId: id, eventType: 'CANCELLED', actorType: 'receiver',
      stateFrom: s.status, stateTo: 'CANCELLED' })
    return { status: 'CANCELLED' }
  })
}
