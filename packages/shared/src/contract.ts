import { z } from 'zod'
import type { SessionStatus } from './states'

export const LunaString = z.string().regex(/^\d+$/, 'integer luna string')
export const PositiveLunaString = LunaString.refine(s => BigInt(s) > 0n, 'must be positive')

// BLIK-style: the receiver knows the amount before asking for the code, so
// claim carries the charge — the payer gets the approval prompt immediately.
export const ClaimRequest = z.object({
  code: z.string().regex(/^\d{6}$/),
  amountLuna: PositiveLunaString.optional(),
  reference: z.string().max(100).optional(),
})
export const CreateChargeRequest = z.object({
  amountLuna: PositiveLunaString,
  reference: z.string().max(100).optional(),
})
export const RegisterTxRequest = z.object({ hash: z.string().min(16).max(128) })
export const AuthChallengeResponse = z.object({ nonce: z.string(), message: z.string() })
export const AuthVerifyRequest = z.object({
  nonce: z.string(), publicKey: z.string(), signature: z.string(),
})

export interface SessionView {
  sessionId: string; status: SessionStatus; role: 'payer' | 'receiver'
  expiresAt: string; chargeDeadlineAt?: string
  counterpart?: { displayName: string; verificationStatus: 'unverified'; addressTail: string }
  charge?: { chargeId: string; version: number; amountLuna: string; asset: 'NIM'
             network: 'nimiq'; reference: string | null; recipientAddress: string }
  transaction?: { hash: string; status: SessionStatus; confirmations: number }
}
export interface CreateSessionResponse { sessionId: string; code: string; expiresAt: string }
export interface ClaimResponse { sessionId: string; chargeId?: string }
export interface IntentResponse {
  reconciliationToken: string; recipientAddress: string; amountLuna: string; validUntil: string
}
export interface ErrorBody { error: { code: string; message: string } }

export type ClaimRequestT = z.infer<typeof ClaimRequest>
export type CreateChargeRequestT = z.infer<typeof CreateChargeRequest>

export const OpenShiftRequest = z.object({ operatorLabel: z.string().min(1).max(60) })

export interface ShiftView {
  id: string; operatorLabel: string; openedAt: string; closedAt: string | null
}

/** One sale as it appears in a shift report and its export. */
export interface ShiftEntry {
  localNumber: number
  occurredAt: string
  status: SessionStatus
  amountNim: string
  asset: string
  network: string
  hash: string | null
  reference: string | null
  amountFiatMinor: number | null
  fiatCurrency: string | null
  fxRate: string | null
  fxRateAt: string | null
  fxSource: string | null
}

export interface ShiftReport {
  shift: ShiftView
  totals: {
    count: number; confirmed: number; failed: number
    grossNim: string
    grossFiatMinor: number | null
    fiatCurrency: string | null
    averageTicketNim: string | null
  }
  entries: ShiftEntry[]
  /** True when a sale had no fiat price, so the fiat total covers only part of the day. */
  fiatIncomplete: boolean
}

export type OpenShiftRequestT = z.infer<typeof OpenShiftRequest>
