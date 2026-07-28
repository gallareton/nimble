import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
import { nimiqVerifier } from './services/nimiqAuth'
const { db } = makeDb(env.databaseUrl)
const app = buildApp({ db, verifier: nimiqVerifier })
await app.listen({ port: env.port, host: '0.0.0.0' })
