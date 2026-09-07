import { randomBytes } from 'node:crypto'

/**
 * Single-use, short-lived tickets authorising one SSE stream.
 *
 * A ticket is consumed the moment the stream opens, so this normally holds
 * almost nothing — but a ticket nobody redeems (the payer closed the app
 * between asking for one and connecting) would otherwise sit here until the
 * process dies. Expired entries are swept on issue, the only moment the map
 * can grow.
 *
 * LIMITATION, deliberate: this is per-process state. It is correct for the
 * current deployment — one API container per network — and would break under
 * horizontal scaling, where a ticket issued by one instance is redeemed
 * against another. The fix at that point is a shared store with the same
 * single-use delete (Redis, or a table); it is not worth the moving parts
 * before then. This module exists so that swap touches one file.
 */
export class TicketStore {
  readonly #tickets = new Map<string, { sessionId: string; expiresAt: number }>()

  constructor(private readonly ttlMs = 30_000) {}

  issue(sessionId: string, now = Date.now()): string {
    for (const [key, t] of this.#tickets) if (t.expiresAt < now) this.#tickets.delete(key)
    const ticket = randomBytes(16).toString('hex')
    this.#tickets.set(ticket, { sessionId, expiresAt: now + this.ttlMs })
    return ticket
  }

  /** Consumes the ticket. Returns false for unknown, expired, or wrong-session
   *  tickets, and deletes the entry either way — a ticket gets exactly one try. */
  redeem(ticket: string | undefined, sessionId: string, now = Date.now()): boolean {
    if (!ticket) return false
    const t = this.#tickets.get(ticket)
    this.#tickets.delete(ticket)
    return !!t && t.sessionId === sessionId && t.expiresAt >= now
  }

  /** Held tickets. For tests asserting that unredeemed ones do not accumulate. */
  get size(): number {
    return this.#tickets.size
  }
}
