import type { Quote } from './rates'

/** Half a percent. The merchant carries the FX risk across the 120 s window
 *  (D1), so the quote is padded rather than the payer being asked to accept a
 *  moving amount at the counter. */
export const FX_BUFFER_BPS = 50

const LUNA_PER_NIM = 100_000n

/**
 * Fiat minor units → luna, using a quote of fiat per NIM.
 *
 * Integer arithmetic throughout: the intermediate is scaled by 10^8 so a rate
 * like 0.004 survives without a float. Rounds up, because a rounding loss
 * repeated across a day is the vendor's loss.
 */
export function priceInLuna(fiatMinor: number, quote: Quote, bufferBps = FX_BUFFER_BPS): bigint {
  if (!Number.isInteger(fiatMinor) || fiatMinor <= 0)
    throw new Error('fiat amount must be a positive integer in minor units')
  if (!(quote.value > 0)) throw new Error('rate must be positive')

  const SCALE = 100_000_000n
  const rateScaled = BigInt(Math.round(quote.value * Number(SCALE)))
  if (rateScaled <= 0n) throw new Error('rate must be positive')

  // fiatMinor / 100 gives major units; major / rate gives NIM; × LUNA_PER_NIM
  // gives luna. Kept as one fraction so only the final division rounds.
  const numerator = BigInt(fiatMinor) * SCALE * LUNA_PER_NIM * BigInt(10_000 + bufferBps)
  const denominator = 100n * rateScaled * 10_000n
  const luna = (numerator + denominator - 1n) / denominator // ceil
  return luna > 0n ? luna : 1n
}
