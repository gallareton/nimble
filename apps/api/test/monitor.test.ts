import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { chainTransaction, charge, paymentSession, receipt } from '../src/db/schema'
import { SessionEvents } from '../src/services/events'
import { monitorTick } from '../src/services/monitor'
import { freshDb } from './helpers/db'
import { makeUser } from './helpers/actors'

const { db, close } = await freshDb()
afterAll(close)

async function submittedTx() {
  const p = await makeUser(db, `NQ70 ${crypto.randomUUID().slice(0, 8)}`)
  const r = await makeUser(db, `NQ71 ${crypto.randomUUID().slice(0, 8)}`)
  const [s] = await db.insert(paymentSession).values({ payerUserId: p.id, receiverUserId: r.id,
    codeHash: 'h', status: 'SUBMITTED', expiresAt: new Date() }).returning()
  const [c] = await db.insert(charge).values({ sessionId: s.id, amountAtomic: 250_000n,
    recipientAddress: r.walletAddress, reconciliationToken: crypto.randomUUID().replaceAll('-', '') }).returning()
  const [tx] = await db.insert(chainTransaction).values({ chargeId: c.id, sender: p.walletAddress,
    recipient: r.walletAddress, amountAtomic: 250_000n, hash: crypto.randomUUID() }).returning()
  return { s, c, tx }
}

const noRecon = { findIncomingByData: async () => null }

it('SUBMITTED → CONFIRMING on inclusion → CONFIRMED after macro block, receipts written', async () => {
  const { s, tx } = await submittedTx()
  const events = new SessionEvents()
  let macro = 90
  const chain = { ...noRecon,
    getTransaction: async () => ({ includedAtHeight: 100, expired: false }),
    getLastMacroHeight: async () => macro,
  }
  await monitorTick(db, events, chain)
  expect((await db.select().from(chainTransaction).where(eq(chainTransaction.id, tx.id)))[0].status).toBe('CONFIRMING')

  macro = 120
  await monitorTick(db, events, chain)
  const [txRow] = await db.select().from(chainTransaction).where(eq(chainTransaction.id, tx.id))
  expect(txRow.status).toBe('CONFIRMED')
  expect(txRow.confirmedAt).toBeTruthy()
  expect((await db.select().from(paymentSession).where(eq(paymentSession.id, s.id)))[0].status).toBe('CONFIRMED')
  expect(await db.select().from(receipt).where(eq(receipt.transactionId, tx.id))).toHaveLength(2)
  await monitorTick(db, events, chain) // idempotent: no duplicate receipts
  expect(await db.select().from(receipt).where(eq(receipt.transactionId, tx.id))).toHaveLength(2)
})

it('expired transaction → FAILED', async () => {
  const { tx } = await submittedTx()
  const chain = { ...noRecon,
    getTransaction: async () => ({ includedAtHeight: null, expired: true }),
    getLastMacroHeight: async () => 0 }
  await monitorTick(db, new SessionEvents(), chain)
  expect((await db.select().from(chainTransaction).where(eq(chainTransaction.id, tx.id)))[0].status).toBe('FAILED')
})

it('long-pending transaction → DELAYED, not FAILED', async () => {
  const { tx } = await submittedTx()
  await db.update(chainTransaction).set({ submittedAt: new Date(Date.now() - 300_000) })
    .where(eq(chainTransaction.id, tx.id))
  const chain = { ...noRecon, getTransaction: async () => null, getLastMacroHeight: async () => 0 }
  await monitorTick(db, new SessionEvents(), chain, { delayedAfterMs: 120_000 })
  expect((await db.select().from(chainTransaction).where(eq(chainTransaction.id, tx.id)))[0].status).toBe('DELAYED')
})

it('reconciles a lost hash by recipient + data token', async () => {
  const p = await makeUser(db, `NQ72 ${crypto.randomUUID().slice(0, 8)}`)
  const r = await makeUser(db, `NQ73 ${crypto.randomUUID().slice(0, 8)}`)
  const token = crypto.randomUUID().replaceAll('-', '')
  const [s] = await db.insert(paymentSession).values({ payerUserId: p.id, receiverUserId: r.id,
    codeHash: 'h', status: 'AWAITING_WALLET_AUTH', expiresAt: new Date() }).returning()
  await db.insert(charge).values({ sessionId: s.id, amountAtomic: 250_000n,
    recipientAddress: r.walletAddress, reconciliationToken: token })
  const chain = {
    getTransaction: async () => null,
    getLastMacroHeight: async () => 0,
    findIncomingByData: async (recipient: string, dataHex: string) =>
      recipient === r.walletAddress && dataHex === token ? { hash: 'recovered-hash' } : null,
  }
  await monitorTick(db, new SessionEvents(), chain)
  const [after] = await db.select().from(paymentSession).where(eq(paymentSession.id, s.id))
  expect(after.status).toBe('SUBMITTED')
  const txs = await db.select().from(chainTransaction).where(eq(chainTransaction.hash, 'recovered-hash'))
  expect(txs).toHaveLength(1)
  expect(txs[0].sender).toBe(p.walletAddress)
})
