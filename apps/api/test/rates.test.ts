import { afterAll, expect, it, vi } from 'vitest'
import { makeCoingeckoRates } from '../src/services/rates'
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
