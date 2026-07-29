import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import { env } from './env'
import type { Db } from './db/client'
import type { SignatureVerifier } from './services/nimiqAuth'
import { SessionEvents } from './services/events'
import { authenticate } from './plugins/auth'
import { authRoutes } from './routes/auth'
import { sessionRoutes } from './routes/sessions'
import { chargeRoutes } from './routes/charges'
import { sseRoutes } from './routes/sse'
import { historyRoutes } from './routes/history'

export interface AppDeps { db: Db; verifier: SignatureVerifier; events: SessionEvents }

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: true })
  app.register(cors, {
    origin: env.corsOrigin,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key'],
  })
  app.decorate('deps', deps)
  app.decorate('authenticate', authenticate)

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'invalid request body' } })
    // postgres 22P02 (invalid text representation, e.g. malformed uuid in a
    // path param) is client input, not a server fault
    if ((err as { code?: string }).code === '22P02')
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'invalid identifier' } })
    app.log.error({ err })
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } })
  })
  // Production serves the built web app from the same origin (WEB_DIST).
  // API paths keep the JSON 404; everything else falls back to the SPA.
  if (env.webDist) {
    app.register(fastifyStatic, { root: env.webDist, wildcard: false })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/v1') || req.url.startsWith('/__test'))
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } })
      return reply.sendFile('index.html')
    })
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } }))
  }

  app.get('/healthz', async () => ({ ok: true }))
  app.register(authRoutes)
  app.register(sessionRoutes)
  app.register(chargeRoutes)
  app.register(sseRoutes)
  app.register(historyRoutes)
  return app
}
declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps; authenticate: typeof authenticate }
}
