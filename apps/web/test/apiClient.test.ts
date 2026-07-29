import { expect, it, vi } from 'vitest'
import { Api, ApiError } from '../src/api/client'

it('sends bearer token and idempotency key, parses errors', async () => {
  const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string> } }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init: init as (typeof calls)[0]['init'] })
    return new Response(JSON.stringify({ error: { code: 'CODE_UNAVAILABLE', message: 'nope' } }),
      { status: 404, headers: { 'content-type': 'application/json' } })
  }))
  const api = new Api('http://x', () => 'tok')
  await expect(api.claim('123456')).rejects.toMatchObject({ code: 'CODE_UNAVAILABLE', status: 404 })
  expect(calls[0].init.headers.authorization).toBe('Bearer tok')
  expect(calls[0].init.headers['idempotency-key']).toBeTruthy()
  expect(await api.claim('123456').catch(e => e)).toBeInstanceOf(ApiError)
})

it('reuses an explicit idempotency key across retries', async () => {
  const keys: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    keys.push((init.headers as Record<string, string>)['idempotency-key'])
    return new Response(JSON.stringify({ sessionId: 's' }), { status: 201 })
  }))
  const api = new Api('http://x', () => null)
  await api.createSession('my-key')
  await api.createSession('my-key')
  expect(keys).toEqual(['my-key', 'my-key'])
})

it('signals onUnauthorized on 401 so the app can force re-login', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'invalid token' } }),
      { status: 401, headers: { 'content-type': 'application/json' } })))
  const onUnauthorized = vi.fn()
  const api = new Api('http://x', () => 'stale-token', onUnauthorized)
  await expect(api.createSession()).rejects.toMatchObject({ status: 401 })
  expect(onUnauthorized).toHaveBeenCalledOnce()
})

it('does not signal onUnauthorized for auth endpoints (failed login is not a stale session)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'invalid signature' } }),
      { status: 401, headers: { 'content-type': 'application/json' } })))
  const onUnauthorized = vi.fn()
  const api = new Api('http://x', () => null, onUnauthorized)
  const wallet = { signMessage: async () => ({ publicKey: 'pk', signature: 'sig' }) }
  await expect(api.login(wallet as never)).rejects.toMatchObject({ status: 401 })
  expect(onUnauthorized).not.toHaveBeenCalled()
})
