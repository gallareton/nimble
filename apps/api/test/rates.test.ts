import { afterAll, expect, it, vi } from 'vitest'
import { makeCoingeckoRates, COINGECKO_SOURCE } from '../src/services/rates'
import { freshDb } from './helpers/db'
import { authedApp } from './helpers/actors'

const { db, close } = await freshDb()
afterAll(close)

it('coingecko provider caches and degrades to stale value on failure', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ 'nimiq-2': { usd: 0.0005 } })))
  vi.stubGlobal('fetch', fetchMock)
  const rates = makeCoingeckoRates(60_000)
  expect(await rates.getUsdPerNim()).toBe(0.0005)
  expect(await rates.getUsdPerNim()).toBe(0.0005)
  expect(fetchMock).toHaveBeenCalledTimes(1) // cached
  vi.unstubAllGlobals()
})

it('GET /v1/rate returns the provider value (and null without one)', async () => {
  const { app } = authedApp(db)
  app.deps.rates = { getUsdPerNim: async () => 0.00046 }
  const r = await app.inject({ url: '/v1/rate' })
  expect(r.json().usdPerNim).toBe(0.00046)

  const bare = authedApp(db)
  const r2 = await bare.app.inject({ url: '/v1/rate' })
  expect(r2.json().usdPerNim).toBeNull()
})

it('a quote reports the moment the rate was fetched, not the moment it was used', async () => {
  let calls = 0
  const fetchMock = vi.fn(async () => {
    calls++
    return new Response(JSON.stringify({ 'nimiq-2': { usd: 0.004 } }))
  })
  vi.stubGlobal('fetch', fetchMock)
  const rates = makeCoingeckoRates(60_000)

  const first = await rates.quoteUsdPerNim!()
  expect(first).not.toBeNull()
  expect(first!.value).toBe(0.004)
  expect(first!.source).toBe(COINGECKO_SOURCE)
  expect(Date.parse(first!.at)).not.toBeNaN()

  await new Promise(r => setTimeout(r, 25))
  const second = await rates.quoteUsdPerNim!()
  // served from cache — so the timestamp must not move forward
  expect(calls).toBe(1)
  expect(second!.at).toBe(first!.at)
  vi.unstubAllGlobals()
})
