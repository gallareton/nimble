import type { Quote } from './rates'

const LUNA_PER_NIM = 100_000n

/**
 * Fiat minor units → luna, using a quote of fiat per NIM.
 *
 * Integer arithmetic throughout: the intermediate is scaled by 10^8 so a rate
 * like 0.004 survives without a float. Rounds up, because a rounding loss
 * repeated across a day is the vendor's loss — that rounding is sub-luna and
 * invisible at two decimal places.
 *
 * There is deliberately no FX buffer. One was tried (50 bps) and removed: it
 * made the price on screen disagree with the price the vendor typed — 2.50
 * entered, 2.51 in history — while hedging almost nothing, because the
 * vendor's real exposure runs from the frozen quote until they actually sell
 * the NIM, which is days, not the 120 s the buffer was justified by.
 */
export function priceInLuna(fiatMinor: number, quote: Quote): bigint {
  if (!Number.isInteger(fiatMinor) || fiatMinor <= 0)
    throw new Error('fiat amount must be a positive integer in minor units')
  if (!(quote.value > 0)) throw new Error('rate must be positive')

  const SCALE = 100_000_000n
  const rateScaled = BigInt(Math.round(quote.value * Number(SCALE)))
  if (rateScaled <= 0n) throw new Error('rate must be positive')

  // fiatMinor / 100 gives major units; major / rate gives NIM; × LUNA_PER_NIM
  // gives luna. Kept as one fraction so only the final division rounds.
  const numerator = BigInt(fiatMinor) * SCALE * LUNA_PER_NIM
  const denominator = 100n * rateScaled
  const luna = (numerator + denominator - 1n) / denominator // ceil
  return luna > 0n ? luna : 1n
}
