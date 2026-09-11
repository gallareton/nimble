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
  // POS hand-off: claiming with a saleId prices the charge from the sale's
  // own frozen total — the client must not also try to name an amount.
  saleId: z.string().uuid().optional(),
}).refine(
  b => b.amountLuna === undefined || b.fiatAmountMinor === undefined,
  'cannot set both amountLuna and fiatAmountMinor',
).refine(
  b => (b.fiatAmountMinor === undefined) === (b.fiatCurrency === undefined),
  'fiatCurrency is required with fiatAmountMinor',
).refine(
  b => b.saleId === undefined || (b.amountLuna === undefined && b.fiatAmountMinor === undefined && b.fiatCurrency === undefined),
  'saleId cannot be combined with amountLuna or fiatAmountMinor',
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
  counterpart?: { displayName: string; verificationStatus: 'unverified'; addressTail: string
                  businessName: string | null }
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
  // The point of sale's name, if set — never taxId here (BR-P15: unverified,
  // receipt-only).
  businessName: string | null
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

// Point-of-sale profile (BR-P15). Entirely unverified — taxId is printed on
// receipts and nowhere else, never next to a claim of verification. Empty
// string means "clear the field" (route normalizes to null); undefined
// means "leave it as is".
export const UpdateProfileRequest = z.object({
  businessName: z.string().max(100).nullable().optional(),
  businessAddress: z.string().max(100).nullable().optional(),
  taxId: z.string().max(20).nullable().optional(),
})
export type UpdateProfileRequestT = z.infer<typeof UpdateProfileRequest>

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
  /** Set only when this charge settles a POS sale (the NIM path). Null for a
   *  plain charge or a refund. Feeds the CSV's sale_id column. */
  saleId: string | null
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
  /** Same definition as ShiftReport.totals.grossFiatMinor: confirmed NIM
   *  sales' fiat value plus paid cash sales' totals. Null when the shift has
   *  neither — a list row must never disagree with the report it summarises,
   *  which is exactly what "utarg pomija gotówkę" was. */
  grossFiatMinor: number | null
  fiatCurrency: string | null
  /** Paid cash sales in this shift. Never folded into `confirmed`, which
   *  stays NIM-charge-only; a sales count is `confirmed + cashSales`. */
  cashSales: number
}

/** One row of the POS "sold by product" breakdown — paid sales only (cash
 *  paid, or NIM CONFIRMED). Snapshot name, not the live catalog name. */
export interface ShiftProductTotal { name: string; quantity: number; totalMinor: number }

/** A cash sale in this shift's report. Cash never produces a `charge` row
 *  (no chain, no session), so it can't live in `entries` — those describe
 *  charges. Kept as its own shape rather than padding ShiftEntry with nulls. */
export interface ShiftCashEntry {
  saleId: string; occurredAt: string; amountFiatMinor: number; reference: string | null
  /** The sale's value in NIM at the rate frozen when it was rung up — never
   *  today's rate. Null when the sale carries no frozen rate. */
  amountNim?: string | null
}

export interface ShiftReport {
  shift: ShiftView
  totals: {
    count: number; confirmed: number; refunded: number; failed: number
    /** Sales minus confirmed refunds — may go negative if a refund lands in a later shift than its sale. */
    grossNim: string
    /** Confirmed NIM sales' fiat value plus paid cash sales' totals. */
    grossFiatMinor: number | null
    fiatCurrency: string | null
    /** From sales only, never from the net-of-refunds figure — a refund shouldn't skew the typical-transaction size. */
    averageTicketNim: string | null
    /** Count of paid cash sales — never counted in `confirmed`, which stays NIM-charge-only. */
    cashSales: number
    byPaymentMethod: {
      nim: { count: number; fiatMinor: number }
      cash: { count: number; fiatMinor: number }
    }
  }
  entries: ShiftEntry[]
  cashEntries: ShiftCashEntry[]
  byProduct: ShiftProductTotal[]
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

// A sale line: either a catalog item (productId set, name/price come from the
// catalog at sale time — never from what the client sends) or a manual item
// (no productId, name and unitPriceMinor required). quantity is required in
// both cases.
export const CreateSaleItemRequest = z.object({
  productId: z.string().uuid().optional(),
  name: z.string().max(60).optional(),
  unitPriceMinor: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1),
})
export const CreateSaleRequest = z.object({
  items: z.array(CreateSaleItemRequest).min(1).max(50),
  paymentMethod: z.enum(['nim', 'cash']),
})
export type CreateSaleItemRequestT = z.infer<typeof CreateSaleItemRequest>
export type CreateSaleRequestT = z.infer<typeof CreateSaleRequest>

export interface SaleItemView {
  productId: string | null
  name: string
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
}

/**
 * `status` is what's stored ('awaiting' | 'paid' | 'cancelled' — for a NIM
 * sale this column stays 'awaiting' forever, see db/schema.ts on `sale`).
 * `state` is what's true right now, derived from the linked charge's session
 * for a NIM sale: 'paid' | 'awaiting' | 'failed' | 'cancelled'.
 */
export interface SaleView {
  id: string
  status: 'awaiting' | 'paid' | 'cancelled'
  state: 'awaiting' | 'paid' | 'cancelled' | 'failed'
  paymentMethod: 'nim' | 'cash'
  totalMinor: number
  fiatCurrency: string
  shiftId: string | null
  chargeId: string | null
  items: SaleItemView[]
  createdAt: string
  paidAt: string | null
}

// Merchant API: an API key credential (Task 3). The plaintext key is
// returned exactly once, in ApiKeyCreatedView — never again afterward.
export const CreateApiKeyRequest = z.object({ label: z.string().min(1).max(60) })
export type CreateApiKeyRequestT = z.infer<typeof CreateApiKeyRequest>

export interface ApiKeyCreatedView { id: string; label: string; key: string; createdAt: string }
export interface ApiKeyView { id: string; label: string; createdAt: string; revokedAt: string | null }

/** Same pricing shape as CreateChargeRequestRequest, plus a caller-supplied
 *  externalRef so an integrator can look a bill up by its own id. */
export const MerchantCreateChargeRequestRequest = z.object({
  amountLuna: PositiveLunaString.optional(),
  fiatAmountMinor: z.number().int().positive().optional(),
  fiatCurrency: FiatCurrency.optional(),
  reference: z.string().max(100).optional(),
  externalRef: z.string().max(100).optional(),
}).refine(
  b => (b.amountLuna === undefined) !== (b.fiatAmountMinor === undefined),
  'provide either amountLuna or fiatAmountMinor',
).refine(
  b => b.fiatAmountMinor === undefined || b.fiatCurrency !== undefined,
  'fiatCurrency is required with fiatAmountMinor',
)
export type MerchantCreateChargeRequestRequestT = z.infer<typeof MerchantCreateChargeRequestRequest>

export interface MerchantCreateChargeRequestResponse {
  id: string; url: string; expiresAt: string; state: 'open'; externalRef: string | null
}

/**
 * `state` is the bill's own lifecycle: 'open' | 'expired' | 'paid'. 'paid'
 * means someone accepted the bill and a payment session exists for it — it
 * does NOT mean the money has arrived. `payment.sessionStatus` is the actual
 * payment lifecycle; only 'CONFIRMED' there is final settlement. Poll this
 * route rather than relying on `state` alone — see routes/merchant.ts.
 */
/**
 * GET /v1/dashboard — an owner's one-glance summary of a UTC calendar day
 * ([day 00:00Z, day+1 00:00Z)). Scoped to the caller: sales they sold, plus
 * NIM charges that settled with them as receiver but carry no `sale` (POS
 * sales from before the catalog existed, and accepted remote bills) — the
 * two never double-count, since a charge with a `saleId` belongs to its own
 * sale. Every count and money figure is a whole number; luna stays a string.
 */
export interface DashboardView {
  day: string
  /** Paid cash sales' totalMinor plus CONFIRMED NIM sales'/charges' fiatAmountMinor, where a fiat price exists. */
  grossFiatMinor: number
  /** CONFIRMED NIM only, luna→NIM. Not netted against refunds — see refundedNim. */
  grossNim: string
  /** Paid cash sales plus CONFIRMED NIM sales/charges. */
  salesCount: number
  /** Confirmed refunds issued today (the vendor is a refund's payer, never its receiver — see routes/refunds.ts). */
  refundsCount: number
  refundedNim: string
  byPaymentMethod: {
    nim: { count: number; fiatMinor: number }
    cash: { count: number; fiatMinor: number }
  }
  /** Grouped by `shift.operator_label`, not shift id — two shifts opened under the same label merge into one row. No shift → null, sorted last. */
  byOperator: { operatorLabel: string | null; salesCount: number; grossFiatMinor: number; grossNim: string }[]
  /** Top 10 by totalMinor, from every sale that ended up paid today (cash or NIM). */
  topProducts: { name: string; quantity: number; totalMinor: number }[]
  openShift: { id: string; operatorLabel: string; openedAt: string } | null
  /** NIM sales still `awaiting` (via saleState — not a final state), newest first. */
  awaiting: { saleId: string; totalMinor: number; createdAt: string; sessionId: string | null }[]
  /** Unpaid, unexpired remote bills — same query as GET /v1/charge-requests/outstanding. */
  outstandingBills: number
}

export interface MerchantChargeRequestView {
  id: string
  state: 'open' | 'expired' | 'paid'
  externalRef: string | null
  amountLuna: string
  fiatAmountMinor: number | null
  fiatCurrency: string | null
  reference: string | null
  expiresAt: string
  createdAt: string
  payment?: { sessionStatus: string; txHash: string | null; confirmedAt: string | null }
}
