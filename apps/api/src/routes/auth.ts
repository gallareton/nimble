import { createHash, randomBytes } from 'node:crypto'
import { eq, gt, isNull, and } from 'drizzle-orm'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { AuthVerifyRequest } from '@nimblink/shared'
import { authNonce, authSession, userProfile } from '../db/schema'
import { env } from '../env'

// Refresh tokens are opaque secrets; only their sha256 lands in the DB, so a
// leaked DB dump cannot be replayed. Idle sessions die after 30 days.
const REFRESH_IDLE_MS = 30 * 24 * 3600_000
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

async function issueJwt(userId: string, address: string) {
  return new SignJWT({ addr: address }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.jwtSecret))
}

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
    const refreshToken = randomBytes(32).toString('hex')
    await db.insert(authSession).values({ userId: user.id, tokenHash: hashToken(refreshToken) })
    const token = await issueJwt(user.id, address)
    return { token, address, refreshToken }
  })

  // Silent re-login for a returning mini app: exchange the stored refresh
  // token for a fresh JWT. Single-use — every exchange rotates the token.
  app.post('/v1/auth/refresh', async (req, reply) => {
    const body = req.body as { refreshToken?: unknown }
    const supplied = typeof body?.refreshToken === 'string' ? body.refreshToken : ''
    const denied = () =>
      reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid refresh token' } })
    if (!supplied) return denied()

    const next = randomBytes(32).toString('hex')
    // rotate atomically: the row is matched by the old hash (and only while
    // not idle-expired) and rewritten in one statement, so a replayed old
    // token can never win a race
    const [session] = await db.update(authSession)
      .set({ tokenHash: hashToken(next), lastUsedAt: new Date() })
      .where(and(eq(authSession.tokenHash, hashToken(supplied)),
        gt(authSession.lastUsedAt, new Date(Date.now() - REFRESH_IDLE_MS))))
      .returning()
    if (!session) return denied()

    const [user] = await db.select().from(userProfile).where(eq(userProfile.id, session.userId))
    if (!user) return denied()
    const token = await issueJwt(user.id, user.walletAddress)
    return { token, address: user.walletAddress, refreshToken: next }
  })

  app.get('/v1/me', { preHandler: app.authenticate }, async (req) => {
    const [u] = await db.select({ walletAddress: userProfile.walletAddress,
      displayName: userProfile.displayName })
      .from(userProfile).where(eq(userProfile.id, req.user.userId))
    return u
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
