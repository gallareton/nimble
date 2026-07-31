import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { paymentSession } from '../src/db/schema'
import { SessionEvents } from '../src/services/events'
import { sweepOnce } from '../src/services/sweeper'
import { freshDb } from './helpers/db'
import { makeUser } from './helpers/actors'

const { db, close } = await freshDb()
afterAll(close)

it('closes expired codes and timed-out claims, emits events', async () => {
  const u = await makeUser(db, 'NQ60 P')
  const r = await makeUser(db, 'NQ61 R')
  const past = new Date(Date.now() - 1000)
  const [expired] = await db.insert(paymentSession)
    .values({ payerUserId: u.id, codeHash: 'h1', expiresAt: past }).returning()
  const [timedOut] = await db.insert(paymentSession)
    .values({ payerUserId: u.id, codeHash: 'h2', expiresAt: past, status: 'CLAIMED',
      receiverUserId: r.id, chargeDeadlineAt: past }).returning()

  const events = new SessionEvents()
  const seen: string[] = []
  events.subscribe(expired.id, e => seen.push(e.eventType))
  events.subscribe(timedOut.id, e => seen.push(e.eventType))

  const res = await sweepOnce(db, events)
  expect(res).toEqual({ expired: 1, cancelled: 1, timedOut: 0 })
  expect(seen.sort()).toEqual(['CLAIM_TIMEOUT', 'CODE_EXPIRED'])
  const [e2] = await db.select().from(paymentSession).where(eq(paymentSession.id, expired.id))
  expect(e2.status).toBe('EXPIRED')
  const [c2] = await db.select().from(paymentSession).where(eq(paymentSession.id, timedOut.id))
  expect(c2.status).toBe('CANCELLED')
  expect(await sweepOnce(db, events)).toEqual({ expired: 0, cancelled: 0, timedOut: 0 })
})
