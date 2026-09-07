import type { AcceptChargeRequestResponse, AffordabilityResponse, ChargeRequestPreview, ClaimResponse, CreateChargeRequestResponse, CreateSessionResponse, IntentResponse, SessionView, ShiftListItem, ShiftReport, ShiftView } from '@nimble/shared'
import type { WalletProvider } from '../wallet/types'
import { uuid } from '../lib/uuid'

export interface HistoryItem {
  receiptId?: string
  pending?: boolean
  sessionId?: string
  status?: string
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
    // Returns true if credentials were silently renewed (request is retried).
    private onUnauthorized?: () => Promise<boolean>,
  ) {}

  async #request<T>(method: string, path: string, body?: object, idemKey?: string, retried = false): Promise<T> {
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
      // A 401 outside the auth flow means the stored JWT went stale (1 h
      // expiry). Ask the app to renew it (refresh token); on success retry
      // the request once so the user never notices.
      if (res.status === 401 && !path.startsWith('/v1/auth') && !retried && this.onUnauthorized) {
        if (await this.onUnauthorized())
          return this.#request<T>(method, path, body, idemKey, true)
      }
      const err = (json as { error?: { code?: string; message?: string } }).error
      throw new ApiError(err?.code ?? 'UNKNOWN', err?.message ?? `HTTP ${res.status}`, res.status)
    }
    return json as T
  }

  #get<T>(path: string) { return this.#request<T>('GET', path) }
  #post<T>(path: string, body?: object, idemKey?: string) { return this.#request<T>('POST', path, body, idemKey) }

  async login(wallet: WalletProvider): Promise<{ token: string; address: string; refreshToken: string }> {
    const { nonce, message } = await this.#post<{ nonce: string; message: string }>('/v1/auth/challenge')
    const { publicKey, signature } = await wallet.signMessage(message)
    return this.#post<{ token: string; address: string; refreshToken: string }>(
      '/v1/auth/verify', { nonce, publicKey, signature })
  }

  refresh(refreshToken: string) {
    return this.#post<{ token: string; address: string; refreshToken: string }>(
      '/v1/auth/refresh', { refreshToken })
  }

  createSession(idemKey?: string) { return this.#post<CreateSessionResponse>('/v1/sessions', undefined, idemKey) }
  claim(
    code: string,
    opts?: { amountLuna?: string; fiatAmountMinor?: number; fiatCurrency?: string; reference?: string },
    idemKey?: string,
  ) {
    return this.#post<ClaimResponse>('/v1/sessions/claim', { code, ...opts }, idemKey)
  }
  createCharge(sessionId: string, amountLuna: string, reference?: string, idemKey?: string) {
    return this.#post<{ chargeId: string; version: number }>(
      `/v1/sessions/${sessionId}/charges`, { amountLuna, reference }, idemKey)
  }
  // Idempotency here isn't cosmetic decoration copied from the other POSTs:
  // a bill for someone off-premises has no in-person retry — a dropped
  // response must not risk minting a second charge request for the same sale.
  createChargeRequest(
    opts: { amountLuna?: string; fiatAmountMinor?: number; fiatCurrency?: string; reference?: string },
    idemKey?: string,
  ) {
    return this.#post<CreateChargeRequestResponse>('/v1/charge-requests', opts, idemKey)
  }
  getSession(id: string) { return this.#get<SessionView>(`/v1/sessions/${id}`) }
  // Unauthenticated on purpose — same reason as the route itself: the payer
  // following a shared link may have no account yet.
  getChargeRequest(id: string) { return this.#get<ChargeRequestPreview>(`/v1/charge-requests/${id}`) }
  acceptChargeRequest(id: string, idemKey?: string) {
    return this.#post<AcceptChargeRequestResponse>(`/v1/charge-requests/${id}/accept`, undefined, idemKey)
  }
  reject(chargeId: string) { return this.#post<{ status: string }>(`/v1/charges/${chargeId}/reject`) }
  cancel(sessionId: string) { return this.#post<{ status: string }>(`/v1/sessions/${sessionId}/cancel`) }
  intent(chargeId: string) { return this.#post<IntentResponse>(`/v1/charges/${chargeId}/intent`) }
  getAffordability(chargeId: string) { return this.#get<AffordabilityResponse>(`/v1/charges/${chargeId}/affordability`) }
  registerTx(chargeId: string, hash: string, idemKey?: string) {
    return this.#post<{ transactionId: string }>(`/v1/charges/${chargeId}/transactions`, { hash }, idemKey)
  }
  history(params?: { cursor?: string; q?: string; role?: string; limit?: number
    from?: string; to?: string }) {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set('cursor', params.cursor)
    if (params?.q) qs.set('q', params.q)
    if (params?.role) qs.set('role', params.role)
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.size ? `?${qs}` : ''
    return this.#get<{ items: HistoryItem[]; nextCursor: string | null }>(`/v1/history${suffix}`)
  }
  async getCurrentShift(): Promise<ShiftView | null> {
    try {
      return await this.#get<ShiftView>('/v1/shifts/current')
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  }
  openShift(operatorLabel: string): Promise<ShiftView> {
    return this.#post<ShiftView>('/v1/shifts', { operatorLabel })
  }
  closeShift(id: string): Promise<ShiftReport> {
    return this.#post<ShiftReport>(`/v1/shifts/${id}/close`)
  }
  getShiftReport(id: string): Promise<ShiftReport> {
    return this.#get<ShiftReport>(`/v1/shifts/${id}/report`)
  }
  getShifts(limit?: number): Promise<ShiftListItem[]> {
    return this.#get<ShiftListItem[]>(`/v1/shifts${limit ? `?limit=${limit}` : ''}`)
  }
  // A plain <a href> cannot carry the bearer token the API requires, so the
  // export is fetched with auth here. The caller receives the body as text
  // (no blob URL) so it can be shared, copied or shown on screen — the
  // wallet's webview has no download manager to hand a blob URL to.
  async fetchShiftExport(id: string, format: 'csv' | 'json'): Promise<{ text: string; filename: string; mime: string }> {
    const token = this.getToken()
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(`${this.baseUrl}/v1/shifts/${id}/export?format=${format}`, { headers })
    if (!res.ok) throw new ApiError('UNKNOWN', `HTTP ${res.status}`, res.status)
    const text = await res.text()
    const mime = format === 'csv' ? 'text/csv' : 'application/json'
    return { text, filename: `shift-${id}.${format}`, mime }
  }
  getNetwork() { return this.#get<{ network: string; height: number | null }>('/v1/network') }
  getRate() { return this.#get<{ usdPerNim: number | null; asOf: string }>('/v1/rate') }
  getMe() { return this.#get<{ walletAddress: string; displayName: string | null }>('/v1/me') }
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
