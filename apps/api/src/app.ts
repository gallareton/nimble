import Fastify from 'fastify'
import type { Db } from './db/client'

export interface AppDeps { db: Db }

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: true })
  app.decorate('deps', deps)
  app.get('/healthz', async () => ({ ok: true }))
  return app
}
declare module 'fastify' { interface FastifyInstance { deps: AppDeps } }
