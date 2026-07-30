import { useEffect, useState } from 'react'
import type { Api } from '../api/client'

// Display-only USD equivalents. Live values use the server-cached spot
// rate; history/receipts use the value frozen into the snapshot at
// confirmation time and never drift with the market.
export function formatUsdValue(usd: number): string {
  const text = usd >= 0.01
    ? usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : usd.toLocaleString('en-US', { maximumSignificantDigits: 2 })
  return `≈ $${text}`
}

export function formatUsd(nim: number, usdPerNim: number | null): string | null {
  if (!usdPerNim || !Number.isFinite(nim) || nim <= 0) return null
  return formatUsdValue(nim * usdPerNim)
}

let cache: { v: number | null; at: number } | null = null

export function useUsdRate(api: Api): number | null {
  const [rate, setRate] = useState<number | null>(cache?.v ?? null)
  useEffect(() => {
    if (cache && Date.now() - cache.at < 120_000) { setRate(cache.v); return }
    // rates are decoration: any failure (including a test double without
    // getRate) must never break a screen
    void Promise.resolve()
      .then(() => api.getRate())
      .then(r => {
        cache = { v: r.usdPerNim, at: Date.now() }
        setRate(r.usdPerNim)
      })
      .catch(() => {})
  }, [api])
  return rate
}
