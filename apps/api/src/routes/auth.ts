import { createHash, randomBytes } from 'node:crypto'
import { eq, gt, isNull, and } from 'drizzle-orm'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { AuthVerifyRequest } from '@nimble/shared'
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
  const { db, hostVerifier } = app.deps

  app.post('/v1/auth/challenge', async () => {
    const nonce = randomBytes(16).toString('hex')
    await db.insert(authNonce).values({ nonce })
    const message = hostVerifier.challenge(nonce)
    // A scheme with no challenge (Telegram's initData, say) has nothing to
    // show the user. Omit the field rather than sending null, which invites a
    // client to render it.
    return message === null ? { nonce } : { nonce, message }
  })

  app.post('/v1/auth/verify', async (req, reply) => {
    const body = AuthVerifyRequest.parse(req.body)

    // Our nonce is the replay defence only for schemes that issue a challenge
    // over it. A scheme with no challenge carries its own (Telegram's initData
    // has auth_date), and consuming ours there would look like protection
    // while providing none — see the note on HostVerifier.challenge.
    if (hostVerifier.challenge(body.nonce) !== null) {
      // consume nonce atomically: only unused + fresh (5 min)
      const [row] = await db.update(authNonce).set({ usedAt: new Date() })
        .where(and(eq(authNonce.nonce, body.nonce), isNull(authNonce.usedAt)))
        .returning()
      if (!row || Date.now() - row.createdAt.getTime() > 300_000)
        return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid nonce' } })
    }

    // The wire format still speaks Nimiq's shape on purpose: a user with the
    // Mini App already open holds the old JavaScript, and generalising the
    // request body would hand them a 400 for no benefit until a second host
    // exists. The route adapts it to the credential the boundary wants.
    const identity = await hostVerifier.verify({
      scheme: hostVerifier.scheme,
      nonce: body.nonce,
      payload: { publicKey: body.publicKey, signature: body.signature },
    })
    if (!identity)
      return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid signature' } })

    // wallet_address is NOT NULL, so a host that cannot name a payout address
    // has nowhere to be stored yet. No shipped scheme produces this, so it is
    // a misconfiguration, not a user path — refuse loudly rather than writing
    // an empty address. Lifting this needs the identity migration in the spec.
    const address = identity.payoutAddress
    if (!address) {
      req.log.error({ scheme: hostVerifier.scheme },
        'host verifier returned an identity with no payout address; user_profile cannot store it')
      return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'invalid signature' } })
    }

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
