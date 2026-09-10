import { and, eq, gt, isNull, sql as dsql } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { apiKey, claimAttempt, userProfile } from '../db/schema'
import { env } from '../env'
import { hashCode } from '../services/codeService'

// Its own subject_type, deliberately separate from claim's 'wallet'/'ip'
// rows (and from cashierLock.ts's 'pin-attempt'): an integrator polling
// GET /v1/merchant/charge-requests/:id must never be able to exhaust, or be
// exhausted by, the code-claim throttle a cashier depends on at the counter.
// Same pitfall this session already hit once for previews and PINs — see
// chargeRequests.ts and cashierLock.ts.
const API_KEY_SUBJECT = 'api-key'
const API_KEY_WINDOW_MS = 60_000
// A generous budget for polling integrations, not a guessing surface: the
// key itself is 32 random bytes, so this limit exists to cap abuse of a
// *valid* key, not to slow down brute force (401 already handles that).
const API_KEY_MAX_ATTEMPTS = 120

/**
 * `app.authenticateApiKey`: the Merchant API's counterpart to
 * `app.authenticate` (plugins/auth.ts). Reads `X-Api-Key`, hashes it with the
 * same construction as a payment code (HMAC-SHA256 with env.codePepper —
 * see services/codeService.ts), and looks up a non-revoked `api_key` row.
 * On success it fills `req.user` with the exact shape the JWT path produces
 * (`userId` + `address`), so every existing helper that reads `req.user`
 * (openShiftFor, insertCharge, rate limiters, …) works unchanged under
 * either authentication scheme.
 */
export async function authenticateApiKey(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers['x-api-key']
  const key = typeof header === 'string' ? header : undefined
  if (!key) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'missing api key' } })

  const { db } = req.server.deps
  const keyHash = hashCode(key, env.codePepper)
  const [row] = await db.select().from(apiKey)
    .where(and(eq(apiKey.keyHash, keyHash), isNull(apiKey.revokedAt)))
  if (!row) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid api key' } })

  const since = new Date(Date.now() - API_KEY_WINDOW_MS)
  const [{ count }] = await db.select({ count: dsql<number>`count(*)::int` }).from(claimAttempt)
    .where(and(eq(claimAttempt.subjectType, API_KEY_SUBJECT), eq(claimAttempt.subjectHash, row.id),
      gt(claimAttempt.occurredAt, since)))
  if (count >= API_KEY_MAX_ATTEMPTS)
    return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a moment.' } })
  await db.insert(claimAttempt).values({ subjectType: API_KEY_SUBJECT, subjectHash: row.id })

  const [user] = await db.select().from(userProfile).where(eq(userProfile.id, row.ownerUserId))
  if (!user) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid api key' } })
  req.user = { userId: user.id, address: user.walletAddress }
}
