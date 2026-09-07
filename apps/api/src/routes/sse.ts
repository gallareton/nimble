import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { paymentSession } from '../db/schema'
import { env } from '../env'
import { TicketStore } from '../services/ticketStore'

const tickets = new TicketStore()

export async function sseRoutes(app: FastifyInstance) {
  const { db, events } = app.deps

  app.post('/v1/sessions/:id/events-ticket', { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, id))
    if (!s || (s.payerUserId !== req.user.userId && s.receiverUserId !== req.user.userId))
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
    return { ticket: tickets.issue(id) }
  })

  app.get('/v1/sessions/:id/events', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const ticket = (req.query as { ticket?: string }).ticket
    if (!tickets.redeem(ticket, id))
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid ticket' } })

    // reply.raw bypasses fastify's onSend hooks, so the CORS plugin never
    // decorates this response — set the header explicitly or browsers block
    // the cross-origin stream.
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': env.corsOrigin,
    })
    const send = (event: string, data: object) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    const [s] = await db.select().from(paymentSession).where(eq(paymentSession.id, id))
    send('state', { status: s?.status })

    // events.publish fans out synchronously — wrap so one broken stream
    // cannot break persistence or other subscribers
    const unsub = events.subscribe(id, e => {
      try {
        send('state', { status: e.stateTo, eventType: e.eventType })
      } catch { /* stream broken; close handler cleans up */ }
    })
    const heartbeat = setInterval(() => reply.raw.write(': hb\n\n'), 25_000)
    req.raw.on('close', () => { unsub(); clearInterval(heartbeat) })
  })
}
