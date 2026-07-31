import { afterEach, expect, it, vi } from 'vitest'

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [prefix, body] of Object.entries(routes))
      if (String(url).startsWith(prefix))
        return new Response(JSON.stringify(body), { status: 200 })
    return new Response('nope', { status: 404 })
  }))
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('falls back to legacy single-stack when no /api prefixes exist', async () => {
  vi.resetModules()
  mockFetch({})
  const { detectNetwork } = await import('../src/lib/network')
  expect((await detectNetwork()).net).toBe('single')
})

it('defaults to mainnet without a wallet signal', async () => {
  vi.resetModules()
  mockFetch({
    '/api/main/v1/network': { network: 'MainAlbatross', height: 55_000_000 },
    '/api/test/v1/network': { network: 'TestAlbatross', height: 7_400_000 },
  })
  const { detectNetwork } = await import('../src/lib/network')
  const c = await detectNetwork()
  expect(c.net).toBe('main')
  expect(c.base).toBe('/api/main')
  expect(c.suffix).toBe('.main')
})

it('picks the stack whose height matches the wallet', async () => {
  vi.resetModules()
  mockFetch({
    '/api/main/v1/network': { network: 'MainAlbatross', height: 55_000_000 },
    '/api/test/v1/network': { network: 'TestAlbatross', height: 7_400_000 },
  })
  ;(window as never as { nimiqPay: object }).nimiqPay = {}
  vi.doMock('../src/wallet', () => ({ getWallet: () => ({
    getBlockNumber: async () => 7_400_123,
    isConsensusEstablished: async () => true,
  }) }))
  const { detectNetwork } = await import('../src/lib/network')
  const c = await detectNetwork()
  expect(c.net).toBe('test')
  delete (window as never as { nimiqPay?: object }).nimiqPay
  vi.doUnmock('../src/wallet')
})
