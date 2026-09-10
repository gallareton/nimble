import type { Db } from '../db/client'
import { charge } from '../db/schema'

export type FrozenQuote = {
  fiatAmountMinor?: number | null
  fiatCurrency?: string | null
  fxRate?: string | null
  fxRateAt?: Date | null
  fxSource?: string | null
}

export type InsertChargeParams = FrozenQuote & {
  sessionId: string
  amountAtomic: bigint
  reference?: string | null
  recipientAddress: string
  shiftId?: string | null
  // Set only when this charge settles a POS sale (the NIM path) — lets a
  // sale's report join straight to its charge. See db/schema.ts on `charge`.
  saleId?: string | null
}

/**
 * Inserts the one `charge` row a sale produces, however the sale was priced
 * (fiat-quoted at the register, or claimed with an amount already attached).
 * Deliberately does nothing but the insert: the state transition on
 * `payment_session` and the shift lookup stay in each caller's own
 * transaction, since those differ by call site (a conditional UPDATE guarding
 * against a closed window, `openShiftFor`, etc).
 */
export async function insertCharge(tx: Db, params: InsertChargeParams) {
  const [c] = await tx.insert(charge).values({
    sessionId: params.sessionId,
    amountAtomic: params.amountAtomic,
    shiftId: params.shiftId ?? null,
    fiatAmountMinor: params.fiatAmountMinor ?? null,
    fiatCurrency: params.fiatCurrency ?? null,
    fxRate: params.fxRate ?? null,
    fxRateAt: params.fxRateAt ?? null,
    fxSource: params.fxSource ?? null,
    recipientAddress: params.recipientAddress,
    reference: params.reference ?? null,
    saleId: params.saleId ?? null,
  }).returning()
  return c
}
