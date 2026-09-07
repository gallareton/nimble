import { expect, it } from 'vitest'
import { formatUsd, formatUsdValue, receiptFiat } from '../src/lib/fiat'

it('formats cents with 2 decimals and dust with 2 significant digits', () => {
  expect(formatUsdValue(12.345)).toBe('≈ $12.35')
  expect(formatUsdValue(0.00116)).toBe('≈ $0.0012')
})

it('returns null without a rate or a sensible amount', () => {
  expect(formatUsd(2.5, null)).toBeNull()
  expect(formatUsd(NaN, 0.5)).toBeNull()
  expect(formatUsd(0, 0.5)).toBeNull()
  expect(formatUsd(2.5, 0.0005)).toBe('≈ $0.0013')
})

// The bug these guard: a sale entered as 2.50 USD showed 2.51, because the
// receipt re-derived the fiat figure from the NIM amount instead of carrying
// the number the vendor typed.
it('shows the price the vendor typed, not one derived from the NIM amount', () => {
  const r = receiptFiat({ priceFiatMinor: 250, settledFiatMinor: 251 })
  expect(r?.price).toBe('≈ $2.50')
  expect(r?.settled).toBe('≈ $2.51') // the old buffered receipts still tell the truth
})

it('hides the settled line when it matches the price', () => {
  // Every fiat sale taken since the FX buffer was removed looks like this.
  expect(receiptFiat({ priceFiatMinor: 250, settledFiatMinor: 250 })?.settled).toBeNull()
})

it('a NIM-priced sale has only a settled value, shown as the price', () => {
  const r = receiptFiat({ settledFiatMinor: 1234 })
  expect(r?.price).toBe('≈ $12.34')
  expect(r?.settled).toBeNull()
})

it('falls back to the pre-2026-09 float field, and to nothing at all', () => {
  expect(receiptFiat({ amountUsd: 2.5 })?.price).toBe('≈ $2.50')
  expect(receiptFiat({})).toBeNull()
})
