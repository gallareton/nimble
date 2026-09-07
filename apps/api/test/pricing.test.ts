import { expect, it } from 'vitest'
import { priceInLuna } from '../src/services/pricing'

const quote = { value: 0.004, at: '2026-08-27T10:00:00.000Z', source: 'test' }

it('converts minor fiat units to luna and rounds up, so the vendor is never short', () => {
  // 12.34 USD at 0.004 USD/NIM = 3085 NIM = 308_500_000 luna, exactly.
  expect(priceInLuna(1234, quote)).toBe(308_500_000n)
})

it('the price charged converts back to the price entered, to the cent', () => {
  // The regression this guards: a 50 bps buffer used to be added here, so a
  // vendor entering 2.50 saw 2.51 in history. Round-tripping the luna amount
  // back through the same quote has to land on the entered figure.
  for (const minor of [250, 1, 999, 1234, 100_000]) {
    const luna = priceInLuna(minor, quote)
    const backMinor = Math.round((Number(luna) / 100_000) * quote.value * 100)
    expect(backMinor).toBe(minor)
  }
})

it('rejects a non-positive amount and a worthless rate', () => {
  expect(() => priceInLuna(0, quote)).toThrow(/positive/)
  expect(() => priceInLuna(-5, quote)).toThrow(/positive/)
  expect(() => priceInLuna(100, { ...quote, value: 0 })).toThrow(/rate/)
})

it('never returns zero for a tiny amount', () => {
  expect(priceInLuna(1, { ...quote, value: 1_000_000 })).toBe(1n)
})
