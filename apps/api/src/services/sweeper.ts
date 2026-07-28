import { and, eq, lt } from 'drizzle-orm'
import { paymentSession } from '../db/schema'
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

  return { expired: expired.length, cancelled: cancelled.length }
}

export function startSweeper(db: Db, events: SessionEvents, intervalMs = 5000): () => void {
  const h = setInterval(() => { void sweepOnce(db, events).catch(() => {}) }, intervalMs)
  return () => clearInterval(h)
}
