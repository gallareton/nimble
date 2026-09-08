import { and, eq, gt, sql as dsql } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { claimAttempt, userProfile } from '../db/schema'
import type { Db } from '../db/client'
import { CLAIM_WINDOW_MS } from '../routes/sessions'

// PIN guessing gets its own subject_type and its own counter, deliberately
// separate from claim's 'wallet'/'ip' rows: a cashier locked out of the code
// claim limiter by a vendor guessing their own PIN would be unable to work
// the counter, which is exactly the failure mode this lock must not cause.
export const PIN_ATTEMPT_SUBJECT = 'pin-attempt'
// Four digits is only 10,000 possibilities — the same order of magnitude as
// claim's six-digit code gets a MAX_FAILED of 10 for, so reuse that bound.
const MAX_PIN_ATTEMPTS = 10

/** True once a profile has failed enough PIN attempts recently that a
 *  further guess (set/change PIN, or unlock) must be refused with 429. */
export async function pinRateLimited(db: Db, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - CLAIM_WINDOW_MS)
  const [{ count }] = await db.select({ count: dsql<number>`count(*)::int` }).from(claimAttempt)
    .where(and(eq(claimAttempt.subjectType, PIN_ATTEMPT_SUBJECT), eq(claimAttempt.subjectHash, userId),
      gt(claimAttempt.occurredAt, since)))
  return count >= MAX_PIN_ATTEMPTS
}

export async function recordFailedPinAttempt(db: Db, userId: string): Promise<void> {
  await db.insert(claimAttempt).values({ subjectType: PIN_ATTEMPT_SUBJECT, subjectHash: userId })
}

export function sendPinRateLimited(reply: FastifyReply) {
  return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a moment.' } })
}

/**
 * The one place the four gated operations (refund, export, shift close,
 * PATCH /v1/me) check the lock. Sends the 423 itself and reports whether it
 * did, so a route's whole enforcement is `if (await rejectIfCashierLocked(...)) return`.
 * Never touches the payment-acceptance path or GET .../report — those are
 * deliberately not gated, see spec §5.
 */
export async function rejectIfCashierLocked(db: Db, userId: string, reply: FastifyReply): Promise<boolean> {
  const [u] = await db.select({ cashierLocked: userProfile.cashierLocked })
    .from(userProfile).where(eq(userProfile.id, userId))
  if (!u?.cashierLocked) return false
  reply.code(423).send({ error: { code: 'CASHIER_LOCKED', message: 'cashier lock is active' } })
  return true
}
