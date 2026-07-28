import { and, eq, gt, isNull, sql as dsql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { paymentSession, claimAttempt } from '../db/schema'
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
    const { code } = parsed.data

    const { code: status, body } = await withIdempotency<any>(db, `claim:${req.user.userId}`, key, code, async () => {
      const [won] = await db.update(paymentSession).set({
        receiverUserId: req.user.userId, status: 'CLAIMED', claimedAt: new Date(),
        chargeDeadlineAt: new Date(Date.now() + CLAIM_WINDOW_MS),
      }).where(and(
        eq(paymentSession.codeHash, hashCode(code, env.codePepper)),
        eq(paymentSession.status, 'AVAILABLE'),
        gt(paymentSession.expiresAt, new Date()),
        isNull(paymentSession.receiverUserId),
        dsql`${paymentSession.payerUserId} <> ${req.user.userId}`,
      )).returning()

      if (!won) {
        await db.insert(claimAttempt).values([
          { subjectType: 'wallet', subjectHash: walletHash },
          { subjectType: 'ip', subjectHash: ipHash },
        ])
        return { code: 404, body: CODE_UNAVAILABLE }
      }
      await events.publish(db, { sessionId: won.id, eventType: 'CLAIMED', actorType: 'receiver',
        stateFrom: 'AVAILABLE', stateTo: 'CLAIMED' })
      return { code: 200, body: { sessionId: won.id } }
    })
    return reply.code(status).send(body)
  })
}
