import { sql as dsql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { makeDb } from '../../src/db/client'

// Tests run against their own database — NEVER the dev one: freshDb()
// truncates everything, and the dev DB holds live device-testing state.
const TEST_DB_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://postgres:nimblink@localhost:5433/nimblink_test'

let migrated = false

export async function freshDb() {
  const { db, sql } = makeDb(TEST_DB_URL)
  if (!migrated) {
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
    migrated = true
  }
  await db.execute(dsql`TRUNCATE user_profile, payment_session, charge, chain_transaction,
    receipt, session_event, idempotency_record, auth_nonce, auth_session, claim_attempt CASCADE`)
  return { db, close: () => sql.end() }
}
