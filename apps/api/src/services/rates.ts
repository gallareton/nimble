// NIM→USD spot rate. CoinGecko free tier, server-side cached so clients
// never hit the external API (or its rate limits) directly. Rates are
// display-only; a fetch failure degrades to "no fiat shown", never an error.

/** The rate alone is not enough for a tax export: it also has to say when it
 *  was taken and where from, so a shift report can be defended in an audit. */
export interface Quote { value: number; at: string; source: string }

export interface RateProvider {
  getUsdPerNim(): Promise<number | null>
  quoteUsdPerNim?(): Promise<Quote | null>
}

export const COINGECKO_SOURCE = 'coingecko:nimiq-2'

export function makeCoingeckoRates(ttlMs = 120_000): RateProvider {
  let cached: { value: number; at: number } | null = null
  const self: RateProvider = {
    async quoteUsdPerNim() {
      const value = await self.getUsdPerNim()
      if (value === null || !cached) return null
      // The timestamp is when the rate was fetched, not when it was used —
      // a cached rate must not claim to be fresher than it is.
      return { value, at: new Date(cached.at).toISOString(), source: COINGECKO_SOURCE }
    },
    async getUsdPerNim() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd')
        const j = (await res.json()) as { 'nimiq-2'?: { usd?: number } }
        const v = j?.['nimiq-2']?.usd
        if (typeof v === 'number' && v > 0) {
          cached = { value: v, at: Date.now() }
          return v
        }
      } catch { /* fall through to stale/null */ }
      return cached?.value ?? null
    },
  }
  return self
}

export const nullRates: RateProvider = {
  getUsdPerNim: async () => null,
  quoteUsdPerNim: async () => null,
}
