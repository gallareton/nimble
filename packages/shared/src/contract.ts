import { z } from 'zod'
import type { SessionStatus } from './states'

export const LunaString = z.string().regex(/^\d+$/, 'integer luna string')
export const PositiveLunaString = LunaString.refine(s => BigInt(s) > 0n, 'must be positive')

// The MVP settles in USD only — quoteUsdPerNim never resolves any other
// currency, so a request naming one would be silently priced at the wrong
// rate. Reject it at the schema, not by hand-checking it in the route: this
// number lands in the shift export, and the Merchant API exposes the same
// surface to third parties.
export const SUPPORTED_FIAT_CURRENCY = 'USD' as const
const FiatCurrency = z.literal(SUPPORTED_FIAT_CURRENCY)

// BLIK-style: the receiver knows the amount before asking for the code, so
// claim carries the charge — the payer gets the approval prompt immediately.
// Pricing is optional (an unpriced claim is the payer-initiated flow) and,
// when present, is either luna or fiat minor units — never both.
export const ClaimRequest = z.object({
  code: z.string().regex(/^\d{6}$/),
  amountLuna: PositiveLunaString.optional(),
  fiatAmountMinor: z.number().int().positive().optional(),
  fiatCurrency: FiatCurrency.optional(),
  reference: z.string().max(100).optional(),
}).refine(
  b => b.amountLuna === undefined || b.fiatAmountMinor === undefined,
  'cannot set both amountLuna and fiatAmountMinor',
).refine(
  b => (b.fiatAmountMinor === undefined) === (b.fiatCurrency === undefined),
  'fiatCurrency is required with fiatAmountMinor',
)
/** A charge is priced either directly in luna, or in fiat minor units which the
 *  server converts with a quote it then stores. Exactly one of the two. */
export const CreateChargeRequest = z.object({
  amountLuna: PositiveLunaString.optional(),
  fiatAmountMinor: z.number().int().positive().optional(),
  fiatCurrency: FiatCurrency.optional(),
  reference: z.string().max(100).optional(),
}).refine(
  b => (b.amountLuna === undefined) !== (b.fiatAmountMinor === undefined),
  'provide either amountLuna or fiatAmountMinor',
).refine(
  b => b.fiatAmountMinor === undefined || b.fiatCurrency !== undefined,
  'fiatCurrency is required with fiatAmountMinor',
)
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
