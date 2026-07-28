import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
import { SessionEvents } from './services/events'
import { nimiqVerifier } from './services/nimiqAuth'
import { startSweeper } from './services/sweeper'

const { db } = makeDb(env.databaseUrl)
const events = new SessionEvents()
const app = buildApp({ db, verifier: nimiqVerifier, events })
startSweeper(db, events)
await app.listen({ port: env.port, host: '0.0.0.0' })
