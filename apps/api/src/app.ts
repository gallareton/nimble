import Fastify from 'fastify'
import type { Db } from './db/client'
import type { SignatureVerifier } from './services/nimiqAuth'
import { SessionEvents } from './services/events'
import { authenticate } from './plugins/auth'
import { authRoutes } from './routes/auth'

export interface AppDeps { db: Db; verifier: SignatureVerifier; events: SessionEvents }

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: true })
  app.decorate('deps', deps)
  app.decorate('authenticate', authenticate)
  app.get('/healthz', async () => ({ ok: true }))
  app.register(authRoutes)
  return app
}
declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps; authenticate: typeof authenticate }
}
