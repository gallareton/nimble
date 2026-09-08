import { CreateChargeRequestRequest, parseLunaString } from '@nimble/shared'
import { and, eq, gt, isNull, sql as dsql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createHmac, randomBytes } from 'node:crypto'
import { chargeRequest, claimAttempt, paymentSession, userProfile } from '../db/schema'
import type { Db } from '../db/client'
import { env } from '../env'
import { withIdempotency } from '../plugins/idempotency'
import { priceInLuna } from '../services/pricing'
import { insertCharge } from '../services/charges'
import { requireIdemKey, CLAIM_WINDOW_MS } from './sessions'
import { openShiftFor } from './shifts'

const CHARGE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000

// Same window as the code-claim throttle, but its own subject_type: previews
// hit an unauthenticated route (the payer may not have an account yet), so
// they're rate-limited by IP alone. Sharing subject_type 'ip' with claim's
// counter would mean a vendor opening several remote-charge links to check
// on them could burn through the code-claim IP budget and lock themselves
// out of claiming codes at the counter mid-shift — two unrelated things
// counted against one limit. A distinct subject_type keeps them apart.
const PREVIEW_SUBJECT_TYPE = 'preview-ip'
const PREVIEW_MAX_ATTEMPTS = 30

export async function chargeRequestRoutes(app: FastifyInstance) {
  const { db, events } = app.deps

  app.post('/v1/charge-requests', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const body = CreateChargeRequestRequest.parse(req.body)

    // Same fingerprint discipline as POST /v1/sessions/:id/charges: hash what
    // the client asked for, not what the rate turned it into.
    const fingerprint = body.fiatAmountMinor !== undefined
      ? JSON.stringify({ fiatAmountMinor: body.fiatAmountMinor, fiatCurrency: body.fiatCurrency,
        reference: body.reference ?? null })
      : JSON.stringify({ amountLuna: body.amountLuna, reference: body.reference ?? null })

    type ResponseBody = { error?: { code: string; message: string }; id?: string; expiresAt?: string }
    const { code, body: resBody } = await withIdempotency<ResponseBody>(
      db, `charge-request:${req.user.userId}`, key, fingerprint, async () => {
        // Quote fetched inside the idempotency-guarded handler, same reason
        // as charges.ts: a replay of an already-successful request must
        // never depend on the rate provider being reachable.
        let quote = null
        let amountAtomic: bigint
        if (body.fiatAmountMinor !== undefined) {
          quote = (await app.deps.rates?.quoteUsdPerNim?.().catch(() => null)) ?? null
          if (!quote)
            return { code: 503, body: { error: { code: 'NO_RATE', message: 'no exchange rate available' } } }
          amountAtomic = priceInLuna(body.fiatAmountMinor, quote)
        } else {
          amountAtomic = parseLunaString(body.amountLuna!)
        }
        const expiresAt = new Date(Date.now() + CHARGE_REQUEST_TTL_MS)
        const [row] = await db.insert(chargeRequest).values({
          receiverUserId: req.user.userId,
          amountAtomic,
          fiatAmountMinor: body.fiatAmountMinor ?? null,
          fiatCurrency: body.fiatCurrency ?? null,
          fxRate: quote ? String(quote.value) : null,
          fxRateAt: quote ? new Date(quote.at) : null,
          fxSource: quote?.source ?? null,
          reference: body.reference ?? null,
          expiresAt,
        }).returning()
        return { code: 201, body: { id: row.id, expiresAt: expiresAt.toISOString() } }
      }
    )
    return reply.code(code).send(resBody)
  })

  // Unauthenticated on purpose: the payer following a shared link may have
  // no account yet.
  //
  // Deliberate departure from the code-claim rule that every failure mode
  // returns the same generic response. That rule exists because a six-digit
  // code is guessable (a million-odd possibilities), so any difference
  // between responses is an oracle an attacker can use to search the space.
  // A charge-request `id` is a uuid v4 link token — nobody is guessing one —
  // and hiding "this link expired" behind the same "no such charge" message
  // a nonexistent id gets would only leave a payer holding a real link from
  // a real receiver confused about what happened. So: not-found is a genuine
  // 404, while expired/already-accepted are told apart via `state` in a 200.
  // Registered before the /:id route below. find-my-way does prefer a static
  // segment over a parametric one, so this would win either way — but the two
  // differ in authentication (this one requires it, the preview does not), and
  // relying on router internals for that is not worth the cleverness.
  //
  // Vendor-scoped, not shift-scoped, which is why it is not part of the shift
  // report: an outstanding bill may have been raised with no shift open at
  // all, and a closed shift's report must never change after the fact.
  app.get('/v1/charge-requests/outstanding', { preHandler: app.authenticate }, async (req) => {
    const [row] = await db.select({ count: dsql<number>`count(*)::int` }).from(chargeRequest)
      .where(and(eq(chargeRequest.receiverUserId, req.user.userId),
        isNull(chargeRequest.sessionId), gt(chargeRequest.expiresAt, new Date())))
    return { count: row?.count ?? 0 }
  })

  app.get('/v1/charge-requests/:id', async (req, reply) => {
    const ipHash = createHmac('sha256', env.codePepper).update(req.ip).digest('hex')
    const since = new Date(Date.now() - CLAIM_WINDOW_MS)
    const [{ count }] = await db.select({ count: dsql<number>`count(*)::int` }).from(claimAttempt)
      .where(and(eq(claimAttempt.subjectType, PREVIEW_SUBJECT_TYPE), eq(claimAttempt.subjectHash, ipHash),
        gt(claimAttempt.occurredAt, since)))
    if (count >= PREVIEW_MAX_ATTEMPTS)
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a moment.' } })
    await db.insert(claimAttempt).values({ subjectType: PREVIEW_SUBJECT_TYPE, subjectHash: ipHash })

    const id = (req.params as { id: string }).id
    const [r] = await db.select().from(chargeRequest).where(eq(chargeRequest.id, id))
    if (!r) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'charge request not found' } })

    const [receiver] = await db.select().from(userProfile).where(eq(userProfile.id, r.receiverUserId))
    const state: 'open' | 'expired' | 'paid' = r.sessionId
      ? 'paid'
      : r.expiresAt.getTime() <= Date.now() ? 'expired' : 'open'

    return {
      amountLuna: r.amountAtomic.toString(),
      fiatAmountMinor: r.fiatAmountMinor,
      fiatCurrency: r.fiatCurrency,
      reference: r.reference,
      receiverDisplayName: receiver.displayName ?? `…${receiver.walletAddress.slice(-4)}`,
      receiverAddressTail: receiver.walletAddress.slice(-4),
      expiresAt: r.expiresAt.toISOString(),
      state,
    }
  })

  app.post('/v1/charge-requests/:id/accept', { preHandler: app.authenticate }, async (req, reply) => {
    const key = requireIdemKey(req, reply); if (!key) return
    const id = (req.params as { id: string }).id

    type ResponseBody = { error?: { code: string; message: string }; sessionId?: string; chargeId?: string }
    const { code, body } = await withIdempotency<ResponseBody>(
      db, `charge-request-accept:${id}`, key, req.user.userId, async () => {
        const CONFLICT = Symbol('conflict')
        type Outcome =
          | { kind: 'not_found' } | { kind: 'self' } | { kind: 'conflict' }
          | { kind: 'ok'; sessionId: string; chargeId: string }
        let outcome: Outcome
        try {
          outcome = await db.transaction(async tx => {
            const [reqRow] = await tx.select().from(chargeRequest).where(eq(chargeRequest.id, id))
            if (!reqRow) return { kind: 'not_found' }
            if (reqRow.receiverUserId === req.user.userId) return { kind: 'self' }

            const [session] = await tx.insert(paymentSession).values({
              payerUserId: req.user.userId,
              receiverUserId: reqRow.receiverUserId,
              status: 'AWAITING_PAYER_APPROVAL',
              expiresAt: reqRow.expiresAt,
              // A genuinely random value: no six-digit code's HMAC can ever
              // equal it, so code-claim can never land a session onto this
              // charge request. It reads like filler but it's the guard —
              // the alternative (dropping code_hash's NOT NULL) would be a
              // schema change to the live counter-payment table, which this
              // work deliberately avoids touching.
              codeHash: randomBytes(32).toString('hex'),
            }).returning()

            // The database decides who wins a race between two payers
            // accepting the same request, not application code: only one
            // conditional UPDATE can match session_id IS NULL.
            const [locked] = await tx.update(chargeRequest).set({ sessionId: session.id })
              .where(and(eq(chargeRequest.id, id), isNull(chargeRequest.sessionId),
                gt(chargeRequest.expiresAt, new Date())))
              .returning()
            if (!locked) throw CONFLICT

            const [receiver] = await tx.select().from(userProfile).where(eq(userProfile.id, reqRow.receiverUserId))
            // Stamped at acceptance (payment time), not at request creation:
            // a request raised before any shift was open must not block
            // payment, and its shift comes from whoever is working the
            // counter when the payer actually accepts.
            const openShift = await openShiftFor(tx as unknown as Db, reqRow.receiverUserId)
            const c = await insertCharge(tx as unknown as Db, {
              sessionId: session.id,
              amountAtomic: reqRow.amountAtomic,
              shiftId: openShift?.id ?? null,
              fiatAmountMinor: reqRow.fiatAmountMinor,
              fiatCurrency: reqRow.fiatCurrency,
              fxRate: reqRow.fxRate,
              fxRateAt: reqRow.fxRateAt,
              fxSource: reqRow.fxSource,
              recipientAddress: receiver.walletAddress,
              reference: reqRow.reference,
            })
            return { kind: 'ok', sessionId: session.id, chargeId: c.id }
          }) as Outcome
        } catch (e) {
          if (e === CONFLICT) outcome = { kind: 'conflict' }
          else throw e
        }

        if (outcome.kind === 'not_found')
          return { code: 404, body: { error: { code: 'NOT_FOUND', message: 'charge request not found' } } }
        if (outcome.kind === 'self')
          return { code: 400, body: { error: { code: 'SELF_ACCEPT', message: 'cannot accept your own charge request' } } }
        if (outcome.kind === 'conflict')
          return { code: 409, body: { error: { code: 'ALREADY_ACCEPTED', message: 'charge request already accepted or expired' } } }

        // Publish so the resulting session's history doesn't start mid-story
        // at AWAITING_PAYER_APPROVAL with no explanation of how it got there.
        await events.publish(db, { sessionId: outcome.sessionId, eventType: 'REQUEST_ACCEPTED',
          actorType: 'payer', stateTo: 'AWAITING_PAYER_APPROVAL' })
        return { code: 201, body: { sessionId: outcome.sessionId, chargeId: outcome.chargeId } }
      }
    )
    return reply.code(code).send(body)
  })
}
