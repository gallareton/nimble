import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { paymentSession } from '../db/schema'
import { env } from '../env'
import { withIdempotency } from '../plugins/idempotency'
import { generateCode, hashCode } from '../services/codeService'

export const CODE_TTL_MS = 120_000

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
}
