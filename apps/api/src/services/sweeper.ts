import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { charge, paymentSession, idempotencyRecord, claimAttempt, authNonce } from '../db/schema'
import { CLAIM_WINDOW_MS } from '../routes/sessions'
import type { Db } from '../db/client'
import type { SessionEvents } from './events'

// The claim-attempt rate limiter only ever looks at rows newer than
// `now - CLAIM_WINDOW_MS`, so anything older is safe to delete. Keep a wide
// margin (a multiple of the window) as slack against clock skew.
const CLAIM_ATTEMPT_RETENTION_MS = CLAIM_WINDOW_MS * 3
// auth_nonce has no expiry column; challenges are only ever valid for 5
// minutes (see routes/auth.ts), so anything from over an hour ago — used or
// not — is safe to drop.
const AUTH_NONCE_RETENTION_MS = 60 * 60_000

export async function sweepOnce(db: Db, events: SessionEvents) {
  const now = new Date()
  const expired = await db.update(paymentSession).set({ status: 'EXPIRED' })
    .where(and(eq(paymentSession.status, 'AVAILABLE'), lt(paymentSession.expiresAt, now))).returning()
  for (const s of expired)
    await events.publish(db, { sessionId: s.id, eventType: 'CODE_EXPIRED', actorType: 'system',
      stateFrom: 'AVAILABLE', stateTo: 'EXPIRED' })

  const cancelled = await db.update(paymentSession).set({ status: 'CANCELLED' })
    .where(and(eq(paymentSession.status, 'CLAIMED'), lt(paymentSession.chargeDeadlineAt, now))).returning()
  for (const s of cancelled)
    await events.publish(db, { sessionId: s.id, eventType: 'CLAIM_TIMEOUT', actorType: 'system',
      stateFrom: 'CLAIMED', stateTo: 'CANCELLED' })

  // Abandoned approvals: payer never confirmed (or the wallet refused —
  // e.g. insufficient funds — and they left). Close after 15 minutes so
  // the receiver isn't stuck watching forever.
  const APPROVAL_TTL_MS = 15 * 60_000
  const stale = await db.select({ s: paymentSession, c: charge })
    .from(paymentSession)
    .innerJoin(charge, eq(charge.sessionId, paymentSession.id))
    .where(and(
      inArray(paymentSession.status, ['AWAITING_PAYER_APPROVAL', 'AWAITING_WALLET_AUTH']),
      lt(charge.createdAt, new Date(now.getTime() - APPROVAL_TTL_MS))))
  let timedOut = 0
  for (const { s } of stale) {
    const [updated] = await db.update(paymentSession).set({ status: 'REJECTED' })
      .where(and(eq(paymentSession.id, s.id), eq(paymentSession.status, s.status))).returning()
    if (!updated) continue
    timedOut += 1
    await events.publish(db, { sessionId: s.id, eventType: 'APPROVAL_TIMEOUT', actorType: 'system',
      stateFrom: s.status, stateTo: 'REJECTED' })
  }

  // Plaintext codes only ever live here for their idempotency TTL (see
  // withIdempotency) — nothing else reads request_hash after that. Rows are
  // never left in the database once they expire.
  const purgedIdem = await db.delete(idempotencyRecord)
    .where(lt(idempotencyRecord.expiresAt, now)).returning()

  // The rate limiter only looks at rows newer than now - CLAIM_WINDOW_MS,
  // so a wide multiple of that window is always safe to delete.
  const purgedClaims = await db.delete(claimAttempt)
    .where(lt(claimAttempt.occurredAt, new Date(now.getTime() - CLAIM_ATTEMPT_RETENTION_MS)))
    .returning()

  // routes/auth.ts only ever marks a nonce used (usedAt), never deletes it —
  // that's why this table grows unbounded otherwise. Drop consumed nonces
  // outright, and unused ones once they're well past the 5-minute challenge
  // window (routes/auth.ts) with slack against clock skew.
  const purgedNonces = await db.delete(authNonce)
    .where(or(
      isNotNull(authNonce.usedAt),
      lt(authNonce.createdAt, new Date(now.getTime() - AUTH_NONCE_RETENTION_MS)),
    )).returning()

  return {
    expired: expired.length, cancelled: cancelled.length, timedOut,
    idempotencyPurged: purgedIdem.length,
    claimAttemptsPurged: purgedClaims.length,
    authNoncesPurged: purgedNonces.length,
  }
}

export function startSweeper(db: Db, events: SessionEvents, intervalMs = 5000): () => void {
  const h = setInterval(() => { void sweepOnce(db, events).catch(() => {}) }, intervalMs)
  return () => clearInterval(h)
}
