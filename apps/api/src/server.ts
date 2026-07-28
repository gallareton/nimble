import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
import { SessionEvents } from './services/events'
import { nimiqVerifier } from './services/nimiqAuth'
const { db } = makeDb(env.databaseUrl)
const app = buildApp({ db, verifier: nimiqVerifier, events: new SessionEvents() })
await app.listen({ port: env.port, host: '0.0.0.0' })
