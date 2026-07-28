import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { makeDb } from './client'
import { env } from '../env'
const { db, sql } = makeDb(env.databaseUrl)
await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
await sql.end()
