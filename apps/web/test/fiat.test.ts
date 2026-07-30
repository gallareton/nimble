import { expect, it } from 'vitest'
import { formatUsd, formatUsdValue } from '../src/lib/fiat'

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
