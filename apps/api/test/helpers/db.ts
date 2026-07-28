import { sql as dsql } from 'drizzle-orm'
import { makeDb } from '../../src/db/client'
import { env } from '../../src/env'

export async function freshDb() {
  const { db, sql } = makeDb(env.databaseUrl)
  await db.execute(dsql`TRUNCATE user_profile, payment_session, charge, chain_transaction,
    receipt, session_event, idempotency_record, auth_nonce, claim_attempt CASCADE`)
  return { db, close: () => sql.end() }
}
