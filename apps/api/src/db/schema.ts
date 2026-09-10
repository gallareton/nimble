import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userProfile = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull().unique(),
  displayName: text('display_name'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  preferredFiat: text('preferred_fiat'),
  locale: text('locale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // HMAC-SHA256 of the cashier PIN with env.codePepper, same construction as
  // payment_session.code_hash — never the PIN itself. NULL means the owner
  // has never set a lock PIN, which is also why the lock cannot be enabled.
  cashierPinHash: text('cashier_pin_hash'),
  // Lives on the profile, not the session: re-authenticating with the wallet
  // signature must not lift the lock, only the PIN does.
  cashierLocked: boolean('cashier_locked').notNull().default(false),
  // Profile fields (BR-P15). None of these are verified against any
  // registry — taxId in particular is whatever the owner typed and must
  // never be shown next to a word like "verified". They print on receipts
  // and, minus taxId, appear to a payer before they confirm; see
  // charge.receiver_business_name/receiver_tax_id for why a sale snapshots
  // them instead of reading this row live.
  businessName: text('business_name'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
})

export const authSession = pgTable('auth_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => userProfile.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
})

export const paymentSession = pgTable('payment_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  payerUserId: uuid('payer_user_id').notNull().references(() => userProfile.id),
  receiverUserId: uuid('receiver_user_id').references(() => userProfile.id),
  codeHash: text('code_hash').notNull(),
  status: text('status').notNull().default('AVAILABLE'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  chargeDeadlineAt: timestamp('charge_deadline_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('one_available_code_per_payer').on(t.payerUserId).where(sql`status = 'AVAILABLE'`),
  index('session_code_hash_idx').on(t.codeHash),
  index('session_status_idx').on(t.status),
])

// A vendor's working period. The daily report is bounded by it, so exactly one
// may be open per user — enforced here rather than in application code, the
// same way one_available_code_per_payer is.
export const shift = pgTable('shift', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => userProfile.id),
  operatorLabel: text('operator_label').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, t => [
  uniqueIndex('one_open_shift_per_user').on(t.userId).where(sql`closed_at is null`),
  index('shift_user_idx').on(t.userId),
])

export const charge = pgTable('charge', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().unique().references(() => paymentSession.id),
  version: integer('version').notNull().default(1),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  pricingCurrency: text('pricing_currency').notNull().default('NIM'),
  acceptedAssets: text('accepted_assets').array().notNull().default(sql`ARRAY['NIM']`),
  selectedAsset: text('selected_asset').notNull().default('NIM'),
  recipientAddress: text('recipient_address').notNull(),
  reference: text('reference'),
  reconciliationToken: text('reconciliation_token').unique(),
  status: text('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Stamped at creation, never derived from timestamps later: a closed shift
  // has to report the same rows forever.
  shiftId: uuid('shift_id').references(() => shift.id),
  // The price the cashier typed, and the quote it was converted with.
  fiatAmountMinor: integer('fiat_amount_minor'),
  fiatCurrency: text('fiat_currency'),
  fxRate: text('fx_rate'),
  fxRateAt: timestamp('fx_rate_at', { withTimezone: true }),
  fxSource: text('fx_source'),
  // Set when this charge settles a POS sale (NIM path): lets a sale's
  // report join straight to its charge without going through session claim.
  saleId: uuid('sale_id').references((): AnyPgColumn => sale.id),
  // Snapshot of the receiver's user_profile business fields at the moment
  // insertCharge ran — the same reasoning as the frozen fx rate above: a
  // receiver renaming their point of sale after the fact must not rewrite
  // what an old receipt says. Never read live from user_profile once a
  // charge exists; see services/charges.ts.
  receiverBusinessName: text('receiver_business_name'),
  receiverTaxId: text('receiver_tax_id'),
})

// A remote charge: the receiver bills a payer who isn't at the counter and
// shares the link. `id` is the public link token, so it MUST stay
// unguessable — defaultRandom() (uuid v4), never anything sequential.
//
// No shift_id here, deliberately: a request raised during one shift but paid
// after it closes would change a closed shift's contents, breaking "a closed
// shift reports the same rows forever". The shift stamp happens at payment
// time (when the resulting `charge` row is created), not at request time.
export const chargeRequest = pgTable('charge_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiverUserId: uuid('receiver_user_id').notNull().references(() => userProfile.id),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  fiatAmountMinor: integer('fiat_amount_minor'),
  fiatCurrency: text('fiat_currency'),
  fxRate: text('fx_rate'),
  fxRateAt: timestamp('fx_rate_at', { withTimezone: true }),
  fxSource: text('fx_source'),
  reference: text('reference'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  sessionId: uuid('session_id').references(() => paymentSession.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Task 3 (Merchant API): a caller's own id for this bill, so they can look
  // it up without storing our uuid. Added now to avoid a second migration.
  externalRef: text('external_ref'),
}, t => [
  // A request materializes at most one session: enforced by the database,
  // not application code, same pattern as one_open_shift_per_user.
  uniqueIndex('one_session_per_request').on(t.sessionId).where(sql`session_id is not null`),
])

export const chainTransaction = pgTable('chain_transaction', {
  id: uuid('id').primaryKey().defaultRandom(),
  chargeId: uuid('charge_id').notNull().references(() => charge.id),
  network: text('network').notNull().default('nimiq'),
  asset: text('asset').notNull().default('NIM'),
  sender: text('sender').notNull(),
  recipient: text('recipient').notNull(),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  feeAtomic: bigint('fee_atomic', { mode: 'bigint' }),
  hash: text('hash').notNull(),
  status: text('status').notNull().default('SUBMITTED'),
  confirmations: integer('confirmations').notNull().default(0),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, t => [uniqueIndex('tx_network_hash').on(t.network, t.hash)])

export const receipt = pgTable('receipt', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').notNull().references(() => chainTransaction.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => userProfile.id),
  role: text('role').notNull(),
  snapshotJson: jsonb('snapshot_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // One receipt per (transaction, owner): overlapping monitor ticks race to
  // confirm the same transaction, and the loser's insert must fail cleanly
  // rather than leave a duplicate.
  uniqueIndex('receipt_tx_owner_idx').on(t.transactionId, t.ownerUserId),
])

export const sessionEvent = pgTable('session_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => paymentSession.id),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').notNull(),
  stateFrom: text('state_from'),
  stateTo: text('state_to'),
  safeMetadata: jsonb('safe_metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  correlationId: text('correlation_id'),
})

export const idempotencyRecord = pgTable('idempotency_record', {
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  responseCode: integer('response_code'),
  responseBody: jsonb('response_body'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [uniqueIndex('idem_scope_key').on(t.scope, t.key)])

export const authNonce = pgTable('auth_nonce', {
  nonce: text('nonce').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

// A refund is a transfer from the vendor back to the customer, not a reversal
// of the original payment — the chain is append-only, so the original charge
// stays exactly as it was and a second, independent charge moves value the
// other way. That second charge rides the ordinary payment_session/charge
// machinery (vendor as payer, customer as receiver): the monitor, receipts,
// macro-block finality and on-chain reconciliation all already know how to
// carry a session to CONFIRMED, so a refund needs none of that duplicated.
// This table exists purely to record the link back to what it refunds —
// nothing here participates in settling the transfer itself.
export const refund = pgTable('refund', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalChargeId: uuid('original_charge_id').notNull().references(() => charge.id),
  sessionId: uuid('session_id').notNull().references(() => paymentSession.id),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // One refund per session: the session is the refund's own payment, so this
  // is really "a refund session settles at most one refund" — enforced here
  // rather than trusted to application code, same pattern as the other
  // one-per-X partial/unique indexes in this file.
  uniqueIndex('one_refund_per_session').on(t.sessionId),
])

export const claimAttempt = pgTable('claim_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(), // 'ip' | 'wallet'
  subjectHash: text('subject_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('claim_attempt_subject_idx').on(t.subjectType, t.subjectHash, t.occurredAt)])

// A vendor's catalog item. No DELETE route: sale_item.product_id points at
// this row so it must keep existing for a historical sale to still name what
// was sold — withdrawing an item happens via active=false instead.
export const product = pgTable('product', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => userProfile.id),
  name: text('name').notNull(),
  // Price in USD cents, like every other *_minor column here — never a float.
  priceMinor: integer('price_minor').notNull(),
  category: text('category'),
  pinned: boolean('pinned').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('product_owner_active_idx').on(t.ownerUserId, t.active)])

// A sale is the "what was sold" document, independent of how it was paid.
// For NIM, `status` stays 'awaiting' forever in this column — the real
// paid/failed state is derived from the linked charge's session at read
// time (see routes/sales.ts), the same way a shift report already derives
// its numbers from charge/payment_session rather than caching them. The
// monitor is not touched: it knows nothing about sale or sale_item.
export const sale = pgTable('sale', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerUserId: uuid('seller_user_id').notNull().references(() => userProfile.id),
  shiftId: uuid('shift_id').references(() => shift.id),
  status: text('status').notNull().default('awaiting'), // 'awaiting' | 'paid' | 'cancelled'
  paymentMethod: text('payment_method').notNull(), // 'nim' | 'cash'
  totalMinor: integer('total_minor').notNull(),
  fiatCurrency: text('fiat_currency').notNull().default('USD'),
  chargeId: uuid('charge_id').references(() => charge.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, t => [index('sale_seller_created_idx').on(t.sellerUserId, t.createdAt)])

// One line of a sale. name/price are snapshotted at sale time — a later
// catalog price change must never rewrite yesterday's report, the same
// reasoning as the frozen fx rate on `charge`. productId is nullable for a
// line rung up outside the catalog (manual amount, like today's charge flow).
export const saleItem = pgTable('sale_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  saleId: uuid('sale_id').notNull().references(() => sale.id),
  productId: uuid('product_id').references(() => product.id),
  nameSnapshot: text('name_snapshot').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalMinor: integer('line_total_minor').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// A vendor's Merchant API credential. The plaintext key is returned exactly
// once at creation and never stored — only its HMAC, same construction
// (env.codePepper) as hashCode() for six-digit codes.
export const apiKey = pgTable('api_key', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => userProfile.id),
  keyHash: text('key_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
