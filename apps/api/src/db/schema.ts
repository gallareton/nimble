import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userProfile = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull().unique(),
  displayName: text('display_name'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  preferredFiat: text('preferred_fiat'),
  locale: text('locale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
})

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
})

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

export const claimAttempt = pgTable('claim_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(), // 'ip' | 'wallet'
  subjectHash: text('subject_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('claim_attempt_subject_idx').on(t.subjectType, t.subjectHash, t.occurredAt)])
