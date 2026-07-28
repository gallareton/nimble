import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
const { db } = makeDb(env.databaseUrl)
const app = buildApp({ db })
await app.listen({ port: env.port, host: '0.0.0.0' })
