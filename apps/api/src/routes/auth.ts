import { randomBytes } from 'node:crypto'
import { eq, isNull, and } from 'drizzle-orm'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { AuthVerifyRequest } from '@nimblink/shared'
import { authNonce, userProfile } from '../db/schema'
import { env } from '../env'

export async function authRoutes(app: FastifyInstance) {
  const { db, verifier } = app.deps

  app.post('/v1/auth/challenge', async () => {
    const nonce = randomBytes(16).toString('hex')
    await db.insert(authNonce).values({ nonce })
    return { nonce, message: `NIMblink login ${nonce}` }
  })

  app.post('/v1/auth/verify', async (req, reply) => {
    const body = AuthVerifyRequest.parse(req.body)
    // consume nonce atomically: only unused + fresh (5 min)
    const [row] = await db.update(authNonce).set({ usedAt: new Date() })
      .where(and(eq(authNonce.nonce, body.nonce), isNull(authNonce.usedAt)))
      .returning()
    if (!row || Date.now() - row.createdAt.getTime() > 300_000)
      return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid nonce' } })

    const { valid, address } = await verifier.verify(
      `NIMblink login ${body.nonce}`, body.publicKey, body.signature)
    if (!valid || !address)
      return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid signature' } })

    const [user] = await db.insert(userProfile).values({ walletAddress: address })
      .onConflictDoUpdate({ target: userProfile.walletAddress, set: { walletAddress: address } })
      .returning()
    const token = await new SignJWT({ addr: address }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id).setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.jwtSecret))
    return { token, address }
  })

  app.patch('/v1/me', { preHandler: app.authenticate }, async (req, reply) => {
    const body = req.body as { displayName?: unknown }
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 50) : ''
    if (!displayName)
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'displayName required' } })
    await db.update(userProfile).set({ displayName }).where(eq(userProfile.id, req.user.userId))
    return { ok: true }
  })
}
