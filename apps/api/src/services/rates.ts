// NIM→USD spot rate. CoinGecko free tier, server-side cached so clients
// never hit the external API (or its rate limits) directly. Rates are
// display-only; a fetch failure degrades to "no fiat shown", never an error.
export interface RateProvider { getUsdPerNim(): Promise<number | null> }

export function makeCoingeckoRates(ttlMs = 120_000): RateProvider {
  let cached: { value: number; at: number } | null = null
  return {
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
}

export const nullRates: RateProvider = { getUsdPerNim: async () => null }
