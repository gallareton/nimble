import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

async function chargedSession() {
  const payer = await makeUser(db, `NQ40 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ41 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const { chargeId } = (await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna: '250000', reference: 'Soda' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  return { pt, rt, sessionId, chargeId }
}
const post = (url: string, t: string, payload?: object) =>
  app.inject({ method: 'POST', url, payload,
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

it('payer rejects → REJECTED; receiver cannot reject', async () => {
  const { pt, rt, chargeId } = await chargedSession()
  expect((await post(`/v1/charges/${chargeId}/reject`, rt)).statusCode).toBe(403)
  const r = await post(`/v1/charges/${chargeId}/reject`, pt)
  expect(r.json().status).toBe('REJECTED')
})

it('receiver cancels before intent, but NOT after intent', async () => {
  const a = await chargedSession()
  expect((await post(`/v1/sessions/${a.sessionId}/cancel`, a.rt)).json().status).toBe('CANCELLED')
  const b = await chargedSession()
  await post(`/v1/charges/${b.chargeId}/intent`, b.pt)
  expect((await post(`/v1/sessions/${b.sessionId}/cancel`, b.rt)).statusCode).toBe(409)
})

it('intent → register hash → SUBMITTED; duplicate hash 409; hash on other charge 409', async () => {
  const { pt, sessionId, chargeId } = await chargedSession()
  const intent = (await post(`/v1/charges/${chargeId}/intent`, pt)).json()
  expect(intent.reconciliationToken).toMatch(/^[0-9a-f]{32}$/)
  expect(intent.amountLuna).toBe('250000')

  const reg = await post(`/v1/charges/${chargeId}/transactions`, pt, { hash: 'a'.repeat(64) })
  expect(reg.statusCode).toBe(201)
  const view = (await app.inject({ url: `/v1/sessions/${sessionId}`,
    headers: { authorization: `Bearer ${pt}` } })).json()
  expect(view.status).toBe('SUBMITTED')
  expect(view.transaction.hash).toBe('a'.repeat(64))

  const other = await chargedSession()
  await post(`/v1/charges/${other.chargeId}/intent`, other.pt)
  const dup = await post(`/v1/charges/${other.chargeId}/transactions`, other.pt, { hash: 'a'.repeat(64) })
  expect(dup.statusCode).toBe(409)
})

it('cannot register hash without intent', async () => {
  const { pt, chargeId } = await chargedSession()
  expect((await post(`/v1/charges/${chargeId}/transactions`, pt, { hash: 'b'.repeat(64) })).statusCode).toBe(409)
})
