import { and, eq, inArray, lt } from 'drizzle-orm'
import { charge, paymentSession } from '../db/schema'
import type { Db } from '../db/client'
import type { SessionEvents } from './events'

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

  return { expired: expired.length, cancelled: cancelled.length, timedOut }
}

export function startSweeper(db: Db, events: SessionEvents, intervalMs = 5000): () => void {
  const h = setInterval(() => { void sweepOnce(db, events).catch(() => {}) }, intervalMs)
  return () => clearInterval(h)
}
