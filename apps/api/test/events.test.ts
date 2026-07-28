import { afterAll, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { SessionEvents } from '../src/services/events'
import { paymentSession, sessionEvent, userProfile } from '../src/db/schema'
import { freshDb } from './helpers/db'

const { db, close } = await freshDb()
afterAll(close)

it('persists audit row and notifies subscribers', async () => {
  const [u] = await db.insert(userProfile).values({ walletAddress: 'NQ01 A' }).returning()
  const [s] = await db.insert(paymentSession)
    .values({ payerUserId: u.id, codeHash: 'h', expiresAt: new Date() }).returning()

  const events = new SessionEvents()
  const got: string[] = []
  const unsub = events.subscribe(s.id, e => got.push(e.eventType))
  await events.publish(db, { sessionId: s.id, eventType: 'CLAIMED', actorType: 'receiver',
    stateFrom: 'AVAILABLE', stateTo: 'CLAIMED' })
  unsub()
  await events.publish(db, { sessionId: s.id, eventType: 'IGNORED', actorType: 'system' })

  expect(got).toEqual(['CLAIMED'])
  const rows = await db.select().from(sessionEvent)
    .where(eq(sessionEvent.sessionId, s.id)).orderBy(desc(sessionEvent.occurredAt))
  expect(rows).toHaveLength(2)
})
