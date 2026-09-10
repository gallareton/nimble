import { createHash, randomBytes } from 'node:crypto'
import { eq, gt, isNull, and, desc } from 'drizzle-orm'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { AuthVerifyRequest, SetCashierPinRequest, CashierUnlockRequest, CreateApiKeyRequest, UpdateProfileRequest } from '@nimble/shared'
import { authNonce, authSession, apiKey, userProfile } from '../db/schema'
import { env } from '../env'
import { hashCode } from '../services/codeService'
import { pinRateLimited, recordFailedPinAttempt, sendPinRateLimited, rejectIfCashierLocked } from '../services/cashierLock'

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

  // cashierLocked/cashierPinSet ride along here so the till screen and the
  // settings screen both know the lock state without a probe request — the
  // hash itself never leaves the server, only whether one exists (spec §3).
  app.get('/v1/me', { preHandler: app.authenticate }, async (req) => {
    const [u] = await db.select({ walletAddress: userProfile.walletAddress,
      displayName: userProfile.displayName, cashierLocked: userProfile.cashierLocked,
      cashierPinHash: userProfile.cashierPinHash, businessName: userProfile.businessName,
      businessAddress: userProfile.businessAddress, taxId: userProfile.taxId })
      .from(userProfile).where(eq(userProfile.id, req.user.userId))
    if (!u) return u
    return { walletAddress: u.walletAddress, displayName: u.displayName,
      cashierLocked: u.cashierLocked, cashierPinSet: u.cashierPinHash !== null,
      businessName: u.businessName, businessAddress: u.businessAddress, taxId: u.taxId }
  })

  // businessName/businessAddress/taxId (BR-P15) ride the same route and the
  // same cashier-lock gate as displayName — all four are "who a payer sees
  // before they confirm" settings. taxId is never verified against
  // anything: it is stored exactly as typed, printed on receipts only (see
  // charge.receiverTaxId), and must never reach a payer's approval screen.
  // An empty string clears a field back to null; omitting a key leaves it
  // untouched.
  app.patch('/v1/me', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
    const body = req.body as { displayName?: unknown }
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 50) : ''
    if (!displayName)
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'displayName required' } })
    const profile = UpdateProfileRequest.parse(req.body)
    const norm = (v: string | null | undefined) =>
      v == null ? null : (v.trim() === '' ? null : v.trim())
    await db.update(userProfile).set({ displayName,
      ...(profile.businessName !== undefined ? { businessName: norm(profile.businessName) } : {}),
      ...(profile.businessAddress !== undefined ? { businessAddress: norm(profile.businessAddress) } : {}),
      ...(profile.taxId !== undefined ? { taxId: norm(profile.taxId) } : {}),
    }).where(eq(userProfile.id, req.user.userId))
    return { ok: true }
  })

  // Sets a fresh PIN, or changes an existing one. A PIN already on the
  // profile must be proven with currentPin before it can be replaced — the
  // lock is worthless if anyone holding the phone could just reset it.
  // Rate-limited by the same per-profile counter as unlock: this is the same
  // guessing surface (spec §5).
  app.put('/v1/me/cashier-pin', { preHandler: app.authenticate }, async (req, reply) => {
    if (await pinRateLimited(db, req.user.userId)) return sendPinRateLimited(reply)
    const body = SetCashierPinRequest.parse(req.body)
    const [u] = await db.select({ cashierPinHash: userProfile.cashierPinHash })
      .from(userProfile).where(eq(userProfile.id, req.user.userId))
    if (u?.cashierPinHash) {
      const matches = body.currentPin !== undefined
        && hashCode(body.currentPin, env.codePepper) === u.cashierPinHash
      if (!matches) {
        await recordFailedPinAttempt(db, req.user.userId)
        return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'currentPin is required and must match' } })
      }
    }
    await db.update(userProfile).set({ cashierPinHash: hashCode(body.pin, env.codePepper) })
      .where(eq(userProfile.id, req.user.userId))
    return { ok: true }
  })

  // Enables the lock. Deliberately no PIN required to flip this on — the
  // owner steps away from the counter and locks with one tap — but it can
  // never be turned on without a PIN already set, or it could never be
  // turned back off (spec §3-4).
  app.post('/v1/me/cashier-lock', { preHandler: app.authenticate }, async (req, reply) => {
    const [u] = await db.select({ cashierPinHash: userProfile.cashierPinHash })
      .from(userProfile).where(eq(userProfile.id, req.user.userId))
    if (!u?.cashierPinHash)
      return reply.code(409).send({ error: { code: 'PIN_NOT_SET', message: 'set a cashier PIN before enabling the lock' } })
    await db.update(userProfile).set({ cashierLocked: true }).where(eq(userProfile.id, req.user.userId))
    return { ok: true }
  })

  // Disables the lock. Requires the PIN, and is the reason the PIN-guessing
  // rate limit exists at all: four digits is only 10,000 possibilities.
  app.delete('/v1/me/cashier-lock', { preHandler: app.authenticate }, async (req, reply) => {
    if (await pinRateLimited(db, req.user.userId)) return sendPinRateLimited(reply)
    const body = CashierUnlockRequest.parse(req.body)
    const [u] = await db.select({ cashierPinHash: userProfile.cashierPinHash })
      .from(userProfile).where(eq(userProfile.id, req.user.userId))
    if (!u?.cashierPinHash || hashCode(body.pin, env.codePepper) !== u.cashierPinHash) {
      await recordFailedPinAttempt(db, req.user.userId)
      return reply.code(401).send({ error: { code: 'AUTH_FAILED', message: 'incorrect PIN' } })
    }
    await db.update(userProfile).set({ cashierLocked: false }).where(eq(userProfile.id, req.user.userId))
    return { ok: true }
  })

  // Merchant API credentials — these are settings, same as the cashier PIN
  // and lock above, so all three sit behind the cashier lock (spec §5/Task 3).
  //
  // The plaintext key exists on the server ONLY for the lifetime of this one
  // response — generated, hashed, and handed back in the same request. It is
  // never stored (only keyHash is) and never logged: do not add request/
  // response body logging to this route.
  app.post('/v1/me/api-keys', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
    const body = CreateApiKeyRequest.parse(req.body)
    const rawKey = `nmbl_${randomBytes(32).toString('hex')}`
    const [row] = await db.insert(apiKey).values({
      ownerUserId: req.user.userId,
      keyHash: hashCode(rawKey, env.codePepper),
      label: body.label,
    }).returning()
    return reply.code(201).send({ id: row.id, label: row.label, key: rawKey, createdAt: row.createdAt.toISOString() })
  })

  app.get('/v1/me/api-keys', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
    const rows = await db.select({ id: apiKey.id, label: apiKey.label,
      createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt })
      .from(apiKey).where(eq(apiKey.ownerUserId, req.user.userId))
      .orderBy(desc(apiKey.createdAt), desc(apiKey.id))
    return rows.map(r => ({ id: r.id, label: r.label, createdAt: r.createdAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null }))
  })

  app.delete('/v1/me/api-keys/:id', { preHandler: app.authenticate }, async (req, reply) => {
    if (await rejectIfCashierLocked(db, req.user.userId, reply)) return
    const id = (req.params as { id: string }).id
    const [gone] = await db.update(apiKey).set({ revokedAt: new Date() })
      .where(and(eq(apiKey.id, id), eq(apiKey.ownerUserId, req.user.userId), isNull(apiKey.revokedAt)))
      .returning()
    if (!gone) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'api key not found' } })
    return reply.code(204).send()
  })
}
