import { and, eq, inArray } from 'drizzle-orm'
import { lunaToNim } from '@nimblink/shared'
import { chainTransaction, charge, paymentSession, receipt, userProfile } from '../db/schema'
import type { Db } from '../db/client'
import type { SessionEvents } from './events'

export interface ChainClient {
  getTransaction(hash: string): Promise<null | { includedAtHeight: number | null; expired: boolean }>
  getLastMacroHeight(): Promise<number>
  // Reconciliation (design §6, lost-hash mitigation b): find an incoming
  // transaction to `recipient` carrying `dataHex` in its data field.
  findIncomingByData(recipient: string, dataHex: string): Promise<{ hash: string } | null>
}

async function setStatus(db: Db, events: SessionEvents, tx: typeof chainTransaction.$inferSelect,
  sessionId: string, from: string, to: string, meta?: object) {
  await db.update(chainTransaction)
    .set({ status: to, ...(to === 'CONFIRMED' ? { confirmedAt: new Date() } : {}) })
    .where(eq(chainTransaction.id, tx.id))
  await db.update(paymentSession).set({ status: to }).where(eq(paymentSession.id, sessionId))
  await events.publish(db, { sessionId, eventType: `TX_${to}`, actorType: 'system',
    stateFrom: from, stateTo: to, safeMetadata: meta })
}

export async function monitorTick(db: Db, events: SessionEvents, chain: ChainClient,
  opts: { delayedAfterMs?: number } = {}): Promise<void> {
  const delayedAfterMs = opts.delayedAfterMs ?? 120_000

  // Reconciliation pass: payer approved (token issued) but hash never
  // registered — match the on-chain transfer by recipient + data token.
  const awaiting = await db.select().from(paymentSession)
    .where(eq(paymentSession.status, 'AWAITING_WALLET_AUTH'))
  for (const s of awaiting) {
    const [c] = await db.select().from(charge).where(eq(charge.sessionId, s.id))
    if (!c?.reconciliationToken) continue
    const found = await chain.findIncomingByData(c.recipientAddress, c.reconciliationToken)
    if (!found) continue
    try {
      await db.transaction(async tx => {
        const [locked] = await tx.update(paymentSession).set({ status: 'SUBMITTED' })
          .where(and(eq(paymentSession.id, s.id), eq(paymentSession.status, 'AWAITING_WALLET_AUTH'))).returning()
        if (!locked) return
        const [payer] = await tx.select().from(userProfile).where(eq(userProfile.id, s.payerUserId))
        await tx.insert(chainTransaction).values({
          chargeId: c.id, sender: payer.walletAddress, recipient: c.recipientAddress,
          amountAtomic: c.amountAtomic, hash: found.hash, status: 'SUBMITTED',
        })
      })
      await events.publish(db, { sessionId: s.id, eventType: 'TX_RECONCILED', actorType: 'system',
        stateFrom: 'AWAITING_WALLET_AUTH', stateTo: 'SUBMITTED', safeMetadata: { hash: found.hash } })
    } catch { /* unique network+hash race: client registered it concurrently — fine */ }
  }

  const pending = await db.select().from(chainTransaction)
    .where(inArray(chainTransaction.status, ['SUBMITTED', 'CONFIRMING', 'DELAYED']))
  if (pending.length === 0) return
  const lastMacro = await chain.getLastMacroHeight()

  for (const tx of pending) {
    const [c] = await db.select().from(charge).where(eq(charge.id, tx.chargeId))
    const info = await chain.getTransaction(tx.hash)

    if (!info || info.includedAtHeight == null) {
      if (info?.expired) {
        await setStatus(db, events, tx, c.sessionId, tx.status, 'FAILED', { reason: 'expired' })
        continue
      }
      if (tx.status === 'SUBMITTED' && Date.now() - tx.submittedAt.getTime() > delayedAfterMs)
        await setStatus(db, events, tx, c.sessionId, tx.status, 'DELAYED')
      continue
    }

    if (lastMacro >= info.includedAtHeight) {
      await setStatus(db, events, tx, c.sessionId, tx.status, 'CONFIRMED', { hash: tx.hash })
      const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, c.sessionId))
      const snapshot = {
        amountLuna: tx.amountAtomic.toString(), amountNim: lunaToNim(tx.amountAtomic),
        asset: 'NIM', network: 'nimiq', hash: tx.hash, sender: tx.sender, recipient: tx.recipient,
        reference: c.reference, confirmedAt: new Date().toISOString(),
      }
      await db.insert(receipt).values([
        { transactionId: tx.id, ownerUserId: s.payerUserId, role: 'payer', snapshotJson: snapshot },
        { transactionId: tx.id, ownerUserId: s.receiverUserId!, role: 'receiver', snapshotJson: snapshot },
      ])
    } else if (tx.status !== 'CONFIRMING') {
      await setStatus(db, events, tx, c.sessionId, tx.status, 'CONFIRMING')
    }
  }
}

export function startMonitor(db: Db, events: SessionEvents, chain: ChainClient, intervalMs = 3000) {
  const h = setInterval(() => { void monitorTick(db, events, chain).catch(() => {}) }, intervalMs)
  return () => clearInterval(h)
}
