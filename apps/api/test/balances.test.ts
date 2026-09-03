import { expect, it, vi, afterAll } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import type { BalanceReader } from '../src/services/balances'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

function readerReturning(balance: bigint | null): BalanceReader {
  return { getBalanceLuna: vi.fn(async () => balance) }
}

async function pairedChargedSession(balances: BalanceReader, amountLuna = '250000') {
  app.deps.balances = balances
  const payer = await makeUser(db, `NQ50 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ51 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const chargeRes = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna, reference: 'Coffee' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const { chargeId } = chargeRes.json()
  return { payer, receiver, pt, rt, sessionId, chargeId }
}

const getAffordability = (chargeId: string, token: string) =>
  app.inject({ url: `/v1/charges/${chargeId}/affordability`, headers: { authorization: `Bearer ${token}` } })

it('balance covers the charge: sufficient true, no shortfall', async () => {
  const { chargeId, pt } = await pairedChargedSession(readerReturning(1_000_000n), '250000')
  const res = await getAffordability(chargeId, pt)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sufficient: true, shortfallLuna: null })
})

it('balance is short: sufficient false with the exact shortfall', async () => {
  const { chargeId, pt } = await pairedChargedSession(readerReturning(100_000n), '250000')
  const res = await getAffordability(chargeId, pt)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sufficient: false, shortfallLuna: '150000' })
})

it('unreadable balance: sufficient null, always 200, never a 5xx', async () => {
  const { chargeId, pt } = await pairedChargedSession(readerReturning(null), '250000')
  const res = await getAffordability(chargeId, pt)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sufficient: null, shortfallLuna: null })
})

it('missing balances dependency behaves as unknown, not an error', async () => {
  app.deps.balances = undefined
  const payer = await makeUser(db, `NQ52 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ53 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer); const rt = await tokenFor(receiver)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const chargeRes = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna: '250000', reference: 'Tea' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const res = await getAffordability(chargeRes.json().chargeId, pt)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sufficient: null, shortfallLuna: null })
})

it('the receiver asking for the payer balance gets 403', async () => {
  const { chargeId, rt } = await pairedChargedSession(readerReturning(1_000_000n))
  const res = await getAffordability(chargeId, rt)
  expect(res.statusCode).toBe(403)
})

it('a stranger asking for someone else\'s charge gets 404', async () => {
  const { chargeId } = await pairedChargedSession(readerReturning(1_000_000n))
  const stranger = await makeUser(db, `NQ54 ${crypto.randomUUID().slice(0, 8)}`)
  const st = await tokenFor(stranger)
  const res = await getAffordability(chargeId, st)
  expect(res.statusCode).toBe(404)
})
