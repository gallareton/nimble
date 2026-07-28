import { sessionEvent } from '../db/schema'
import type { Db } from '../db/client'

export type SessionEventMsg = { sessionId: string; eventType: string; stateTo?: string }

export class SessionEvents {
  #subs = new Map<string, Set<(e: SessionEventMsg) => void>>()

  subscribe(sessionId: string, fn: (e: SessionEventMsg) => void): () => void {
    const set = this.#subs.get(sessionId) ?? new Set()
    set.add(fn)
    this.#subs.set(sessionId, set)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.#subs.delete(sessionId)
    }
  }

  async publish(
    db: Db,
    e: {
      sessionId: string
      eventType: string
      actorType: 'payer' | 'receiver' | 'system'
      stateFrom?: string
      stateTo?: string
      safeMetadata?: object
    }
  ): Promise<void> {
    await db.insert(sessionEvent).values(e)
    const msg = { sessionId: e.sessionId, eventType: e.eventType, stateTo: e.stateTo }
    this.#subs.get(e.sessionId)?.forEach(fn => fn(msg))
  }
}
