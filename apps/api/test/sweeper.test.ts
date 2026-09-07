import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { paymentSession, idempotencyRecord, claimAttempt, authNonce } from '../src/db/schema'
import { CLAIM_WINDOW_MS } from '../src/routes/sessions'
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
  expect(res).toMatchObject({ expired: 1, cancelled: 1, timedOut: 0 })
  expect(seen.sort()).toEqual(['CLAIM_TIMEOUT', 'CODE_EXPIRED'])
  const [e2] = await db.select().from(paymentSession).where(eq(paymentSession.id, expired.id))
  expect(e2.status).toBe('EXPIRED')
  const [c2] = await db.select().from(paymentSession).where(eq(paymentSession.id, timedOut.id))
  expect(c2.status).toBe('CANCELLED')
  expect(await sweepOnce(db, events)).toMatchObject({ expired: 0, cancelled: 0, timedOut: 0 })
})

it('purges expired idempotency records, stale claim attempts, and used/stale auth nonces — keeping fresh rows', async () => {
  const past = new Date(Date.now() - 1000)
  const future = new Date(Date.now() + 60_000)

  await db.insert(idempotencyRecord).values([
    { scope: 'test', key: 'expired-1', requestHash: 'h', expiresAt: past },
    { scope: 'test', key: 'fresh-1', requestHash: 'h', expiresAt: future },
  ])

  const staleClaimAt = new Date(Date.now() - (CLAIM_WINDOW_MS * 3 + 1000))
  const freshClaimAt = new Date(Date.now() - 1000)
  await db.insert(claimAttempt).values([
    { subjectType: 'wallet', subjectHash: 'stale', occurredAt: staleClaimAt },
    { subjectType: 'wallet', subjectHash: 'fresh', occurredAt: freshClaimAt },
  ])

  const staleNonceCreated = new Date(Date.now() - 3600_000)
  await db.insert(authNonce).values([
    { nonce: 'used-old', usedAt: staleNonceCreated, createdAt: staleNonceCreated },
    { nonce: 'unused-fresh' },
  ])

  const events = new SessionEvents()
  const res = await sweepOnce(db, events)
  expect(res.idempotencyPurged).toBe(1)
  expect(res.claimAttemptsPurged).toBe(1)
  expect(res.authNoncesPurged).toBe(1)

  const remainingIdem = await db.select().from(idempotencyRecord)
    .where(eq(idempotencyRecord.key, 'fresh-1'))
  expect(remainingIdem).toHaveLength(1)
  const goneIdem = await db.select().from(idempotencyRecord)
    .where(eq(idempotencyRecord.key, 'expired-1'))
  expect(goneIdem).toHaveLength(0)

  const remainingClaims = await db.select().from(claimAttempt)
    .where(eq(claimAttempt.subjectHash, 'fresh'))
  expect(remainingClaims).toHaveLength(1)
  const goneClaims = await db.select().from(claimAttempt)
    .where(eq(claimAttempt.subjectHash, 'stale'))
  expect(goneClaims).toHaveLength(0)

  const remainingNonce = await db.select().from(authNonce)
    .where(eq(authNonce.nonce, 'unused-fresh'))
  expect(remainingNonce).toHaveLength(1)
  const goneNonce = await db.select().from(authNonce)
    .where(eq(authNonce.nonce, 'used-old'))
  expect(goneNonce).toHaveLength(0)
})
