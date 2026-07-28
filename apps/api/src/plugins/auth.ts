import { jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../env'

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'missing token' } })
  try {
    const { payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(env.jwtSecret))
    req.user = { userId: payload.sub as string, address: payload.addr as string }
  } catch { return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid token' } }) }
}
declare module 'fastify' { interface FastifyRequest { user: { userId: string; address: string } } }
