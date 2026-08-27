import { expect, it } from 'vitest'
import { FX_BUFFER_BPS, priceInLuna } from '../src/services/pricing'

const quote = { value: 0.004, at: '2026-08-27T10:00:00.000Z', source: 'test' }

it('converts minor fiat units to luna and rounds up, so the vendor is never short', () => {
  // 12.34 USD at 0.004 USD/NIM = 3085 NIM = 308_500_000 luna, plus 0.5%
  expect(priceInLuna(1234, quote, 0)).toBe(308_500_000n)
  expect(priceInLuna(1234, quote)).toBe(310_042_500n)
})

it('the buffer is half a percent', () => {
  expect(FX_BUFFER_BPS).toBe(50)
})

it('rejects a non-positive amount and a worthless rate', () => {
  expect(() => priceInLuna(0, quote)).toThrow(/positive/)
  expect(() => priceInLuna(-5, quote)).toThrow(/positive/)
  expect(() => priceInLuna(100, { ...quote, value: 0 })).toThrow(/rate/)
})

it('never returns zero for a tiny amount', () => {
  expect(priceInLuna(1, { ...quote, value: 1_000_000 })).toBe(1n)
})
