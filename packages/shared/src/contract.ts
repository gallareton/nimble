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
/** A remote charge: the receiver bills a payer who isn't at the counter.
 *  Same pricing shape as CreateChargeRequest — either luna direct or fiat
 *  minor units the server converts and freezes with a quote. */
export const CreateChargeRequestRequest = z.object({
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

/** null means the payer's balance could not be read (RPC unreachable, slow,
 *  or malformed) — advisory only, never a reason to block the payment. */
export interface AffordabilityResponse {
  sufficient: boolean | null
  shortfallLuna: string | null
}

export type ClaimRequestT = z.infer<typeof ClaimRequest>
export type CreateChargeRequestT = z.infer<typeof CreateChargeRequest>
export type CreateChargeRequestRequestT = z.infer<typeof CreateChargeRequestRequest>

export interface CreateChargeRequestResponse { id: string; expiresAt: string }

/** What an unauthenticated payer sees when previewing a remote-charge link.
 *  Deliberately excludes anything internal (ids, full address) — see the
 *  route's own comment for why its failure modes are distinguishable, unlike
 *  the six-digit code-claim flow's uniform generic error. */
export interface ChargeRequestPreview {
  amountLuna: string
  fiatAmountMinor: number | null
  fiatCurrency: string | null
  reference: string | null
  receiverDisplayName: string
  receiverAddressTail: string
  expiresAt: string
  state: 'open' | 'expired' | 'paid'
}
export interface AcceptChargeRequestResponse { sessionId: string; chargeId: string }

/** Bills this vendor has issued that nobody has paid yet and that have not
 *  expired. Vendor-scoped, not shift-scoped: a bill can outlive the shift it
 *  was raised in, which is exactly why closing one warrants a warning. */
export interface OutstandingBill {
  id: string
  amountLuna: string
  fiatAmountMinor: number | null
  fiatCurrency: string | null
  reference: string | null
  expiresAt: string
}
export interface OutstandingBillsResponse { bills: OutstandingBill[] }

/** A refund is a transfer back to the customer, not a reversal — amountLuna
 *  omitted means a full refund of whatever remains refundable on the charge.
 *  reason mirrors CreateChargeRequest.reference: same shape, same limit. */
export const CreateRefundRequest = z.object({
  amountLuna: PositiveLunaString.optional(),
  reason: z.string().max(100).optional(),
})
export type CreateRefundRequestT = z.infer<typeof CreateRefundRequest>
export interface CreateRefundResponse { refundId: string; sessionId: string; chargeId: string }

export const OpenShiftRequest = z.object({ operatorLabel: z.string().min(1).max(60) })

// Cashier lock (BR-P09): a PIN, 4-8 digits, shared by the set/change and
// unlock routes. currentPin is required only when a PIN already exists —
// that's state the route knows, not the schema, so it's optional here.
const CashierPin = z.string().regex(/^\d{4,8}$/, '4 to 8 digits')
export const SetCashierPinRequest = z.object({ pin: CashierPin, currentPin: CashierPin.optional() })
export const CashierUnlockRequest = z.object({ pin: CashierPin })
export type SetCashierPinRequestT = z.infer<typeof SetCashierPinRequest>
export type CashierUnlockRequestT = z.infer<typeof CashierUnlockRequest>

export interface ShiftView {
  id: string; operatorLabel: string; openedAt: string; closedAt: string | null
}

/**
 * One sale — or one refund — as it appears in a shift report and its export.
 * A refund is a charge like any other, distinguished only by amountNim being
 * negative and refundOf* pointing back at the sale it refunds.
 */
export interface ShiftEntry {
  /** The underlying charge's id — needed by the client to call POST
   *  /v1/charges/:id/refunds against this entry. Added additively for
   *  Task 4 (refund-from-report): nothing else in the shape changed. */
  chargeId: string
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
  /** For a refund: the original sale's localNumber, when that sale is in this same report. Null for a sale, and null for a refund whose sale is in a different (or no) report. */
  refundOfLocalNumber: number | null
  /** For a refund: when the original sale happened, always filled — the sale may be in a different, long-closed shift. Null for a sale. */
  refundOfOccurredAt: string | null
}

/** One row of a vendor's shift history: enough to list without a full report per row. */
export interface ShiftListItem extends ShiftView {
  grossNim: string
  confirmed: number
}

export interface ShiftReport {
  shift: ShiftView
  totals: {
    count: number; confirmed: number; refunded: number; failed: number
    /** Sales minus confirmed refunds — may go negative if a refund lands in a later shift than its sale. */
    grossNim: string
    grossFiatMinor: number | null
    fiatCurrency: string | null
    /** From sales only, never from the net-of-refunds figure — a refund shouldn't skew the typical-transaction size. */
    averageTicketNim: string | null
  }
  entries: ShiftEntry[]
  /** True when a sale had no fiat price, so the fiat total covers only part of the day. */
  fiatIncomplete: boolean
}

export type OpenShiftRequestT = z.infer<typeof OpenShiftRequest>

// A vendor's catalog item. priceMinor is USD cents like every other *_minor
// column — no float, and the server (not the client) owns it once a sale
// references a product by id.
export const CreateProductRequest = z.object({
  name: z.string().min(1).max(60),
  priceMinor: z.number().int().min(0),
  category: z.string().max(30).optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})
export const UpdateProductRequest = z.object({
  name: z.string().min(1).max(60).optional(),
  priceMinor: z.number().int().min(0).optional(),
  category: z.string().max(30).nullable().optional(),
  pinned: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})
export type CreateProductRequestT = z.infer<typeof CreateProductRequest>
export type UpdateProductRequestT = z.infer<typeof UpdateProductRequest>

export interface ProductView {
  id: string
  name: string
  priceMinor: number
  category: string | null
  pinned: boolean
  active: boolean
  sortOrder: number
}
