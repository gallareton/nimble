import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chainTransaction, charge, paymentSession, receipt } from '../src/db/schema'
import { SessionEvents } from '../src/services/events'
import { monitorTick } from '../src/services/monitor'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = (t: string) => ({ authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() })

it('GET /v1/me returns the saved profile', async () => {
  const u = await makeUser(db, `NQ40 ${crypto.randomUUID().slice(0, 8)}`)
  const t = await tokenFor(u)

  let r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${t}` } })
  expect(r.statusCode).toBe(200)
  expect(r.json()).toEqual({ walletAddress: u.walletAddress, displayName: null,
    cashierLocked: false, cashierPinSet: false,
    businessName: null, businessAddress: null, taxId: null })

  await app.inject({ method: 'PATCH', url: '/v1/me', payload: { displayName: 'Gall' },
    headers: { authorization: `Bearer ${t}` } })
  r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${t}` } })
  expect(r.json()).toEqual({ walletAddress: u.walletAddress, displayName: 'Gall',
    cashierLocked: false, cashierPinSet: false,
    businessName: null, businessAddress: null, taxId: null })
})

// BR-P15: the point-of-sale profile. Entirely unverified — the assertions
// below are as much about what does NOT change (no "verified" claim
// anywhere) as about what does.
it('PATCH /v1/me saves businessName/businessAddress/taxId; GET returns them; empty string clears a field', async () => {
  const u = await makeUser(db, `NQ43 ${crypto.randomUUID().slice(0, 8)}`)
  const t = await tokenFor(u)
  const auth = { authorization: `Bearer ${t}` }

  const patch1 = await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', businessName: 'Corner Kiosk', businessAddress: '1 Market St',
      taxId: 'PL1234567890' }, headers: auth })
  expect(patch1.statusCode).toBe(200)

  let r = await app.inject({ url: '/v1/me', headers: auth })
  expect(r.json()).toEqual({ walletAddress: u.walletAddress, displayName: 'Gall',
    cashierLocked: false, cashierPinSet: false,
    businessName: 'Corner Kiosk', businessAddress: '1 Market St', taxId: 'PL1234567890' })

  // Clearing: an empty string resets a field to null; omitted keys are left
  // untouched (displayName is required by this route regardless).
  const patch2 = await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', taxId: '' }, headers: auth })
  expect(patch2.statusCode).toBe(200)
  r = await app.inject({ url: '/v1/me', headers: auth })
  expect(r.json().taxId).toBeNull()
  expect(r.json().businessName).toBe('Corner Kiosk') // untouched — key was omitted
})

it('PATCH /v1/me rejects a taxId over 20 characters', async () => {
  const u = await makeUser(db, `NQ44 ${crypto.randomUUID().slice(0, 8)}`)
  const t = await tokenFor(u)
  const r = await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', taxId: 'x'.repeat(21) },
    headers: { authorization: `Bearer ${t}` } })
  expect(r.statusCode).toBe(400)
})

it('SessionView.counterpart.businessName carries the receiver\'s point-of-sale name to the payer', async () => {
  const payer = await makeUser(db, `NQ45 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ46 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const rt = await tokenFor(receiver)
  await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', businessName: 'Corner Kiosk' }, headers: auth(rt) })

  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: idem(pt) })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code }, headers: idem(rt) })

  const view = (await app.inject({ url: `/v1/sessions/${sessionId}`, headers: auth(pt) })).json()
  expect(view.counterpart.businessName).toBe('Corner Kiosk')
})

it('the remote-bill preview carries businessName but never taxId', async () => {
  const receiver = await makeUser(db, `NQ47 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', businessName: 'Corner Kiosk', taxId: 'PL1234567890' }, headers: auth(rt) })

  const created = (await app.inject({ method: 'POST', url: '/v1/charge-requests',
    payload: { amountLuna: '100000' }, headers: idem(rt) })).json()
  const preview = (await app.inject({ url: `/v1/charge-requests/${created.id}` })).json()
  expect(preview.businessName).toBe('Corner Kiosk')
  expect(preview.taxId).toBeUndefined()
  expect(JSON.stringify(preview)).not.toContain('PL1234567890')
})

it('a receipt freezes receiverBusinessName/receiverTaxId at sale time; a later profile change does not rewrite it', async () => {
  const payer = await makeUser(db, `NQ48 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ49 ${crypto.randomUUID().slice(0, 8)}`)
  const rt = await tokenFor(receiver)
  await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', businessName: 'Corner Kiosk', taxId: 'PL1234567890' }, headers: auth(rt) })

  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: crypto.randomUUID(),
    status: 'SUBMITTED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  const [c] = await db.insert(charge).values({
    sessionId: session.id, amountAtomic: 250_000n, recipientAddress: receiver.walletAddress,
    receiverBusinessName: 'Corner Kiosk', receiverTaxId: 'PL1234567890',
  }).returning()
  const [tx] = await db.insert(chainTransaction).values({
    chargeId: c.id, sender: payer.walletAddress, recipient: receiver.walletAddress,
    amountAtomic: 250_000n, hash: crypto.randomUUID(),
  }).returning()

  const chain = { findIncomingByData: async () => null,
    getTransaction: async () => ({ includedAtHeight: 100, expired: false }),
    getLastMacroHeight: async () => 120 }
  await monitorTick(db, new SessionEvents(), chain)

  const [receiptRow] = await db.select().from(receipt).where(eq(receipt.transactionId, tx.id))
  const snapshot = receiptRow.snapshotJson as { receiverBusinessName: string; receiverTaxId: string }
  expect(snapshot.receiverBusinessName).toBe('Corner Kiosk')
  expect(snapshot.receiverTaxId).toBe('PL1234567890')

  // Renaming the point of sale after the sale must not rewrite the receipt
  // already printed — same rule as the frozen price.
  await app.inject({ method: 'PATCH', url: '/v1/me',
    payload: { displayName: 'Gall', businessName: 'Renamed Kiosk', taxId: 'PL9999999999' }, headers: auth(rt) })

  const [receiptAfter] = await db.select().from(receipt).where(eq(receipt.transactionId, tx.id))
  const snapshotAfter = receiptAfter.snapshotJson as { receiverBusinessName: string; receiverTaxId: string }
  expect(snapshotAfter.receiverBusinessName).toBe('Corner Kiosk')
  expect(snapshotAfter.receiverTaxId).toBe('PL1234567890')
})

it('GET /v1/me requires auth', async () => {
  const r = await app.inject({ url: '/v1/me' })
  expect(r.statusCode).toBe(401)
})

it('login issues a refresh token; refresh rotates it and returns a fresh JWT', async () => {
  const addr = `NQ42 ${crypto.randomUUID().slice(0, 8)}`
  const rApp = authedApp(db, addr)
  const c = (await rApp.app.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  const v = await rApp.app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce: c.nonce, publicKey: 'aa'.repeat(32), signature: 'bb'.repeat(64) } })
  expect(v.statusCode).toBe(200)
  const { token, refreshToken } = v.json()
  expect(refreshToken).toBeTruthy()

  const r1 = await rApp.app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken } })
  expect(r1.statusCode).toBe(200)
  const next = r1.json()
  expect(next.token).toBeTruthy()
  expect(next.refreshToken).not.toBe(refreshToken)
  // new JWT works against an authenticated route
  const me = await rApp.app.inject({ url: '/v1/me',
    headers: { authorization: `Bearer ${next.token}` } })
  expect(me.statusCode).toBe(200)
  // rotation: the consumed refresh token is dead
  const r2 = await rApp.app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken } })
  expect(r2.statusCode).toBe(401)
  void token
})

it('POST /v1/auth/refresh rejects an unknown refresh token', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken: 'ff'.repeat(32) } })
  expect(r.statusCode).toBe(401)
})
