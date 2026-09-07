import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { chainTransaction, charge, paymentSession, receipt } from '../src/db/schema'
import { SessionEvents } from '../src/services/events'
import { monitorTick, startMonitor } from '../src/services/monitor'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

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

it('two overlapping monitorTick runs on the same transaction write exactly two receipts', async () => {
  const { tx } = await submittedTx()
  const events = new SessionEvents()
  // Both ticks see the tx already macro-included, and getTransaction stalls
  // long enough that neither tick's status update lands before the other
  // reads the pending set — the race the receipt unique index resolves.
  const chain = { ...noRecon,
    getTransaction: async () => {
      await new Promise(r => setTimeout(r, 20))
      return { includedAtHeight: 100, expired: false }
    },
    getLastMacroHeight: async () => 100,
  }
  await Promise.all([monitorTick(db, events, chain), monitorTick(db, events, chain)])
  expect(await db.select().from(receipt).where(eq(receipt.transactionId, tx.id))).toHaveLength(2)
  expect((await db.select().from(chainTransaction).where(eq(chainTransaction.id, tx.id)))[0].status)
    .toBe('CONFIRMED')
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

it('history lists an in-flight payment as pending before the receipt exists', async () => {
  const { app, tokenFor } = authedApp(db)
  const payer = await makeUser(db, `NQ50 ${crypto.randomUUID().slice(0, 8)}`)
  const receiver = await makeUser(db, `NQ51 ${crypto.randomUUID().slice(0, 8)}`)
  const [s] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: 'x',
    status: 'CONFIRMING', expiresAt: new Date(),
  }).returning()
  const [c] = await db.insert(charge).values({
    sessionId: s.id, amountAtomic: 250000n, recipientAddress: receiver.walletAddress,
  }).returning()
  await db.insert(chainTransaction).values({
    chargeId: c.id, sender: payer.walletAddress, recipient: receiver.walletAddress,
    amountAtomic: 250000n, hash: 'ff'.repeat(32), status: 'CONFIRMING',
  })
  const r = await app.inject({ url: '/v1/history',
    headers: { authorization: `Bearer ${await tokenFor(payer)}` } })
  const item = r.json().items[0]
  expect(item.pending).toBe(true)
  expect(item.sessionId).toBe(s.id)
  expect(item.role).toBe('payer')
  expect(item.snapshot.amountNim).toBe('2.5')
})

it('startMonitor skips a tick that would overlap a still-running one', async () => {
  await submittedTx() // gives the tick a pending row so it calls into chain
  let inFlight = 0
  let concurrentCalls = 0
  let calls = 0
  const chain = { ...noRecon,
    getTransaction: async () => ({ includedAtHeight: null, expired: false }),
    getLastMacroHeight: async () => {
      calls++
      inFlight++
      if (inFlight > 1) concurrentCalls++
      // Longer than the timer interval below, so without the reentrancy
      // guard the next tick's timer fire would start a second run while
      // this one is still awaiting.
      await new Promise(r => setTimeout(r, 60))
      inFlight--
      return 0
    },
  }
  const stop = startMonitor(db, new SessionEvents(), chain, 15)
  await new Promise(r => setTimeout(r, 200))
  stop()
  expect(concurrentCalls).toBe(0)
  expect(calls).toBeGreaterThan(1) // the guard skips overlaps, it doesn't stall the monitor
})
