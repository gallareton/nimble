import type { ClaimResponse, CreateSessionResponse, IntentResponse, SessionView } from '@nimblink/shared'
import type { WalletProvider } from '../wallet/types'
import { uuid } from '../lib/uuid'

export interface HistoryItem {
  receiptId: string
  role: string
  snapshot: Record<string, unknown>
  createdAt: string
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export class Api {
  constructor(
    public baseUrl: string,
    private getToken: () => string | null,
  ) {}

  async #request<T>(method: string, path: string, body?: object, idemKey?: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = this.getToken()
    if (token) headers.authorization = `Bearer ${token}`
    if (method !== 'GET') headers['idempotency-key'] = idemKey ?? uuid()
    // Fastify rejects an empty body when content-type is JSON — always send
    // at least {} on non-GET requests.
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error
      throw new ApiError(err?.code ?? 'UNKNOWN', err?.message ?? `HTTP ${res.status}`, res.status)
    }
    return json as T
  }

  #get<T>(path: string) { return this.#request<T>('GET', path) }
  #post<T>(path: string, body?: object, idemKey?: string) { return this.#request<T>('POST', path, body, idemKey) }

  async login(wallet: WalletProvider): Promise<{ token: string; address: string }> {
    const { nonce, message } = await this.#post<{ nonce: string; message: string }>('/v1/auth/challenge')
    const { publicKey, signature } = await wallet.signMessage(message)
    return this.#post<{ token: string; address: string }>('/v1/auth/verify', { nonce, publicKey, signature })
  }

  createSession(idemKey?: string) { return this.#post<CreateSessionResponse>('/v1/sessions', undefined, idemKey) }
  claim(code: string, idemKey?: string) { return this.#post<ClaimResponse>('/v1/sessions/claim', { code }, idemKey) }
  createCharge(sessionId: string, amountLuna: string, reference?: string, idemKey?: string) {
    return this.#post<{ chargeId: string; version: number }>(
      `/v1/sessions/${sessionId}/charges`, { amountLuna, reference }, idemKey)
  }
  getSession(id: string) { return this.#get<SessionView>(`/v1/sessions/${id}`) }
  reject(chargeId: string) { return this.#post<{ status: string }>(`/v1/charges/${chargeId}/reject`) }
  cancel(sessionId: string) { return this.#post<{ status: string }>(`/v1/sessions/${sessionId}/cancel`) }
  intent(chargeId: string) { return this.#post<IntentResponse>(`/v1/charges/${chargeId}/intent`) }
  registerTx(chargeId: string, hash: string, idemKey?: string) {
    return this.#post<{ transactionId: string }>(`/v1/charges/${chargeId}/transactions`, { hash }, idemKey)
  }
  history() { return this.#get<{ items: HistoryItem[]; nextCursor: null }>('/v1/history') }
  updateMe(body: { displayName: string }) { return this.#request<{ ok: true }>('PATCH', '/v1/me', body) }

  // Tickets are single-use: EventSource's built-in auto-reconnect would replay
  // a consumed ticket and die on 401 — manage reconnection manually and
  // resync authoritative state on every reconnect (design §6).
  async openEvents(sessionId: string, onState: (s: { status: string }) => void): Promise<() => void> {
    let closed = false
    let es: EventSource | null = null
    const connect = async () => {
      if (closed) return
      const { ticket } = await this.#post<{ ticket: string }>(`/v1/sessions/${sessionId}/events-ticket`)
      es = new EventSource(`${this.baseUrl}/v1/sessions/${sessionId}/events?ticket=${ticket}`)
      es.addEventListener('state', e => onState(JSON.parse((e as MessageEvent).data)))
      es.onerror = () => {
        es?.close()
        if (closed) return
        void this.getSession(sessionId).then(s => onState({ status: s.status })).catch(() => {})
        setTimeout(() => { void connect().catch(() => {}) }, 2000)
      }
    }
    await connect()
    return () => { closed = true; es?.close() }
  }
}
