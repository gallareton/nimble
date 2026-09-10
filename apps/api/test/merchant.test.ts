import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { apiKey, chainTransaction, charge, claimAttempt, paymentSession, userProfile } from '../src/db/schema'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
app.deps.rates = {
  getUsdPerNim: async () => 0.005,
  quoteUsdPerNim: async () => ({ value: 0.005, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = (t: string) => ({ authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() })
const withKey = (k: string) => ({ 'x-api-key': k })
const withKeyIdem = (k: string) => ({ 'x-api-key': k, 'idempotency-key': crypto.randomUUID() })

async function vendor() {
  const u = await makeUser(db, `NQ92 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}

const issueApiKey = (t: string, label = 'POS integration') =>
  app.inject({ method: 'POST', url: '/v1/me/api-keys', payload: { label }, headers: idem(t) })
const listApiKeys = (t: string) => app.inject({ url: '/v1/me/api-keys', headers: auth(t) })
const revokeApiKey = (t: string, id: string) =>
  app.inject({ method: 'DELETE', url: `/v1/me/api-keys/${id}`, headers: auth(t) })

async function issuedKey(t: string) {
  const res = await issueApiKey(t)
  return res.json() as { id: string; label: string; key: string; createdAt: string }
}

const createMerchantCharge = (k: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/merchant/charge-requests', payload, headers: withKeyIdem(k) })
const getMerchantCharge = (k: string, id: string) =>
  app.inject({ url: `/v1/merchant/charge-requests/${id}`, headers: withKey(k) })
const searchMerchantCharges = (k: string, externalRef: string) =>
  app.inject({ url: `/v1/merchant/charge-requests?externalRef=${encodeURIComponent(externalRef)}`, headers: withKey(k) })

/** Drives a payment session straight to CONFIRMED, mirroring sales.test.ts /
 *  refund.test.ts — these tests care about how the merchant view reacts to a
 *  session outcome, not the signing flow that produces it. */
async function confirmSession(sessionId: string, txHash: string = crypto.randomUUID()) {
  await db.update(paymentSession).set({ status: 'CONFIRMED' }).where(eq(paymentSession.id, sessionId))
  const [c] = await db.select().from(charge).where(eq(charge.sessionId, sessionId))
  const confirmedAt = new Date()
  await db.insert(chainTransaction).values({
    chargeId: c.id, sender: 'NQ99 payer', recipient: c.recipientAddress,
    amountAtomic: c.amountAtomic, hash: txHash, status: 'CONFIRMED', confirmedAt,
  })
  return confirmedAt
}

it('issuing an api key returns the plaintext once, and only the hash reaches the database', async () => {
  const { t } = await vendor()
  const res = await issueApiKey(t, 'Register 1')
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.key).toMatch(/^nmbl_[0-9a-f]{64}$/)
  expect(body.label).toBe('Register 1')
  expect(body.id).toBeTruthy()

  const [row] = await db.select().from(apiKey).where(eq(apiKey.id, body.id))
  expect(row.keyHash).not.toBe(body.key)
  expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/)

  const list = await listApiKeys(t)
  expect(list.statusCode).toBe(200)
  const labels = list.json()
  expect(labels).toEqual([{ id: body.id, label: 'Register 1', createdAt: body.createdAt, revokedAt: null }])
  expect(JSON.stringify(labels)).not.toContain(body.key)
})

it('a merchant request creates a charge request owned by the key holder, with a shareable url', async () => {
  const { t } = await vendor()
  const key = await issuedKey(t)

  const res = await createMerchantCharge(key.key, { fiatAmountMinor: 500, fiatCurrency: 'USD', externalRef: 'order-42' })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.externalRef).toBe('order-42')
  expect(body.state).toBe('open')
  expect(body.url).toContain(`/r/${body.id}`)
  expect(body.url).toContain('?n=')

  const [row] = await db.select().from(paymentSession) // sanity: no session yet
  expect(row).toBeUndefined()
})

it('a revoked, missing, or bogus api key is rejected with 401', async () => {
  const { t } = await vendor()
  const key = await issuedKey(t)
  await revokeApiKey(t, key.id)

  const revoked = await createMerchantCharge(key.key, { fiatAmountMinor: 500, fiatCurrency: 'USD' })
  expect(revoked.statusCode).toBe(401)

  const missing = await app.inject({ method: 'POST', url: '/v1/merchant/charge-requests',
    payload: { fiatAmountMinor: 500, fiatCurrency: 'USD' }, headers: { 'idempotency-key': crypto.randomUUID() } })
  expect(missing.statusCode).toBe(401)

  const bogus = await createMerchantCharge('nmbl_deadbeef', { fiatAmountMinor: 500, fiatCurrency: 'USD' })
  expect(bogus.statusCode).toBe(401)
})

it('one merchant cannot read another merchant\'s charge request', async () => {
  const { t: t1 } = await vendor()
  const { t: t2 } = await vendor()
  const key1 = await issuedKey(t1)
  const key2 = await issuedKey(t2)

  const created = await createMerchantCharge(key1.key, { fiatAmountMinor: 500, fiatCurrency: 'USD' })
  const { id } = created.json()

  const asOwner = await getMerchantCharge(key1.key, id)
  expect(asOwner.statusCode).toBe(200)
  const asStranger = await getMerchantCharge(key2.key, id)
  expect(asStranger.statusCode).toBe(404)
})

it('externalRef search returns only the caller\'s own matching bills', async () => {
  const { t: t1 } = await vendor()
  const { t: t2 } = await vendor()
  const key1 = await issuedKey(t1)
  const key2 = await issuedKey(t2)

  await createMerchantCharge(key1.key, { fiatAmountMinor: 100, fiatCurrency: 'USD', externalRef: 'shared-ref' })
  await createMerchantCharge(key2.key, { fiatAmountMinor: 200, fiatCurrency: 'USD', externalRef: 'shared-ref' })
  await createMerchantCharge(key1.key, { fiatAmountMinor: 300, fiatCurrency: 'USD', externalRef: 'other-ref' })

  const found = await searchMerchantCharges(key1.key, 'shared-ref')
  expect(found.statusCode).toBe(200)
  const rows = found.json()
  expect(rows).toHaveLength(1)
  expect(rows[0].externalRef).toBe('shared-ref')
  expect(rows[0].fiatAmountMinor).toBe(100)
})

it('state reaches paid on acceptance, but payment.sessionStatus is CONFIRMED only once the transaction confirms', async () => {
  const { t } = await vendor()
  const key = await issuedKey(t)
  const { id } = (await createMerchantCharge(key.key, { fiatAmountMinor: 500, fiatCurrency: 'USD' })).json()

  const payer = await makeUser(db, `NQ93 ${crypto.randomUUID().slice(0, 8)}`)
  const payerToken = await tokenFor(payer)
  const accept = await app.inject({ method: 'POST', url: `/v1/charge-requests/${id}/accept`,
    headers: { authorization: `Bearer ${payerToken}`, 'idempotency-key': crypto.randomUUID() } })
  expect(accept.statusCode).toBe(201)
  const { sessionId } = accept.json()

  const beforeConfirm = await getMerchantCharge(key.key, id)
  const beforeBody = beforeConfirm.json()
  expect(beforeBody.state).toBe('paid')
  expect(beforeBody.payment.sessionStatus).not.toBe('CONFIRMED')

  await confirmSession(sessionId, 'tx-hash-1')
  const afterConfirm = await getMerchantCharge(key.key, id)
  const afterBody = afterConfirm.json()
  expect(afterBody.state).toBe('paid')
  expect(afterBody.payment.sessionStatus).toBe('CONFIRMED')
  expect(afterBody.payment.txHash).toBe('tx-hash-1')
  expect(afterBody.payment.confirmedAt).not.toBeNull()
})

it('issuing an api key is refused while the cashier lock is active', async () => {
  const { u, t } = await vendor()
  await db.update(userProfile).set({ cashierPinHash: 'x', cashierLocked: true }).where(eq(userProfile.id, u.id))
  const res = await issueApiKey(t)
  expect(res.statusCode).toBe(423)
})

it('the api key rate limit counter is separate from the code-claim counter', async () => {
  const { t } = await vendor()
  const key = await issuedKey(t)

  // Burn through a chunk of the api-key budget.
  for (let i = 0; i < 5; i++)
    await createMerchantCharge(key.key, { fiatAmountMinor: 100, fiatCurrency: 'USD' })

  const apiKeyAttempts = await db.select().from(claimAttempt).where(eq(claimAttempt.subjectType, 'api-key'))
  expect(apiKeyAttempts.length).toBeGreaterThanOrEqual(5)

  // Code-claim's own counters (wallet/ip) must be untouched by api-key traffic.
  const claimAttempts = await db.select().from(claimAttempt).where(eq(claimAttempt.subjectType, 'wallet'))
  expect(claimAttempts.length).toBe(0)
})
