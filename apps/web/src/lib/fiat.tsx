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

/** The fiat figures a receipt snapshot can carry, across three generations of
 *  them: today's exact price, today's settled equivalent, and the pre-2026-09
 *  float. */
export interface FiatSnapshot {
  priceFiatMinor?: number | null
  priceFiatCurrency?: string | null
  settledFiatMinor?: number | null
  amountUsd?: number | null
}

/**
 * What to show for a sale, and whether the settled value is worth showing too.
 *
 * `price` is the figure the vendor typed, when the sale had one — never
 * re-derived from the NIM amount, which is how a sale entered as 2.50 once
 * displayed as 2.51. `settled` is what the transferred NIM was worth, and is
 * returned only when it actually differs from the price: for a NIM-priced sale
 * there is no price to differ from, and for a fiat sale taken after the FX
 * buffer was removed the two are equal, so a second identical line is noise.
 *
 * Older receipts carry only the float `amountUsd`; they fall through to it.
 */
export function receiptFiat(s: FiatSnapshot): { price: string; settled: string | null } | null {
  const priceMinor = s.priceFiatMinor ?? null
  const settledMinor = s.settledFiatMinor ?? null

  if (priceMinor !== null) {
    const differs = settledMinor !== null && settledMinor !== priceMinor
    return {
      price: formatUsdValue(priceMinor / 100),
      settled: differs ? formatUsdValue(settledMinor / 100) : null,
    }
  }
  if (settledMinor !== null) return { price: formatUsdValue(settledMinor / 100), settled: null }
  if (typeof s.amountUsd === 'number') return { price: formatUsdValue(s.amountUsd), settled: null }
  return null
}

export function formatUsd(nim: number, usdPerNim: number | null): string | null {
  if (!usdPerNim || !Number.isFinite(nim) || nim <= 0) return null
  return formatUsdValue(nim * usdPerNim)
}

/**
 * The NIM equivalent of a fiat price, for the small grey second line beside
 * every price in the till (P1). Presentation only — the money is still
 * counted, quoted and settled in integer minor units; this never feeds a
 * calculation.
 *
 * Null when there is no usable rate, so callers fall back to bare fiat.
 * Above 1000 NIM the decimals are noise, so they go; below it, two.
 */
export function formatNimApprox(usdMinor: number, usdPerNim: number | null): string | null {
  if (!usdPerNim || usdPerNim <= 0) return null
  if (!Number.isFinite(usdMinor)) return null
  const nim = usdMinor / 100 / usdPerNim
  if (!Number.isFinite(nim)) return null
  const text = nim >= 1000
    ? nim.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : nim.toFixed(2)
  return `≈ ${text} NIM`
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

/** The one-line fiat figure beside an amount in a list. Renders nothing when
 *  the snapshot carries no fiat value at all — a cash sale included: its
 *  amount IS fiat and is printed on its own (see `fiatAmount`). */
export function FiatBadge({ snapshot }: { snapshot: FiatSnapshot & { paymentMethod?: unknown } }) {
  if (snapshot.paymentMethod === 'cash') return null
  const fiat = receiptFiat(snapshot)
  return fiat ? <small className="fiat">{fiat.price}</small> : null
}

/** The amount of a cash sale: minor units of the sale's own currency, printed
 *  exactly ("15.00 USD") — no rate, nothing approximate about it. */
export function fiatAmount(item: { snapshot: Record<string, unknown> }): string {
  const minor = Number(item.snapshot.amountFiatMinor ?? 0)
  const currency = String(item.snapshot.fiatCurrency ?? 'USD')
  return `${(Number.isFinite(minor) ? minor / 100 : 0).toFixed(2)} ${currency}`
}
